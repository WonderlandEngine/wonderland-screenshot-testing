import {IncomingMessage, ServerResponse, createServer} from 'node:http';
import {cpus} from 'node:os';
import {createWriteStream} from 'node:fs';
import {readFile, writeFile} from 'node:fs/promises';
import {resolve, join, basename, dirname, parse as parsePath} from 'node:path';
import {finished} from 'node:stream/promises';

import {PNG} from 'pngjs';
import {
    launch as puppeteerLauncher,
    ConsoleMessage,
    BrowserContext,
    Browser,
} from 'puppeteer-core';
import handler from 'serve-handler';
import pixelmatch from 'pixelmatch';

import {Config, Scenario, Project, SaveMode, RunnerMode} from './config.js';
import {Dimensions, Image2d, generateImageDiff} from './image.js';
import {mkdirp, summarizePath} from './utils.js';

/**
 * Parse the buffer as a png.
 *
 * @param data The buffer to parse.
 * @returns The uncompressed image data.
 */
function parsePNG(data: Buffer): Image2d {
    const png = PNG.sync.read(data);
    return {
        width: png.width,
        height: png.height,
        data: new Uint8ClampedArray(png.data),
    };
}

/**
 * Load the references of the given scenario list.
 *
 * @param scenarios The scenario list to load the references from.
 * @returns An array of promise that resolve with the data for loaded images,
 *    or errors for failed images.
 */
async function loadReferences(scenarios: Scenario[]): Promise<(Image2d | Error)[]> {
    const promises = scenarios.map(async (s) => {
        try {
            const expectedData = await readFile(s.reference);
            return parsePNG(expectedData);
        } catch (e: any) {
            return new Error(
                `Failed to open reference for scenario ${s.event}:\n  ${e.message}`
            );
        }
    });
    return Promise.all(promises);
}

/**
 * Test runner log level.
 */
export enum LogLevel {
    /** Display info logs */
    Info = 1 << 0,
    /** Display warning logs */
    Warn = 1 << 1,
    /** Display error logs */
    Error = 1 << 2,
}

const LogTypeToLevel = {
    log: LogLevel.Info,
    warn: LogLevel.Warn,
    Error: LogLevel.Error,
};

/**
 * Screenshot test suite runner.
 *
 * The screenshot runner is in charge of:
 *     - Locating the browser to run the tests in
 *     - Handling http requests
 *     - Running the project and reacting to screenshot events
 *     - Comparing each screenshot to its reference
 *
 * ## Usage
 *
 * ```js
 * const config = new Config();
 * await config.add('path/to/project');
 *
 * const runner = new ScreenshotRunner();
 * const success = runner.run(config);
 *
 * console.log(success ? 'Tests passed!' : 'Some test(s) failed!');
 * ```
 */
export class ScreenshotRunner {
    /** Per-project browser logs */
    logs: string[][] = [];

    /** Configuration to run. */
    private _config: Config;

    /** Browser context debounce time. */
    private _contextDebounce = 750;

    /** HTTP server callback. */
    private _httpCallback = (
        req: IncomingMessage,
        response: ServerResponse<IncomingMessage>
    ) => {
        const header = req.headers['test-project'] ?? '';
        const projectId = parseInt(Array.isArray(header) ? header[0] : header);
        if (isNaN(projectId)) return handler(req, response);

        const project = this._config.projects[projectId];
        const path = resolve(project.path, 'deploy');
        return handler(req, response, {public: path});
    };

    /**
     * Create a new runner.
     *
     * @param config The configuration to run.
     */
    constructor(config: Config) {
        this._config = config;
    }

    /**
     * Run the tests described in `config`.
     *
     * @returns `true` if all tests passed, `false` otherwise.
     */
    async run(): Promise<boolean> {
        const config = this._config;
        const projects = config.projects;
        if (config.output) await mkdirp(config.output);

        this.logs = projects.map((_) => []);

        /* Start loading references for each project */
        const referencesPending: Promise<(Image2d | Error)[]>[] = Array.from(
            config.projects,
            () => null!
        );
        for (let i = 0; i < projects.length; ++i) {
            const project = projects[i];
            referencesPending[i] = loadReferences(project.scenarios);
        }

        const contextsUpperBound =
            config.maxContexts ?? Math.min(Math.max(2, cpus().length), 6);
        const contexts = Math.min(projects.length, contextsUpperBound);

        console.log(
            'Information:\n' +
                `  ➡️  Web server port: ${config.port}\n` +
                `  ➡️  Projects count: ${config.projects.length}\n` +
                `  ➡️  Browser contexts: ${contexts}\n` +
                `  ➡️  Watching: ${config.watch}`
        );

        const server = createServer(this._httpCallback);
        server.listen(config.port);

        const headless = !config.watch;
        const browser = await puppeteerLauncher({
            headless,
            /* Prefer chrome since canary rendering isn't always working */
            channel: 'chrome',
            devtools: !headless,
            timeout: !config.watch ? 30000 : 0,
            waitForInitialPage: true,
            args: ['--no-sandbox', '--use-gl=angle', '--ignore-gpu-blocklist'],
        });

        /* Create output folders for each project */
        let outputsPending: Promise<string[] | null> | null = Promise.resolve(null);
        if (config.output) {
            const outputs = projects.map((p) => join(config.output!, basename(p.path)));
            const promises = outputs.map(async (path) => {
                await mkdirp(path).catch((e) => {
                    const p = summarizePath(path);
                    console.error(`❌ Failed to create output folder: '${p}', reason:`, e);
                });
                return path;
            });
            outputsPending = Promise.all(promises);
        }

        /* Start capturing screenshots for each project */
        const screenshotsPending = this._capture(browser, contexts);

        /* While we could wait simultaneously for screenshots and references, loading the pngs
         * should be must faster and be done by now anyway. */
        const references = await Promise.all(referencesPending);
        const pngs = await screenshotsPending;
        const screenshots = pngs.map((p) =>
            p.map((s) => (s instanceof Error ? s : parsePNG(s)))
        );

        server.close();
        browser.close();

        /* Compare screenshots to references */
        const failures: Scenario[][] = Array.from(projects, () => []);
        for (let i = 0; i < projects.length; ++i) {
            const {name, scenarios} = projects[i];
            const count = scenarios.length;
            console.log(`\n❔ Comparing ${count} scenarios in project '${name}'...`);

            if (config.mode !== RunnerMode.CaptureAndCompare) continue;
            failures[i] = this._compare(scenarios, screenshots[i], references[i]);
        }
        const success = failures.findIndex((a) => a.length) === -1;

        const outputs = await outputsPending;

        /* Save screenshots to disk based on the config saving mode */
        let willSaveOnDisk = config.difference;
        let pendingSaves: Promise<void>[] = [];
        switch (config.save) {
            case SaveMode.OnFailure:
                pendingSaves = projects.map((_, i) =>
                    save(outputs ? outputs[i] : null, failures[i], pngs[i])
                );
                willSaveOnDisk = true;
                break;
            case SaveMode.All:
                pendingSaves = projects.map((proj, i) =>
                    save(outputs ? outputs[i] : null, proj.scenarios, pngs[i])
                );
                willSaveOnDisk = true;
                break;
            case SaveMode.None:
                break;
        }

        if (willSaveOnDisk) {
            console.log(`\n✏️  Saving scenario references & difference images...`);
        }

        /* Save image difference to disk */
        let pendingDiff: Promise<void>[] = [];
        if (config.difference) {
            pendingDiff = projects.map((_, i) => {
                return saveDifferences(
                    outputs ? outputs[i] : null,
                    failures[i],
                    screenshots[i],
                    references[i]
                );
            });
        }

        await Promise.all([Promise.all(pendingSaves), Promise.all(pendingDiff)]);

        return success;
    }

    /**
     * Save the current logs at the specified path.
     *
     * @param path The path to save the log at.
     * @returns A promise that resolves once the file is saved.
     */
    async saveLogs(path: string) {
        const fullpath = resolve(path);
        const directory = resolve(dirname(fullpath));
        await mkdirp(directory);

        const content = this.logs.map((l) => l.join('\n')).join('\n\n');
        return writeFile(fullpath, content);
    }

    /**
     * Capture screenshots in a browser using one/multiple context(s).
     *
     * @param browser The browser instance.
     * @param contextsCount Number of browser contexts to use.
     * @returns Array of screenshots **per** project.
     */
    private async _capture(browser: Browser, contextsCount: number) {
        const {projects} = this._config;

        console.log(`\n📷 Capturing scenarios for ${projects.length} project(s)...`);
        const contexts: (BrowserContext | null)[] = await Promise.all(
            Array.from({length: contextsCount})
                .fill(null)
                .map((_) => browser.createIncognitoBrowserContext())
        );

        const result: Promise<(Buffer | Error)[]>[] = Array.from(projects, () => null!);

        for (let i = 0; i < projects.length; ++i) {
            let freeContext = -1;
            while ((freeContext = contexts.findIndex((x) => x !== null)) === -1) {
                /* Yield the event loop to allow checking for free contexts. */
                await new Promise((res) => setTimeout(res, this._contextDebounce));
            }

            const context = contexts[freeContext]!;
            if (context === null) throw new Error('null context');
            contexts[freeContext] = null; /* Marks context as used */

            result[i] = this._captureProjectScreenshots(context, i, projects[i]).finally(
                () => (contexts[freeContext] = context)
            );
        }

        return Promise.all(result);
    }

    /**
     * Capture the screenshots for a project.
     *
     * @param project The project to capture the screenshots from.
     * @param browser The browser instance.
     * @returns An array of promise that resolve with the data for loaded images,
     *    or errors for failed images.
     */
    private async _captureProjectScreenshots(
        browser: BrowserContext,
        projectId: number,
        {width, height}: Dimensions
    ) {
        const config = this._config;

        const project = config.projects[projectId];
        const {scenarios, timeout} = project;
        const count = scenarios.length;
        const results: (Buffer | Error)[] = new Array(count).fill(null);

        const eventToScenario = new Map();
        for (let i = 0; i < count; ++i) {
            const event = scenarios[i].event;
            eventToScenario.set(event, i);
            results[i] = new Error(`event '${event}' wasn't dispatched`);
        }

        let eventCount = 0;
        let error: any = null;

        function onerror(err: any) {
            error = err;
        }

        const page = await browser.newPage();
        page.on('pageerror', onerror);
        page.on('error', onerror);
        page.on('console', (message: ConsoleMessage) => {
            const msg = message.text();
            const type = message.type() as 'log' | 'warn' | 'error';
            const level = LogTypeToLevel[type as keyof typeof LogTypeToLevel];
            this.logs[projectId].push(`[${project.name}][${message.type()}] ${msg}`);
            if (this._config.log & level) console[type](`[browser] ${msg}`);
        });
        page.setCacheEnabled(false);
        page.setExtraHTTPHeaders({
            'test-project': projectId.toString(),
        });
        await page.setViewport({
            width: width,
            height: height,
            deviceScaleFactor: 1,
        });

        async function processEvent(e: string) {
            if (!eventToScenario.has(e)) {
                console.warn(`[${project.name}] Received non-existing event: '${e}' ❌`);
                return;
            }

            const screenshot = await page.screenshot({
                omitBackground: false,
                optimizeForSpeed: false,
            });
            console.log(`[${project.name}] Event '${e}' received`);

            results[eventToScenario.get(e)] = screenshot;

            /* Needs to be set after taking the screenshot to avoid
             * closing the browser too fast. */
            ++eventCount;
        }

        await page.exposeFunction('testScreenshot', processEvent);
        /* We do not use waitUntil: 'networkidle0' in order to setup
         * the event sink before the project is fully loaded. */
        await page.goto(`http://localhost:${config.port}/index.html`);
        /* The runner also supports scene loaded events, forwarded in the DOM.
         * Each time a load event occurs, we convert it to a unique event name and
         * forward the call to `testScreenshot`. */
        await page.evaluate(() => {
            document.addEventListener('wle-scene-ready', function (e) {
                // @ts-ignore
                window.testScreenshot(`wle-scene-ready:${e.detail.filename}`);
            });
        });

        if (config.watch) {
            await page.waitForNavigation();
        }

        let time = 0;
        while (error === null && eventCount < count && time < timeout) {
            const debounceTime = 1000;
            await new Promise((res) => setTimeout(res, debounceTime));
            time += debounceTime;
        }

        if (error !== null) {
            const errorStr = error.stack ? `Stacktrace:\n${error.stack}` : error + '';
            console.error(
                `[${project.name}] Uncaught browser top-level error: ${errorStr}`
            );
        }

        await page.close();

        return results;
    }

    /**
     * Compare screenshots against references.
     *
     * @param scenarios The scenarios to compare.
     * @param screenshots The generated screenshots.
     * @param references Reference images (golden) of each scenario.
     * @returns An array containing failed scenarios.
     */
    private _compare(
        scenarios: Scenario[],
        screenshots: (Error | Image2d)[],
        references: (Error | Image2d)[]
    ) {
        // @todo: Move into worker
        const failed: Scenario[] = [];
        for (let i = 0; i < screenshots.length; ++i) {
            const {event, tolerance, perPixelTolerance} = scenarios[i];

            const screenshot = screenshots[i];
            const reference = references[i];
            if (screenshot instanceof Error || reference instanceof Error) {
                failed.push(scenarios[i]);
                const msg = (screenshot as Error).message ?? (reference as Error).message;
                console.log(`❌ Scenario '${event}' failed with error:\n  ${msg}`);
                continue;
            }

            const {width, height} = screenshot;
            const count = pixelmatch(screenshot.data, reference.data, null, width, height, {
                threshold: perPixelTolerance,
            });
            const error = count / (width * height);
            if (error > tolerance) {
                failed.push(scenarios[i]);
                const val = (error * 100).toFixed(2);
                const expected = (tolerance * 100).toFixed(2);
                console.log(`❌ Scenario '${event}' failed!`);
                console.log(`  ${count} different pixels | ${val}% > ${expected}%`);
                continue;
            }

            console.log(`✅ Scenario ${event} passed!`);
        }

        return failed;
    }
}

/**
 * Save the captured references of a list of scenarios.
 *
 * @note This method assumes that the output directory already exists.
 *
 * @param output The output directory. If `null`, will overwrite the reference file.
 * @param scenarios The list of scenarios to save.
 * @param pngs The entire list of pngs in the project.
 * @returns A promise that resolves once all writes are done.
 */
function save(output: string | null, scenarios: Scenario[], pngs: (Buffer | Error)[]) {
    if (!scenarios.length) return Promise.resolve();

    const promises = scenarios.map((scenario) => {
        const data = pngs[scenario.index];
        if (data instanceof Error) return;

        const path = output
            ? join(output, basename(scenario.reference))
            : scenario.reference;

        const summary = summarizePath(path);
        return writeFile(path, data)
            .then(() => console.log(`Screenshot '${summary}' saved`))
            .catch((e) =>
                console.error(`❌ Failed to write png '${summary}'\n  ${e.reason}`)
            );
    });

    return Promise.all(promises).then(() => {});
}

/**
 * Generate and save image difference.
 *
 * Diff images will output pink pixels where differences are found.
 * Stronger differences will be represented as stronger tint of pink.
 *
 * @note This method assumes that the output directory already exists.
 *
 * @param output The output directory. If `null`, will output next to the reference file.
 * @param scenarios The list of scenarios to generate the diff image for.
 * @param screenshots The entire list of screenshots (raw image data) in the project.
 * @param references The entire list of reference images (raw image data) in the project.
 *
 * @returns A promise that resolves once all images are saved.
 */
function saveDifferences(
    output: string | null,
    scenarios: Scenario[],
    screenshots: (Error | Image2d)[],
    references: (Error | Image2d)[]
) {
    const result = scenarios.map((scenario) => {
        const screenshot = screenshots[scenario.index];
        const reference = references[scenario.index];
        if (screenshot instanceof Error || reference instanceof Error) return;

        const image = generateImageDiff(screenshot, reference);

        const {name, dir} = parsePath(basename(scenario.reference));
        const path = join(output ? output : dir, `${name}_diff.png`);
        const summary = summarizePath(path);

        const stream = createWriteStream(path);
        const promise = finished(stream)
            .then(() => console.log(`Difference image '${summary}' saved`))
            .catch((e) => {
                console.error(
                    `❌ Failed to write difference png '${summary}'\n  ${e.reason}`
                );
            });

        const png = new PNG({width: screenshot.width, height: screenshot.height});
        png.data = Buffer.from(image.buffer);
        png.pack().pipe(stream);

        return promise;
    });

    return Promise.all(result).then(() => {});
}

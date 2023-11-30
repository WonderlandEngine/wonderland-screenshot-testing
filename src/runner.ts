import {createServer} from 'node:http';
import {readFile, writeFile} from 'node:fs/promises';
import {resolve, join, basename, dirname} from 'node:path';

import {Launcher} from 'chrome-launcher';
import {PNG} from 'pngjs';
import {launch as puppeteerLauncher, Browser, ConsoleMessage} from 'puppeteer-core';
import handler from 'serve-handler';
import pixelmatch from 'pixelmatch';

import {Config, Scenario, Project, SaveMode, RunnerMode} from './config.js';
import {mkdirp, summarizePath} from './utils.js';

/** State the runner is currently in. */
enum WebRunnerState {
    Running = 1,
    Watching = 2,
    Error = 3,
}

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

function reduce<T>(indices: number[], array: T[]) {
    const result = new Array(indices.length).fill(null);
    for (let i = 0; i < indices.length; ++i) {
        result[i] = array[indices[i]];
    }
    return result;
}

export interface Dimensions {
    width: number;
    height: number;
}

export type Image2d = Dimensions & {
    data: Uint8ClampedArray;
};

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
    /** Browser logs */
    logs: string[] = [];

    /** Configuration to run. @hidden */
    private _config: Config;

    /** Base path to serve. @hidden */
    private _currentBasePath = '';

    /** Dispatch an info log coming from the browser. @hidden */
    private _onBrowserInfoLog = (message: ConsoleMessage) => {
        const msg = message.text();
        const type = message.type() as 'log' | 'warn' | 'error';
        const level = LogTypeToLevel[type as keyof typeof LogTypeToLevel];
        this.logs.push(`[${message.type()}] ${msg}`);
        if (this._config.log & level) console[type](`[browser] ${msg}`);
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
        this.logs.length = 0;

        const config = this._config;
        const server = createServer((request, response) => {
            return handler(request, response, {
                public: this._currentBasePath,
            });
        });
        server.listen(config.port);

        console.log(`Starting test server on port: ${config.port}`);

        const executablePath = Launcher.getFirstInstallation();
        if (!executablePath) {
            server.close();
            throw new Error(
                'Could not automatically find any installation of Chrome using chrome-launcher. ' +
                    'Set the CHROME_PATH variable to help chrome-launcher find it'
            );
        }

        console.log(`Chrome executable: ${summarizePath(executablePath)}`);

        const headless = !config.watch;

        const browser = await puppeteerLauncher({
            headless,
            executablePath,
            devtools: !headless,
            waitForInitialPage: true,
            args: ['--no-sandbox', '--use-gl=angle', '--ignore-gpu-blocklist'],
        });

        let success = true;
        try {
            for (const project of config.projects) {
                /* We do not test multiple pages simultaneously to prevent
                 * the animation loop to stop. */
                const result = await this._runTests(project, browser);
                success &&= result;
            }
        } catch (e) {
            throw e;
        } finally {
            server.close();
            browser.close();
        }

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

        const content = this.logs.join('\n');
        return writeFile(fullpath, content);
    }

    /**
     * Run the tests of a given project.
     *
     * @param project The project to run the scenarios from.
     * @param browser Browser instance.
     * @returns A promise that resolves to `true` if all tests passed,
     *     `false` otherwise.
     */
    async _runTests(project: Project, browser: Browser): Promise<boolean> {
        this._currentBasePath = resolve(project.path, 'deploy');

        const config = this._config;
        const scenarios = project.scenarios;
        const count = scenarios.length;

        console.log(`\n📎 Running project ${project.name} with ${count} scenarios\n`);

        if (config.output) await mkdirp(config.output);

        /* Load references first to validate their size. */
        const references = await loadReferences(scenarios);

        const first = references.find((img) => !(img instanceof Error)) as
            | Image2d
            | undefined;

        /* Capture page screenshots upon events coming from the application. */
        const pngs = await this._captureScreenshots(browser, project, {
            width: config.width ?? first?.width ?? 480,
            height: config.height ?? first?.height ?? 270,
        });
        const screenshots = pngs.map((s) => (s instanceof Error ? s : parsePNG(s)));

        let failed: number[] = [];
        if (config.mode !== RunnerMode.Capture) {
            failed = this._compare(scenarios, screenshots, references);
        }

        switch (config.save) {
            case SaveMode.OnFailure: {
                const failedScenarios = reduce(failed, scenarios);
                const failedPngs = reduce(failed, pngs);
                await this._save(project, failedScenarios, failedPngs);
                break;
            }
            case SaveMode.All:
                await this._save(project, scenarios, pngs);
                break;
        }

        return !failed.length;
    }

    /**
     * Capture the screenshots for a project.
     *
     * @param project The project to capture the screenshots from.
     * @param browser The browser instance.
     * @returns An array of promise that resolve with the data for loaded images,
     *    or errors for failed images.
     */
    async _captureScreenshots(
        browser: Browser,
        project: Project,
        {width, height}: Dimensions
    ) {
        const config = this._config;
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
        let state = WebRunnerState.Running;
        let error: any = null;

        function onerror(err: any) {
            error = err;
            state = WebRunnerState.Error;
        }

        const page = await browser.newPage();
        page.on('pageerror', onerror);
        page.on('error', onerror);
        page.on('console', this._onBrowserInfoLog);
        page.setCacheEnabled(false);
        await page.setViewport({
            width: width,
            height: height,
            deviceScaleFactor: 1,
        });

        async function processEvent(e: string) {
            if (!eventToScenario.has(e)) {
                console.warn(`❌ Received non-existing event: '${e}'`);
                return;
            }

            const screenshot = await page.screenshot({
                omitBackground: false,
                optimizeForSpeed: false,
            });
            console.log(`Event '${e}' received`);

            results[eventToScenario.get(e)] = screenshot;

            /* Needs to be set after taking the screenshot to avoid
             * closing the browser too fast. */
            ++eventCount;
            /* Watching the scenario allows to debug it */
            state = e === config.watch ? WebRunnerState.Watching : state;
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

        console.log(`📷 Capturing scenarios...`);

        let time = 0;
        while (state === WebRunnerState.Running && eventCount < count && time < timeout) {
            const debounceTime = 1000;
            await new Promise((res) => setTimeout(res, debounceTime));
            time += debounceTime;
        }

        switch (state as WebRunnerState) {
            case WebRunnerState.Watching:
                console.log(`Watching scenario ${config.watch}...`);
                await page.waitForNavigation();
                break;
            case WebRunnerState.Error:
                /* @todo: Would be better to fail the test with the error,
                 * and let the runner go to the next project. */
                throw `Uncaught browser top-level error: ${error}`;
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
     * @returns An array containing indices of failed comparison.
     */
    private _compare(
        scenarios: Scenario[],
        screenshots: (Error | Image2d)[],
        references: (Error | Image2d)[]
    ) {
        console.log(`\n✏️  Comparing scenarios...`);

        // @todo: Move into worker
        const failed: number[] = [];
        for (let i = 0; i < screenshots.length; ++i) {
            const {event, tolerance, perPixelTolerance} = scenarios[i];

            const screenshot = screenshots[i];
            const reference = references[i];
            if (screenshot instanceof Error || reference instanceof Error) {
                failed.push(i);
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
                failed.push(i);
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

    /**
     * Save the captured references of a list of scenarios.
     *
     * @param config The configuration used to run the tests.
     * @param project The project associated to the scenario to save.
     * @param scenarios The list of scenarios to save.
     * @param pngs The list of pngs (one per scenario).
     * @returns A promise that resolves once all writes are done.
     */
    private async _save(project: Project, scenarios: Scenario[], pngs: (Buffer | Error)[]) {
        if (!scenarios.length) return;

        const config = this._config;

        console.log(`\n✏️  Saving scenario references...`);

        let output = null;
        if (config.output) {
            const folder = basename(project.path);
            output = join(config.output, folder);
            await mkdirp(output);
        }

        const promises = [];
        for (let i = 0; i < scenarios.length; ++i) {
            const data = pngs[i];
            if (data instanceof Error) continue;

            const scenario = scenarios[i];
            const path = output
                ? join(output, basename(scenario.reference))
                : scenario.reference;
            const summary = summarizePath(path);
            promises.push(
                writeFile(path, data)
                    .then(() => console.log(`Screenshot '${summary}' saved`))
                    .catch((e) =>
                        console.log(`❌ Failed to write png '${summary}'\n  ${e.reason}`)
                    )
            );
        }

        return Promise.all(promises);
    }
}

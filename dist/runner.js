import { createServer } from 'node:http';
import { cpus } from 'node:os';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join, basename, dirname } from 'node:path';
import { PNG } from 'pngjs';
import { launch as puppeteerLauncher, } from 'puppeteer-core';
import handler from 'serve-handler';
import pixelmatch from 'pixelmatch';
import { SaveMode, RunnerMode } from './config.js';
import { mkdirp, summarizePath } from './utils.js';
/**
 * Parse the buffer as a png.
 *
 * @param data The buffer to parse.
 * @returns The uncompressed image data.
 */
function parsePNG(data) {
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
async function loadReferences(scenarios) {
    const promises = scenarios.map(async (s) => {
        try {
            const expectedData = await readFile(s.reference);
            return parsePNG(expectedData);
        }
        catch (e) {
            return new Error(`Failed to open reference for scenario ${s.event}:\n  ${e.message}`);
        }
    });
    return Promise.all(promises);
}
function reduce(indices, array) {
    const result = new Array(indices.length).fill(null);
    for (let i = 0; i < indices.length; ++i) {
        result[i] = array[indices[i]];
    }
    return result;
}
/**
 * Test runner log level.
 */
export var LogLevel;
(function (LogLevel) {
    /** Display info logs */
    LogLevel[LogLevel["Info"] = 1] = "Info";
    /** Display warning logs */
    LogLevel[LogLevel["Warn"] = 2] = "Warn";
    /** Display error logs */
    LogLevel[LogLevel["Error"] = 4] = "Error";
})(LogLevel || (LogLevel = {}));
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
    logs = [];
    /** Configuration to run. */
    _config;
    /** Browser context debounce time. */
    _contextDebounce = 750;
    /** HTTP server callback. */
    _httpCallback = (req, response) => {
        const header = req.headers['test-project'] ?? '';
        const projectId = parseInt(Array.isArray(header) ? header[0] : header);
        if (isNaN(projectId))
            return handler(req, response);
        const project = this._config.projects[projectId];
        const path = resolve(project.path, 'deploy');
        return handler(req, response, { public: path });
    };
    /**
     * Create a new runner.
     *
     * @param config The configuration to run.
     */
    constructor(config) {
        this._config = config;
    }
    /**
     * Run the tests described in `config`.
     *
     * @returns `true` if all tests passed, `false` otherwise.
     */
    async run() {
        const config = this._config;
        const projects = config.projects;
        if (config.output)
            await mkdirp(config.output);
        this.logs = projects.map((_) => []);
        /* Start loading references for each project */
        const referencesPending = Array.from(config.projects, () => null);
        for (let i = 0; i < projects.length; ++i) {
            const project = projects[i];
            referencesPending[i] = loadReferences(project.scenarios);
        }
        const contextsUpperBound = config.maxContexts ?? Math.min(Math.max(2, cpus().length), 6);
        const contexts = Math.min(projects.length, contextsUpperBound);
        console.log('Information:\n' +
            `  ➡️  Web server port: ${config.port}\n` +
            `  ➡️  Projects count: ${config.projects.length}\n` +
            `  ➡️  Browser contexts: ${contexts}\n` +
            `  ➡️  Watching: ${config.watch}`);
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
        /* Start capturing screenshots for each project */
        const screenshotsPending = this._capture(browser, contexts);
        /* While we could wait simultaneously for screenshots and references, loading the pngs
         * should be must faster and be done by now anyway. */
        const references = await Promise.all(referencesPending);
        const pngs = await screenshotsPending;
        const screenshots = pngs.map((p) => p.map((s) => (s instanceof Error ? s : parsePNG(s))));
        server.close();
        browser.close();
        /* Compare screenshots to references */
        const failures = Array.from(projects, () => []);
        for (let i = 0; i < projects.length; ++i) {
            const { name, scenarios } = projects[i];
            const count = scenarios.length;
            console.log(`\n❔ Comparing ${count} scenarios in project '${name}'...`);
            if (config.mode !== RunnerMode.CaptureAndCompare)
                continue;
            failures[i] = this._compare(scenarios, screenshots[i], references[i]);
        }
        const success = failures.findIndex((a) => a.length) === -1;
        /* Save screenshots to disk based on the config saving mode */
        const { save } = config;
        let toSave = [];
        if (save === SaveMode.OnFailure) {
            toSave = projects.map((project, i) => {
                const failedScenarios = reduce(failures[i], project.scenarios);
                const failedPngs = reduce(failures[i], pngs[i]);
                return this._save(project, failedScenarios, failedPngs);
            });
        }
        else {
            toSave = projects.map((proj, i) => this._save(proj, proj.scenarios, pngs[i]));
        }
        if (save === SaveMode.All || (save === SaveMode.OnFailure && !success)) {
            console.log(`\n✏️  Saving scenario references...`);
        }
        await Promise.all(toSave);
        return success;
    }
    /**
     * Save the current logs at the specified path.
     *
     * @param path The path to save the log at.
     * @returns A promise that resolves once the file is saved.
     */
    async saveLogs(path) {
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
    async _capture(browser, contextsCount) {
        const { projects } = this._config;
        console.log(`\n📷 Capturing scenarios for ${projects.length} project(s)...`);
        const contexts = await Promise.all(Array.from({ length: contextsCount })
            .fill(null)
            .map((_) => browser.createIncognitoBrowserContext()));
        const result = Array.from(projects, () => null);
        for (let i = 0; i < projects.length; ++i) {
            let freeContext = -1;
            while ((freeContext = contexts.findIndex((x) => x !== null)) === -1) {
                /* Yield the event loop to allow checking for free contexts. */
                await new Promise((res) => setTimeout(res, this._contextDebounce));
            }
            const context = contexts[freeContext];
            if (context === null)
                throw new Error('null context');
            contexts[freeContext] = null; /* Marks context as used */
            result[i] = this._captureProjectScreenshots(context, i, projects[i]).finally(() => (contexts[freeContext] = context));
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
    async _captureProjectScreenshots(browser, projectId, { width, height }) {
        const config = this._config;
        const project = config.projects[projectId];
        const { scenarios, timeout } = project;
        const count = scenarios.length;
        const results = new Array(count).fill(null);
        const eventToScenario = new Map();
        for (let i = 0; i < count; ++i) {
            const event = scenarios[i].event;
            eventToScenario.set(event, i);
            results[i] = new Error(`event '${event}' wasn't dispatched`);
        }
        let eventCount = 0;
        let error = null;
        function onerror(err) {
            error = err;
        }
        const page = await browser.newPage();
        page.on('pageerror', onerror);
        page.on('error', onerror);
        page.on('console', (message) => {
            const msg = message.text();
            const type = message.type();
            const level = LogTypeToLevel[type];
            this.logs[projectId].push(`[${project.name}][${message.type()}] ${msg}`);
            if (this._config.log & level)
                console[type](`[browser] ${msg}`);
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
        async function processEvent(e) {
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
            console.error(`[${project.name}] Uncaught browser top-level error: ${errorStr}`);
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
    _compare(scenarios, screenshots, references) {
        // @todo: Move into worker
        const failed = [];
        for (let i = 0; i < screenshots.length; ++i) {
            const { event, tolerance, perPixelTolerance } = scenarios[i];
            const screenshot = screenshots[i];
            const reference = references[i];
            if (screenshot instanceof Error || reference instanceof Error) {
                failed.push(i);
                const msg = screenshot.message ?? reference.message;
                console.log(`❌ Scenario '${event}' failed with error:\n  ${msg}`);
                continue;
            }
            const { width, height } = screenshot;
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
    async _save(project, scenarios, pngs) {
        if (!scenarios.length)
            return;
        const config = this._config;
        let output = null;
        if (config.output) {
            const folder = basename(project.path);
            output = join(config.output, folder);
            await mkdirp(output);
        }
        const promises = [];
        for (let i = 0; i < scenarios.length; ++i) {
            const data = pngs[i];
            if (data instanceof Error)
                continue;
            const scenario = scenarios[i];
            const path = output
                ? join(output, basename(scenario.reference))
                : scenario.reference;
            const summary = summarizePath(path);
            promises.push(writeFile(path, data)
                .then(() => console.log(`Screenshot '${summary}' saved`))
                .catch((e) => console.log(`❌ Failed to write png '${summary}'\n  ${e.reason}`)));
        }
        return Promise.all(promises).then(() => { });
    }
}

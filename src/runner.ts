import {createServer} from 'node:http';
import {mkdir, readFile, stat, writeFile} from 'node:fs/promises';
import {resolve, join, basename} from 'node:path';

import {PNG} from 'pngjs';
import {launch as puppeteerLauncher, Browser} from 'puppeteer-core';
import {Launcher} from 'chrome-launcher';
import handler from 'serve-handler';

import {Config, Scenario, Project, SaveMode} from './config.js';
import {Dimensions, Image2d, compare} from './image.js';
import {summarizePath} from './utils.js';

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
                `Failed to open reference for scenario ${s.event}:\n\t${e.message}`
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

async function mkdirp(path: string) {
    try {
        const s = await stat(path);
        if (!s.isDirectory) {
            throw new Error(`directory '${path}' already exists`);
        }
    } catch (e) {
        return mkdir(path);
    }
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
    /** Base path to serve. @hidden */
    _currentBasePath = '';

    /**
     * Run the tests described in `config`.
     *
     * @param config The configuration to run.
     * @returns `true` if all tests passed, `false` otherwise.
     */
    async run(config: Config): Promise<boolean> {
        const server = createServer((request, response) => {
            return handler(request, response, {
                public: this._currentBasePath,
            });
        });
        server.listen(config.port);

        const executablePath = Launcher.getFirstInstallation();
        if (!executablePath) {
            server.close();
            throw new Error(
                'Could not automatically find any installation of Chrome using chrome-launcher. ' +
                    'Set the CHROME_PATH variable to help chrome-launcher find it'
            );
        }

        const browser = await puppeteerLauncher({
            headless: false,
            devtools: true,
            executablePath,
            waitForInitialPage: true,
        });

        let success = true;

        try {
            for (const project of config.projects) {
                /* We do not test multiple pages simultaneously to prevent
                 * the animation loop to stop. */
                const result = await this._runTests(config, project, browser);
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
     * Run the tests for a project.
     *
     * @param config The configuration to run.
     * @param project The project to run the scenarios from.
     * @param browser Browser instance.
     * @returns A promise that resolves to `true` if all tests passed,
     *     `false` otherwise.
     */
    async _runTests(config: Config, project: Project, browser: Browser): Promise<boolean> {
        this._currentBasePath = resolve(project.path, 'deploy');

        const scenarios = project.scenarios;
        const count = scenarios.length;

        console.log(`\n📎 Running project ${project.name} with ${count} scenarios\n`);

        if (config.output) {
            await mkdirp(config.output);
        }

        /* Load references first to validate their size. */
        const references = await loadReferences(scenarios);

        const first = references.find((img) => !(img instanceof Error)) as
            | Image2d
            | undefined;

        /* Capture page screenshots upon events coming from the application. */
        const pngs = await this._captureScreenshots(browser, config, project, {
            width: first?.width ?? config.width,
            height: first?.height ?? config.height,
        });

        const screenshots = pngs.map((s) => (s instanceof Error ? s : parsePNG(s)));

        console.log(`\n✏️  Comparing scenarios...`);

        // @todo: Move into worker
        const failed: number[] = [];
        let success = true;
        for (let i = 0; i < count; ++i) {
            const {event, tolerance, perPixelTolerance} = scenarios[i];

            const screenshot = screenshots[i];
            if (screenshot instanceof Error) {
                success = false;
                console.log(
                    `❌ Scenario '${event}' failed with error:\n\t${screenshot.message}`
                );
                continue;
            }

            const reference = references[i];
            if (reference instanceof Error) {
                success = false;
                failed.push(i);
                console.log(
                    `❌ Scenario '${event}' failed with error:\n\t${reference.message}`
                );
                continue;
            }

            const res = compare(screenshot, reference);
            const meanFailed = res.rmse > tolerance;
            const maxFailed = res.max > perPixelTolerance;
            if (meanFailed || maxFailed) {
                success = false;
                failed.push(i);
                console.log(`❌ Scenario '${event}' failed!`);
                console.log(`\trmse: ${res.rmse} | tolerance: ${tolerance}`);
                console.log(`\tmax: ${res.max} | tolerance: ${perPixelTolerance}`);
                continue;
            }

            console.log(`✅ Scenario ${event} passed!`);
        }

        switch (config.save) {
            case SaveMode.OnFailure: {
                const failedScenarios = reduce(failed, scenarios);
                const failedPngs = reduce(failed, pngs);
                await this._save(config, project, failedScenarios, failedPngs);
                break;
            }
            case SaveMode.All:
                await this._save(config, project, scenarios, pngs);
                break;
        }

        return success;
    }

    /**
     * Capture the screenshots for a project.
     *
     * @param config The runner configuration.
     * @param project The project to capture the screenshots from.
     * @param browser The browser instance.
     * @returns An array of promise that resolve with the data for loaded images,
     *    or errors for failed images.
     */
    async _captureScreenshots(
        browser: Browser,
        config: Config,
        project: Project,
        {width, height}: Dimensions
    ) {
        const scenarios = project.scenarios;
        const count = scenarios.length;
        const results: (Buffer | Error)[] = new Array(count).fill(null);

        const eventToScenario = new Map();
        for (let i = 0; i < count; ++i) {
            const event = scenarios[i].event;
            eventToScenario.set(event, i);
            results[i] = new Error(`event '${event}' wasn't dispatched`);
        }

        const page = await browser.newPage();
        page.on('error', (error: any) => {
            if (config.log & LogLevel.Error) console.error('[browser] ❌ ', error);
        });
        page.on('console', async (message: any) => {
            if (!(config.log & LogLevel.Info)) return;
            const args = await Promise.all(
                message.args().map((arg: any) => arg.jsonValue())
            );
            if (args.length) {
                console.log('[browser]', ...args);
            }
        });
        page.setViewport({width, height, deviceScaleFactor: 1});
        page.setCacheEnabled(false);

        /* We do not use waitUntil: 'networkidle0' in order to setup
         * the event sink before the project is fully loaded. */
        await page.goto(`http://localhost:${config.port}/index.html`);

        console.log(`📷 Capturing scenarios...`);

        let eventCount = 0;
        let watching = false;

        async function processEvent(e: string) {
            if (!eventToScenario.has(e)) {
                console.warn(`❌ Received non-existing event: '${e}'`);
                return;
            }

            const screenshot = await page.screenshot({omitBackground: true});
            console.log(`Event '${e}' received`);

            results[eventToScenario.get(e)] = screenshot;

            /* Needs to be set after taking the screenshot to avoid
             * closing the browser too fast. */
            ++eventCount;

            /* Watching the scenario allows to debug it */
            watching = e === config.watch;
        }

        await page.exposeFunction('testScreenshot', processEvent);

        /* The runner also supports scene loaded events, forwarded in the DOM.
         * Each time a load event occurs, we convert it to a unique event name and
         * forward the call to `testScreenshot`. */
        await page.evaluate(() => {
            document.addEventListener('wle-scene-ready', function (e) {
                // @ts-ignore
                window.testScreenshot(`wle-scene-ready:${e.detail.filename}`);
            });
        });

        let time = 0;
        while (!watching && eventCount < count && time < project.timeout) {
            const debounceTime = 1000;
            await new Promise((res) => setTimeout(res, debounceTime));
            time += debounceTime;
        }

        if (watching) {
            console.log(`Watching scenario ${config.watch}...`);
            await page.waitForNavigation();
        }

        await page.close();
        return results;
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
    private async _save(
        config: Config,
        project: Project,
        scenarios: Scenario[],
        pngs: (Buffer | Error)[]
    ) {
        if (!scenarios.length) return;

        console.log(`\n✏️  Saving scenario references...\n`);

        let output = null;
        if (config.output) {
            const folder = basename(project.path);
            output = join(config.output, folder);
            await mkdirp(output);
        }

        const promises = [];
        for (let i = 0; i < scenarios.length; ++i) {
            const data = pngs[i];
            const scenario = scenarios[i];
            const path = output
                ? join(output, basename(scenario.reference))
                : scenario.reference;
            const summary = summarizePath(path);
            promises.push(
                writeFile(path, data as Buffer)
                    .then(() => console.log(`Screenshot '${summary}' saved`))
                    .catch((e) =>
                        console.log(`❌ Failed to write png '${summary}'\n\t${e.reason}`)
                    )
            );
        }

        return Promise.all(promises);
    }
}

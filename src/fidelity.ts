import {createServer} from 'node:http';
import {readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';

import {PNG} from 'pngjs';
import {launch as puppeteerLauncher, Browser, Page} from 'puppeteer-core';
import {Launcher} from 'chrome-launcher';
import handler from 'serve-handler';

import {Image2d, compare} from './image.js';

/** Test scenario, mapping the runtime event to a reference. */
interface Scenario {
    event: string;
    reference: string;
    tolerance: number;
}

/** Project test configuration. */
interface Project {
    project: string;
    path: string;
    timeout: number;
    scenarios: Scenario[];
}

/** Raw scenario description from the configuration file. */
interface ScenarioJson extends Scenario {
    loadEvent: string;
}

function summarizePath(path: string): string {
    const paths = path.split('/');
    const last = paths.length - 1;
    if (last < 5) return path;
    return `${paths[0]}/.../${paths[last - 2]}/${paths[last - 1]}/${paths[last]}`;
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
                `Failed to open reference for scenario ${s.event}:\n\t${e.message}`
            );
        }
    });
    return Promise.all(promises);
}

/**
 * Trigger save for a list of references.
 *
 * @param indices Index list of scenarios to save.
 * @param scenarios The entire list of scenarios.
 * @param pngs The entire list of pngs (one per scenario).
 * @returns A promise that resolves once all writes are done or failed.
 */
function saveReferences(indices: number[], scenarios: Scenario[], pngs: Buffer[]) {
    const promises = [];
    for (const index of indices) {
        const data = pngs[index];
        const path = scenarios[index].reference;
        promises.push(writeFile(path, data as Buffer));
    }
    return Promise.allSettled(promises);
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
 * Configuration for {@link FidelityRunner}.
 */
export class Config {
    projects: Project[] = [];

    saveOnFailure = false;
    port: number = 8080;
    watch: string | null = null;
    log: LogLevel = LogLevel.Warn & LogLevel.Error;

    async add(configPath: string) {
        const configAbsPath = resolve(configPath);
        const data = await readFile(resolve(configPath), 'utf8');
        const {project, scenarios, timeout = 60000} = JSON.parse(data) as Project;

        const basePath = resolve(dirname(configPath));
        const path = resolve(basePath, dirname(project));

        this._validateScenarios(scenarios as ScenarioJson[]);

        const processedScenarios = (scenarios as ScenarioJson[]).map((s) => ({
            event: s.event ?? `wle-scene-loaded:${s.loadEvent}`,
            reference: resolve(basePath, s.reference),
            tolerance: 0.01,
        }));

        this.projects.push({
            project,
            timeout,
            path,
            scenarios: processedScenarios,
        });

        return configAbsPath;
    }

    /**
     * Get the scenario associated to an event.
     *
     * @param event The event.
     * @returns The scenario if found, `null` otherwise.
     */
    scenarioForEvent(event: string): Scenario | null {
        for (const project of this.projects) {
            const scenario = project.scenarios.find((s) => s.event === event);
            if (scenario) return scenario;
        }
        return null;
    }

    /**
     * Validate the list of scenarios.
     *
     * @note **Throws** if any of the scenario validation fails.
     *
     * @param scenarios The list of scenarios to validate.
     */
    _validateScenarios(scenarios: ScenarioJson[]) {
        /* Check the validity of each scenario */
        let error = '';
        for (const scenario of scenarios as ScenarioJson[]) {
            if (!scenario.event && !scenario.loadEvent) {
                error += `* Missing 'event' or 'loadEvent' key for scenario with reference: '${scenario.reference}'`;
            }
        }
        if (error) {
            throw new Error(error);
        }
    }
}

/**
 * Fidelity test suite runner.
 *
 * The fidelity runner is in charge of:
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
 * const runner = new FidelityRunner();
 * const success = runner.run(config);
 *
 * console.log(success ? 'Tests passed!' : 'Some test(s) failed!');
 * ```
 */
export class FidelityRunner {
    width: number = 640;
    height: number = 480;

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
                success &&= await this._runTests(config, project, browser);
            }
        } catch (e) {
            throw e;
        } finally {
            server.close();
            browser.close();
        }

        return success;
    }

    async _runTests(config: Config, project: Project, browser: Browser): Promise<boolean> {
        this._currentBasePath = resolve(project.path, 'deploy');

        const scenarios = project.scenarios;
        const count = scenarios.length;

        console.log(
            `📎 Running project ${project.project} with ${scenarios.length} scenarios\n`
        );

        /* Load references & capture screenshots simultaneously. */
        const [references, pngs] = await Promise.all([
            loadReferences(scenarios),
            this._captureScreenshots(config, project, browser),
        ]);
        const screenshots = pngs.map((s) => (s instanceof Error ? s : parsePNG(s)));

        console.log(`\n✏️  Comparing scenarios...\n`);

        // @todo: Move into worker
        const screenshotToSave: number[] = [];
        let success = true;
        for (let i = 0; i < count; ++i) {
            const {event, tolerance} = scenarios[i];

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
                screenshotToSave.push(i);
                console.log(
                    `❌ Scenario '${event}' failed with error:\n\t${reference.message}`
                );
                continue;
            }

            const rmse = compare(screenshot, reference);
            if (rmse > tolerance) {
                success = false;
                screenshotToSave.push(i);
                console.log(
                    `❌ Scenario '${event}' failed!\n\trmse: ${rmse} | tolerance: ${tolerance}`
                );
                continue;
            }

            console.log(`✅ Scenario ${event} passed!\n\trmse: ${rmse}`);
        }

        if (config.saveOnFailure && screenshotToSave.length > 0) {
            console.log(`\n✏️  Saving failed scenario references...\n`);

            const results = await saveReferences(
                screenshotToSave,
                scenarios,
                pngs as Buffer[]
            );
            for (let i = 0; i < results.length; ++i) {
                const res = results[i];
                const path = summarizePath(scenarios[screenshotToSave[i]].reference);
                if (res.status === 'rejected') {
                    console.log(`❌ Failed to write png '${path}'\n\t${res.reason}`);
                    continue;
                }
                console.log(`Screenshot '${path}' saved`);
            }
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
    async _captureScreenshots(config: Config, project: Project, browser: Browser) {
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
        page.setViewport({
            // @todo: This should be updated per-reference.
            width: this.width,
            height: this.height,
            deviceScaleFactor: 1,
        });

        /* We do not use waitUntil: 'networkidle0' in order to setup
         * the event sink before the project is fully loaded. */
        await page.goto(`http://localhost:${config.port}/index.html`);

        console.log(`\n📷 Capturing scenarios...\n`);

        let eventCount = 0;
        let watching = false;

        async function processEvent(e: string) {
            if (!eventToScenario.has(e)) {
                console.warn(`❌ Received non-existing event: '${e}'`);
                return;
            }

            const screenshot = await page.screenshot({omitBackground: true});
            console.log(`Screenshot captured successfully for event: '${e}'`);

            results[eventToScenario.get(e)] = screenshot;

            /* Needs to be set after taking the screenshot to avoid
             * closing the browser too fast. */
            ++eventCount;

            /* Watching the scenario allows to debug it */
            watching = e === config.watch;
        }

        await page.exposeFunction('fidelityScreenshot', processEvent);

        /* The runner also supports scene loaded events, forwarded in the DOM.
         * Each time a load event occurs, we convert it to a unique event name and
         * forward the call to `fidelityScreenshot`. */
        await page.evaluate(() => {
            document.addEventListener('wle-scene-loaded', function (e) {
                // @ts-ignore
                window.fidelityScreenshot(`wle-scene-loaded:${e.detail.filename}`);
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

        console.log('Closing page');

        await page.close();
        return results;
    }
}

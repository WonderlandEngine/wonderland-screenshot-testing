import {readFile, readdir, stat} from 'node:fs/promises';
import {basename, dirname, join, resolve} from 'node:path';

import {LogLevel} from './runner.js';
import {settlePromises, summarizePath} from './utils.js';

/**
 * Constants
 */

/** Default configuration filename. */
export const CONFIG_NAME = 'config.screenshot.json';

/** Save mode configuration. */
export enum SaveMode {
    /** Screenshots will not be saved. */
    None = 0,
    /** Screenshots will be saved only when a tests fail. */
    Failure = 1 << 0,
    /** All screenshots will be saved. */
    SuccessAndFailures = 1 << 1,
    /** Save image differences. */
    Difference = 1 << 2,
}

/** Test runner mode. */
export enum RunnerMode {
    /** Capture screenshots, but do not perform comparison. */
    Capture = 1,
    /** Capture screenshots and compare to references. */
    CaptureAndCompare = 2,
}

/** Test scenario configuration. */
export interface Scenario {
    event: string;
    reference: string;
    /**
     * Per-pixel threshold. Smaller values make the comparison more sensitive.
     * Should be in range [0; 1]. Defaults to 0.1
     */
    perPixelTolerance: number;
    /**
     * Percentage of failed pixels allowed.
     * Should be in range [0; 1]. Defaults to `0.005`, i.e., 0.5% error.
     */
    tolerance: number;
    /**
     * Scenario index.
     *
     * @note This isn't configurable by the user, but rather used internally.
     */
    index: number;
}

/** Project test configuration. */
export interface Project {
    path: string;
    name: string;
    timeout: number;
    /** Screenshot width. Defaults to **480**. */
    width: number;
    /** Screenshot height. Defaults to **270**. */
    height: number;
    scenarios: Scenario[];
}

/**
 * Convert the 'readyEvent' entry in a configuration
 * into a generic 'event'.
 *
 * @param event The ready event to convert.
 * @returns An event of the form `wle-scene-ready:${event}`.
 */
export function convertReadyEvent(event: string) {
    return `wle-scene-ready:${event}`;
}

/** Raw scenario description from the json file. */
interface ScenarioJson extends Scenario {
    readyEvent: string;
}

/**
 * Search for configuration files on the filesystem.
 *
 * @param directory The directory to start the search from.
 * @returns A promise that resolves to an array of configuration files.
 */
async function readConfigFiles(directory: string) {
    const search = async (path: string, out: string[]) => {
        /* Not using `recursive: true` to support older node versions */
        const files = await readdir(path, {withFileTypes: true});
        const promises: Promise<string[]>[] = [];
        for (const file of files) {
            if (file.isDirectory()) {
                promises.push(search(join(path, file.name), out));
            } else if (file.name.endsWith(CONFIG_NAME)) {
                out.push(join(path, file.name));
            }
        }
        return Promise.all(promises).then(() => out);
    };

    return search(directory, []);
}

/**
 * Configuration for {@link ScreenshotRunner}.
 */
export class Config {
    /** List of projects to test */
    projects: Project[] = [];

    /** Output folder. Outputs to reference file when not provided. */
    output: string | null = null;

    /** Test runner mode. */
    mode: RunnerMode = RunnerMode.CaptureAndCompare;

    /** Bitset to manage screenshots to save. */
    save: number = SaveMode.None;

    /** Web server port. */
    port: number = 8080;

    /** If `true`, open browser in headless mode. */
    headless: boolean = false;

    /** If `true`, open browser and await for navigation. */
    watch: boolean = false;

    /** Browser logs setup. */
    log: LogLevel = LogLevel.Warn | LogLevel.Error;

    /** Maximum number of browser contexts running simultaneously. */
    maxContexts: number | null = null;

    async load(path: string) {
        /* Find all config files to run. */
        const isDirectory = (await stat(path)).isDirectory();
        const files = isDirectory ? await readConfigFiles(path) : [path];

        const errors = (await settlePromises(files.map((c) => this.add(c)))).map((r) => {
            return `- Could not resolve configuration '${files[r.i]}', reason:\n  ${
                r.reason
            }`;
        });

        if (errors.length) throw errors.join('\n');
    }

    /**
     * Append a configuration.
     *
     * Using multiple configuration files allows to run the test suite
     * on multiple projects without restarting the browser.
     *
     * @param configPath Path to the configuration file.
     * @returns A promise that resolves once the configuration is loaded.
     */
    async add(configPath: string) {
        const data = await readFile(resolve(configPath), 'utf8');
        const json = JSON.parse(data) as Project;

        const {timeout = 60000} = json;
        const jsonScenarios = Array.isArray(json.scenarios)
            ? json.scenarios
            : [json.scenarios];

        const width = json.width ?? 480;
        const height = json.height ?? 270;

        const path = resolve(dirname(configPath));
        const name = basename(path);
        const scenarios = (jsonScenarios as ScenarioJson[]).map((s, index) => ({
            index,
            event: s.event ?? (s.readyEvent ? convertReadyEvent(s.readyEvent) : ''),
            reference: resolve(path, s.reference),
            tolerance: s.tolerance ?? 0.005,
            perPixelTolerance: s.perPixelTolerance ?? 0.1,
        }));

        this.projects.push({timeout, path, name, scenarios, width, height});
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
     * Validate the configuration of scenarios.
     *
     * @note **Throws** if the configuration is invalid.
     */
    async validate() {
        if (!this.projects.length) throw 'No configuration to test';

        for (const {name, scenarios} of this.projects) {
            if (!scenarios.length) throw `${name} has no scenarios`;

            /* Ensure all scenarios have an 'event' or 'readyEvent' key. */
            const eventErrors = scenarios
                .map((v, i) => {
                    if (v.event) return null;
                    return `  - Missing 'event' / 'readyEvent' keys for scenario ${i}`;
                })
                .filter((v) => v);

            if (eventErrors.length) {
                const errors = eventErrors.join('\n');
                throw `${name} contains scenario(s) with missing events:\n${errors}`;
            }

            /* Throws if any of the 'reference' path folder doesn't exist */

            const folderSet = new Set<string>();
            scenarios.forEach((s) => folderSet.add(dirname(s.reference)));
            const folders = Array.from(folderSet);

            const folderErrors = (
                await settlePromises(folders.map(async (dir) => stat(dir)))
            ).map((r) => `  - Missing ${summarizePath(folders[r.i])}`);

            if (folderErrors.length) {
                const errors = folderErrors.join('\n');
                throw `'${name}' contains scenario(s) with missing reference folder:\n${errors}`;
            }
        }
    }
}

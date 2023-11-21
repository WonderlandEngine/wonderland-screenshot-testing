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
    OnFailure = 1,
    /** Screenshots will be always be saved. */
    All = 2,
}

/** Test scenario configuration. */
export interface Scenario {
    event: string;
    reference: string;
    tolerance: number;
    perPixelTolerance: number;
}

/** Project test configuration. */
export interface Project {
    path: string;
    name: string;
    timeout: number;
    scenarios: Scenario[];
}

/** Raw scenario description from the json file. */
interface ScenarioJson extends Scenario {
    readyEvent: string;
}

/**
 * Search for configuration files on the filesystem.
 *
 * @param path The directory to start the search from.
 * @returns A promise that resolves to an array of configuration files.
 */
async function readConfigFiles(path: string) {
    const files = await readdir(path, {recursive: true});
    return files.filter((v) => v.endsWith(CONFIG_NAME)).map((v) => join(path, v));
}

/**
 * Configuration for {@link ScreenshotRunner}.
 */
export class Config {
    /** List of projects to test */
    projects: Project[] = [];

    /** Output folder. Outputs to reference file when not provided. */
    output: string | null = null;

    /** Whether to save the screenshots or not.  */
    save: SaveMode = SaveMode.None;

    /** Default screenshot width. */
    width = 480;
    /** Default screenshot height. */
    height = 270;

    /** Web server port. */
    port: number = 8080;

    /** Event to watch. If `null`, watching is disabled. */
    watch: string | null = null;

    /** Browser logs setup. */
    log: LogLevel = LogLevel.Warn & LogLevel.Error;

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

        const path = resolve(dirname(configPath));
        const name = basename(path);
        const scenarios = (jsonScenarios as ScenarioJson[]).map((s) => ({
            event: s.event ?? s.readyEvent ? `wle-scene-ready:${s.readyEvent}` : '',
            reference: resolve(path, s.reference),
            tolerance: s.tolerance ?? 1,
            perPixelTolerance: s.perPixelTolerance ?? 16,
        }));

        this.projects.push({timeout, path, name, scenarios});
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
        for (const {name, scenarios} of this.projects) {
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

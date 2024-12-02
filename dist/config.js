import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { LogLevel } from './runner.js';
import { settlePromises, summarizePath } from './utils.js';
/**
 * Constants
 */
/** Default configuration filename. */
export const CONFIG_NAME = 'config.screenshot.json';
/** Save mode configuration. */
export var SaveMode;
(function (SaveMode) {
    /** Screenshots will not be saved. */
    SaveMode[SaveMode["None"] = 0] = "None";
    /** Screenshots will be saved only when a tests fail. */
    SaveMode[SaveMode["Failure"] = 1] = "Failure";
    /** All screenshots will be saved. */
    SaveMode[SaveMode["SuccessAndFailures"] = 2] = "SuccessAndFailures";
    /** Save image differences. */
    SaveMode[SaveMode["Difference"] = 4] = "Difference";
})(SaveMode || (SaveMode = {}));
/** Test runner mode. */
export var RunnerMode;
(function (RunnerMode) {
    /** Capture screenshots, but do not perform comparison. */
    RunnerMode[RunnerMode["Capture"] = 1] = "Capture";
    /** Capture screenshots and compare to references. */
    RunnerMode[RunnerMode["CaptureAndCompare"] = 2] = "CaptureAndCompare";
})(RunnerMode || (RunnerMode = {}));
/**
 * Convert the 'readyEvent' entry in a configuration
 * into a generic 'event'.
 *
 * @param event The ready event to convert.
 * @returns An event of the form `wle-scene-ready:${event}`.
 */
export function convertReadyEvent(event) {
    return `wle-scene-ready:${event}`;
}
/**
 * Search for configuration files on the filesystem.
 *
 * @param directory The directory to start the search from.
 * @returns A promise that resolves to an array of configuration files.
 */
async function readConfigFiles(directory) {
    const search = async (path, out) => {
        /* Not using `recursive: true` to support older node versions */
        const files = await readdir(path, { withFileTypes: true });
        const promises = [];
        for (const file of files) {
            if (file.isDirectory()) {
                promises.push(search(join(path, file.name), out));
            }
            else if (file.name.endsWith(CONFIG_NAME)) {
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
    projects = [];
    /** Output folder. Outputs to reference file when not provided. */
    output = null;
    /** Test runner mode. */
    mode = RunnerMode.CaptureAndCompare;
    /** Bitset to manage screenshots to save. */
    save = SaveMode.None;
    /** Web server port. */
    port = 8080;
    /** If `true`, open browser in headless mode. */
    headless = false;
    /** If `true`, open browser and await for navigation. */
    watch = false;
    /** Browser logs setup. */
    log = LogLevel.Warn & LogLevel.Error;
    /** Maximum number of browser contexts running simultaneously. */
    maxContexts = null;
    async load(path) {
        /* Find all config files to run. */
        const isDirectory = (await stat(path)).isDirectory();
        const files = isDirectory ? await readConfigFiles(path) : [path];
        const errors = (await settlePromises(files.map((c) => this.add(c)))).map((r) => {
            return `- Could not resolve configuration '${files[r.i]}', reason:\n  ${r.reason}`;
        });
        if (errors.length)
            throw errors.join('\n');
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
    async add(configPath) {
        const data = await readFile(resolve(configPath), 'utf8');
        const json = JSON.parse(data);
        const { timeout = 60000 } = json;
        const jsonScenarios = Array.isArray(json.scenarios)
            ? json.scenarios
            : [json.scenarios];
        const width = json.width ?? 480;
        const height = json.height ?? 270;
        const path = resolve(dirname(configPath));
        const name = basename(path);
        const scenarios = jsonScenarios.map((s, index) => ({
            index,
            event: s.event ?? (s.readyEvent ? convertReadyEvent(s.readyEvent) : ''),
            reference: resolve(path, s.reference),
            tolerance: s.tolerance ?? 0.005,
            perPixelTolerance: s.perPixelTolerance ?? 0.1,
        }));
        this.projects.push({ timeout, path, name, scenarios, width, height });
    }
    /**
     * Get the scenario associated to an event.
     *
     * @param event The event.
     * @returns The scenario if found, `null` otherwise.
     */
    scenarioForEvent(event) {
        for (const project of this.projects) {
            const scenario = project.scenarios.find((s) => s.event === event);
            if (scenario)
                return scenario;
        }
        return null;
    }
    /**
     * Validate the configuration of scenarios.
     *
     * @note **Throws** if the configuration is invalid.
     */
    async validate() {
        if (!this.projects.length)
            throw 'No configuration to test';
        for (const { name, scenarios } of this.projects) {
            if (!scenarios.length)
                throw `${name} has no scenarios`;
            /* Ensure all scenarios have an 'event' or 'readyEvent' key. */
            const eventErrors = scenarios
                .map((v, i) => {
                if (v.event)
                    return null;
                return `  - Missing 'event' / 'readyEvent' keys for scenario ${i}`;
            })
                .filter((v) => v);
            if (eventErrors.length) {
                const errors = eventErrors.join('\n');
                throw `${name} contains scenario(s) with missing events:\n${errors}`;
            }
            /* Throws if any of the 'reference' path folder doesn't exist */
            const folderSet = new Set();
            scenarios.forEach((s) => folderSet.add(dirname(s.reference)));
            const folders = Array.from(folderSet);
            const folderErrors = (await settlePromises(folders.map(async (dir) => stat(dir)))).map((r) => `  - Missing ${summarizePath(folders[r.i])}`);
            if (folderErrors.length) {
                const errors = folderErrors.join('\n');
                throw `'${name}' contains scenario(s) with missing reference folder:\n${errors}`;
            }
        }
    }
}

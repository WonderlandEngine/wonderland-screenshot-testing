import {readFile, stat} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';

import {LogLevel} from './fidelity.js';
import {summarizePath} from './utils.js';

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
    maxThreshold: number;
}

/** Project test configuration. */
export interface Project {
    project: string;
    path: string;
    timeout: number;
    scenarios: Scenario[];
}

/** Raw scenario description from the json file. */
interface ScenarioJson extends Scenario {
    readyEvent: string;
}

/**
 * Configuration for {@link FidelityRunner}.
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

        const {project, timeout = 60000} = json;
        const scenarios = Array.isArray(json.scenarios) ? json.scenarios : [json.scenarios];

        const basePath = resolve(dirname(configPath));
        const path = resolve(basePath, dirname(project));

        const processedScenarios = (scenarios as ScenarioJson[]).map((s) => ({
            event: s.event ?? s.readyEvent ? `wle-scene-ready:${s.readyEvent}` : '',
            reference: resolve(basePath, s.reference),
            tolerance: s.tolerance ?? 1,
            maxThreshold: s.maxThreshold ?? 16,
        }));

        this.projects.push({
            project,
            timeout,
            path,
            scenarios: processedScenarios,
        });
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
        for (const {project, scenarios} of this.projects) {
            /* Ensure all scenarios have an 'event' or 'readyEvent' key. */
            const missingEventScenarios = scenarios
                .map((s, i) => (s.event ? null : i))
                .filter((v) => v !== null);

            if (missingEventScenarios.length > 0) {
                throw new Error(
                    `'${project}': Missing 'event' or 'readyEvent' key for scenarios: ${missingEventScenarios}`
                );
            }

            /* Throws if any of the 'reference' path folder doesn't exist */

            const folderSet = new Set<string>();
            scenarios.forEach((s) => folderSet.add(dirname(s.reference)));
            const folders = Array.from(folderSet);

            const stats = await Promise.allSettled(folders.map(async (dir) => stat(dir)));
            const errors = stats
                .map((r, i) => {
                    if (r.status === 'fulfilled') return null;
                    return `\n- Missing ${summarizePath(folders[i])}`;
                })
                .filter((v) => v !== null);

            if (!errors.length) continue;

            throw new Error(
                `'${project}' contains a scenario(s) with missing reference folder: ${errors}`
            );
        }
    }
}

import { LogLevel } from './runner.js';
/** Save mode configuration. */
export declare enum SaveMode {
    /** Screenshots will not be saved. */
    None = 0,
    /** Screenshots will be saved only when a tests fail. */
    OnFailure = 1,
    /** Screenshots will be always be saved. */
    All = 2
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
/**
 * Configuration for {@link ScreenshotRunner}.
 */
export declare class Config {
    /** List of projects to test */
    projects: Project[];
    /** Output folder. Outputs to reference file when not provided. */
    output: string | null;
    /** Whether to save the screenshots or not.  */
    save: SaveMode;
    /** Default screenshot width. */
    width: number;
    /** Default screenshot height. */
    height: number;
    /** Web server port. */
    port: number;
    /** Event to watch. If `null`, watching is disabled. */
    watch: string | null;
    /** Browser logs setup. */
    log: LogLevel;
    /**
     * Append a configuration.
     *
     * Using multiple configuration files allows to run the test suite
     * on multiple projects without restarting the browser.
     *
     * @param configPath Path to the configuration file.
     * @returns A promise that resolves once the configuration is loaded.
     */
    add(configPath: string): Promise<void>;
    /**
     * Get the scenario associated to an event.
     *
     * @param event The event.
     * @returns The scenario if found, `null` otherwise.
     */
    scenarioForEvent(event: string): Scenario | null;
    /**
     * Validate the configuration of scenarios.
     *
     * @note **Throws** if the configuration is invalid.
     */
    validate(): Promise<void>;
}

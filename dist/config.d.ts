import { LogLevel } from './runner.js';
/**
 * Constants
 */
/** Default configuration filename. */
export declare const CONFIG_NAME = "config.screenshot.json";
/** Save mode configuration. */
export declare enum SaveMode {
    /** Screenshots will not be saved. */
    None = 0,
    /** Screenshots will be saved only when a tests fail. */
    Failure = 1,
    /** All screenshots will be saved. */
    SuccessAndFailures = 2,
    /** Save image differences. */
    Difference = 4
}
/** Test runner mode. */
export declare enum RunnerMode {
    /** Capture screenshots, but do not perform comparison. */
    Capture = 1,
    /** Capture screenshots and compare to references. */
    CaptureAndCompare = 2
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
 * Configuration for {@link ScreenshotRunner}.
 */
export declare class Config {
    /** List of projects to test */
    projects: Project[];
    /** Output folder. Outputs to reference file when not provided. */
    output: string | null;
    /** Test runner mode. */
    mode: RunnerMode;
    /** Chrome extensions to load. */
    extensions: string[];
    /** Bitset to manage screenshots to save. */
    save: number;
    /** Web server port. */
    port: number;
    /** If `true`, open browser in headless mode. */
    headless: boolean;
    /** If `true`, open browser and await for navigation. */
    watch: boolean;
    /** Browser logs setup. */
    log: LogLevel;
    /** Maximum number of browser contexts running simultaneously. */
    maxContexts: number | null;
    load(path: string): Promise<void>;
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

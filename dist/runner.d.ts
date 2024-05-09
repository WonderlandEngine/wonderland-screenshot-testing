import { Config } from './config.js';
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
export declare enum LogLevel {
    /** Display info logs */
    Info = 1,
    /** Display warning logs */
    Warn = 2,
    /** Display error logs */
    Error = 4
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
export declare class ScreenshotRunner {
    /** Browser logs */
    logs: string[];
    /** Configuration to run. */
    private _config;
    /** Browser context debounce time. */
    private _contextDebounce;
    /** Dispatch an info log coming from the browser. */
    private _onBrowserInfoLog;
    /** HTTP server callback. */
    private _httpCallback;
    /**
     * Create a new runner.
     *
     * @param config The configuration to run.
     */
    constructor(config: Config);
    /**
     * Run the tests described in `config`.
     *
     * @returns `true` if all tests passed, `false` otherwise.
     */
    run(): Promise<boolean>;
    /**
     * Save the current logs at the specified path.
     *
     * @param path The path to save the log at.
     * @returns A promise that resolves once the file is saved.
     */
    saveLogs(path: string): Promise<void>;
    /**
     * Capture screenshots in a browser using one/multiple context(s).
     *
     * @param browser The browser instance.
     * @returns Array of screenshots **per** project.
     */
    private _capture;
    /**
     * Capture the screenshots for a project.
     *
     * @param project The project to capture the screenshots from.
     * @param browser The browser instance.
     * @returns An array of promise that resolve with the data for loaded images,
     *    or errors for failed images.
     */
    private _captureProjectScreenshots;
    /**
     * Compare screenshots against references.
     *
     * @param scenarios The scenarios to compare.
     * @param screenshots The generated screenshots.
     * @param references Reference images (golden) of each scenario.
     * @returns An array containing indices of failed comparison.
     */
    private _compare;
    /**
     * Save the captured references of a list of scenarios.
     *
     * @param config The configuration used to run the tests.
     * @param project The project associated to the scenario to save.
     * @param scenarios The list of scenarios to save.
     * @param pngs The list of pngs (one per scenario).
     * @returns A promise that resolves once all writes are done.
     */
    private _save;
}

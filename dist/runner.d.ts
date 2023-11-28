/// <reference types="node" resolution-mode="require"/>
import { Browser } from 'puppeteer-core';
import { Config, Project } from './config.js';
import { Dimensions } from './image.js';
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
    /** Configuration to run. @hidden */
    private _config;
    /** Base path to serve. @hidden */
    private _currentBasePath;
    /** Dispatch an info log coming from the browser. @hidden */
    private _onBrowserInfoLog;
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
     * Run the tests of a given project.
     *
     * @param project The project to run the scenarios from.
     * @param browser Browser instance.
     * @returns A promise that resolves to `true` if all tests passed,
     *     `false` otherwise.
     */
    _runTests(project: Project, browser: Browser): Promise<boolean>;
    /**
     * Capture the screenshots for a project.
     *
     * @param project The project to capture the screenshots from.
     * @param browser The browser instance.
     * @returns An array of promise that resolve with the data for loaded images,
     *    or errors for failed images.
     */
    _captureScreenshots(browser: Browser, project: Project, { width, height }: Dimensions): Promise<(Error | Buffer)[]>;
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

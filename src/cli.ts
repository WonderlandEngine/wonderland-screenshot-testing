#!/usr/bin/env node

import {resolve} from 'node:path';
import {parseArgs} from 'node:util';

import {CONFIG_NAME, Config, RunnerMode, SaveMode} from './config.js';
import {ScreenshotRunner} from './runner.js';
import {logError, logErrorExit} from './utils.js';

interface Arguments {
    /** Print help. */
    help?: boolean;
    /** Open the runner in headless mode. */
    headless?: boolean;
    /** Open the runner in watch mode. */
    watch?: boolean;
    /** Output folder. */
    output?: string;
    /** Save all captured screenshots. */
    save?: boolean;
    /** Path to store the logs. */
    logs?: string;
    /** Runner mode. */
    mode?: string;
    /** Chrome extensions to load. */
    extensions?: string;
    /** Maximum number of parralel browser instances. */
    'max-contexts'?: string;
    /** Save screenshots associated to failed tests. */
    'save-on-failure'?: boolean;
    /** Save image diff. */
    'save-difference'?: boolean;
}

/**
 * Constants
 */

const COMMAND_NAME = 'wle-screenshot-testing';

/**
 * Utils
 */

/** Print the command line help with arguments and options. */
function printHelp(summary = false) {
    if (!summary) {
        console.log(
            `${COMMAND_NAME}\n\n` + 'Screenshot test suite for WonderlandEngine projects\n'
        );
    }
    console.log(`USAGE: ${COMMAND_NAME} <PATH>`);
    console.log('\nOPTIONS:');
    console.log(
        '\t-o, --output:\tScreenshot output folder. Overwrites references by default\n' +
            '\t--mode:\tCapture and compare (`capture-and-compare`), or capture only (`capture`)\n' +
            '\t--max-contexts:\tMaximum number of parralel browser instances. Up to one per project.\n' +
            '\t--logs:\tPath to save the browser logs. Logs will be discarded if not provided\n' +
            '\t--extensions:\tPaths to Chrome extensions to load\n'
    );

    console.log('\nFLAGS:');
    console.log(
        '\t-h, --help:\tPrints help\n' +
            '\t-w, --watch:\tStart the runner in watch mode for debugging\n' +
            '\t-H, --headless:\tStart the runner in headless mode\n' +
            '\t--save:\tSave all test screenshots' +
            '\t--save-on-failure:\tOverwrites failed references with the test screenshot' +
            '\t--save-difference:\tSave image difference for failed tests'
    );
}

/**
 * Main
 */

let args: Arguments = null!;
let positionals: string[] = null!;

try {
    ({values: args, positionals} = parseArgs({
        options: {
            help: {type: 'boolean', short: 'h'},
            headless: {type: 'boolean', short: 'H'},
            watch: {type: 'boolean', short: 'w'},
            output: {type: 'string', short: 'o'},
            save: {type: 'boolean', short: 's'},
            logs: {type: 'string'},
            mode: {type: 'string', default: 'capture-and-compare'},
            extensions: {type: 'string'},
            'max-contexts': {type: 'string'},
            'save-on-failure': {type: 'boolean'},
            'save-difference': {type: 'boolean'},
        },
        allowPositionals: true,
    }));
} catch (e: any) {
    logError('Failed to parse command line arguments, reason:', e);
    printHelp(true);
    process.exit(1);
}

if (args.help) {
    printHelp();
    process.exit(0);
}

const maxContexts = args['max-contexts'] ? parseInt(args['max-contexts']) : null;

const config = new Config();
config.watch = args.watch ?? false;
config.headless = args.headless ?? false;
config.output = args.output ? resolve(args.output) : null;
config.mode =
    args.mode === 'capture-and-compare' ? RunnerMode.CaptureAndCompare : RunnerMode.Capture;
config.extensions = args.extensions?.split(',') ?? [];
config.maxContexts = maxContexts && !isNaN(maxContexts) ? maxContexts : null;
config.save |= args.save ? SaveMode.SuccessAndFailures : SaveMode.None;
config.save |= args['save-on-failure'] ? SaveMode.Failure : SaveMode.None;
config.save |= args['save-difference'] ? SaveMode.Difference : SaveMode.None;

try {
    await config.load(positionals[0] ?? CONFIG_NAME);
} catch (e) {
    logErrorExit('Failed to load configuration file(s), reason:', e);
}

try {
    await config.validate();
} catch (e) {
    logErrorExit('Configuration error(s) found:\n', e);
}

const runner = new ScreenshotRunner(config);

let exitCode = 0;
try {
    exitCode = (await runner.run()) ? 0 : 1;
} catch (e) {
    logErrorExit('Got an unexpected error while running the tests:', e);
}

try {
    if (args.logs) await runner.saveLogs(args.logs);
} catch (e) {
    logErrorExit('Failed to save browser logs, reason:', e);
}

process.exit(exitCode);

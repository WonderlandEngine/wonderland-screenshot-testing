#!/usr/bin/env node

import {resolve} from 'node:path';
import {parseArgs} from 'node:util';

import {CONFIG_NAME, Config, SaveMode, convertReadyEvent} from './config.js';
import {ScreenshotRunner} from './runner.js';
import {logError} from './utils.js';

interface Arguments {
    /** Print help. */
    help?: boolean;
    /** Watch a specific event. */
    watch?: string;
    /** Output folder. */
    output?: string;
    /** Save all captured screenshots. */
    save?: boolean;
    /** Overriding screenshot width */
    width?: string;
    /** Overriding screenshot height */
    height?: string;
    /** Save screenshots associated to failed tests. */
    'save-on-failure'?: boolean;
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
    console.log('\nFLAGS:');
    console.log(
        '\t-o, --output:\tScreenshot output folder. Overwrites references by default\n' +
            '\t--width:\tOverriding screenshot width\n' +
            '\t--height:\tOverriding screenshot height\n'
    );

    console.log('\nFLAGS:');
    console.log(
        '\t-h, --help:\tPrints help\n' +
            '\t-w, --watch:\tStart the runner in watch mode for debugging\n' +
            '\t--save:\tSave all test screenshots' +
            '\t--save-on-failure:\tOverwrites failed references with the test screenshot'
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
            watch: {type: 'string', short: 'w'},
            output: {type: 'string', short: 'o'},
            save: {type: 'boolean', short: 's'},
            width: {type: 'string'},
            height: {type: 'string'},
            'save-on-failure': {type: 'boolean'},
        },
        allowPositionals: true,
    }));
} catch (e: any) {
    console.error(e.message, '\n');
    printHelp(true);
    process.exit(1);
}

if (args.help) {
    printHelp();
    process.exit(0);
}

const config = new Config();
config.watch = args.watch ?? null;
config.output = args.output ? resolve(args.output) : null;
config.save = args['save-on-failure'] ? SaveMode.OnFailure : SaveMode.None;
config.save = args.save ? SaveMode.All : config.save;
try {
    const width = args.width ? parseInt(args.width) : null;
    const height = args.height ? parseInt(args.height) : null;
    if (width) config.width = width;
    if (height) config.height = height;
} catch (e) {
    logError('--width and --height must be integers');
    process.exit(1);
}

try {
    await config.load(positionals[0] ?? CONFIG_NAME);
} catch (e) {
    logError('Failed to load configuration file(s), reason:\n');
    console.error(e);
    process.exit(1);
}

try {
    await config.validate();
} catch (e) {
    logError('Configuration error(s) found:\n');
    console.error(e);
    process.exit(1);
}

if (config.watch) {
    const scenario =
        config.scenarioForEvent(config.watch) ??
        config.scenarioForEvent(convertReadyEvent(config.watch));
    if (!scenario) {
        logError(`Could not find scenario to watch: '${config.watch}`);
        process.exit(1);
    }
    config.watch = scenario.event;
}

const runner = new ScreenshotRunner();
const success = await runner.run(config);
process.exit(success ? 0 : 1);

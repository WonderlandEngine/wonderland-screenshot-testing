#!/usr/bin/env node
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { CONFIG_NAME, Config, SaveMode } from './config.js';
import { ScreenshotRunner } from './runner.js';
import { logError } from './utils.js';
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
        console.log(`${COMMAND_NAME}\n\n` + 'Screenshot test suite for WonderlandEngine projects\n');
    }
    console.log(`USAGE: ${COMMAND_NAME} <PATH>`);
    console.log('\nFLAGS:');
    console.log('\t-h, --help:\tPrints help\n' +
        '\t-w, --watch:\tStart the runner in watch mode for debugging\n' +
        '\t--save-on-failure:\tOverwrites failed references with the test screenshot');
}
/**
 * Main
 */
let args = null;
let positionals = null;
try {
    ({ values: args, positionals } = parseArgs({
        options: {
            help: { type: 'boolean', short: 'h' },
            watch: { type: 'string', short: 'w' },
            output: { type: 'string', short: 'o' },
            save: { type: 'boolean', short: 's' },
            'save-on-failure': { type: 'boolean' },
        },
        allowPositionals: true,
    }));
}
catch (e) {
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
    await config.load(positionals[0] ?? CONFIG_NAME);
}
catch (e) {
    logError('Failed to load configuration file(s), reason:\n');
    console.error(e);
    process.exit(1);
}
try {
    await config.validate();
}
catch (e) {
    logError('Configuration error(s) found:\n');
    console.error(e);
    process.exit(1);
}
if (config.watch && !config.scenarioForEvent(config.watch)) {
    logError(`Could not find scenario to watch: '${config.watch}`);
    process.exit(1);
}
const runner = new ScreenshotRunner();
const success = await runner.run(config);
process.exit(success ? 0 : 1);

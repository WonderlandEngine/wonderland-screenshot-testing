#!/usr/bin/env node
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { CONFIG_NAME, Config, RunnerMode, SaveMode, convertReadyEvent } from './config.js';
import { ScreenshotRunner } from './runner.js';
import { logError, logErrorExit } from './utils.js';
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
    console.log('\nOPTIONS:');
    console.log('\t-o, --output:\tScreenshot output folder. Overwrites references by default\n' +
        '\t--logs:\tPath to save the browser logs. Logs will be discarded if not provided\n' +
        '\t--width:\tOverriding screenshot width\n' +
        '\t--height:\tOverriding screenshot height\n');
    console.log('\nFLAGS:');
    console.log('\t-h, --help:\tPrints help\n' +
        '\t-w, --watch:\tStart the runner in watch mode for debugging\n' +
        '\t--save:\tSave all test screenshots' +
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
            logs: { type: 'string' },
            width: { type: 'string' },
            height: { type: 'string' },
            mode: { type: 'string', default: 'capture-and-compare' },
            'save-on-failure': { type: 'boolean' },
        },
        allowPositionals: true,
    }));
}
catch (e) {
    logError('Failed to parse command line arguments, reason:', e);
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
config.mode =
    args.mode === 'capture-and-compare' ? RunnerMode.CaptureAndCompare : RunnerMode.Capture;
try {
    const width = args.width ? parseInt(args.width) : null;
    const height = args.height ? parseInt(args.height) : null;
    if (width)
        config.width = width;
    if (height)
        config.height = height;
}
catch (e) {
    logErrorExit('--width and --height must be integers');
}
try {
    await config.load(positionals[0] ?? CONFIG_NAME);
}
catch (e) {
    logErrorExit('Failed to load configuration file(s), reason:', e);
}
try {
    await config.validate();
}
catch (e) {
    logErrorExit('Configuration error(s) found:\n', e);
}
if (config.watch) {
    const scenario = config.scenarioForEvent(config.watch) ??
        config.scenarioForEvent(convertReadyEvent(config.watch));
    if (!scenario) {
        logErrorExit(`Could not find scenario to watch: '${config.watch}`);
    }
    config.watch = scenario.event;
}
const runner = new ScreenshotRunner(config);
let exitCode = 0;
try {
    exitCode = (await runner.run()) ? 0 : 1;
}
catch (e) {
    logErrorExit('Got an unexpected error while running the tests:', e);
}
try {
    if (args.logs)
        await runner.saveLogs(args.logs);
}
catch (e) {
    logErrorExit('Failed to save browser logs, reason:', e);
}
process.exit(exitCode);

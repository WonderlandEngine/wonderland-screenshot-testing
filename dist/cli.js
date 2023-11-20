#!/usr/bin/env node
import { join, resolve } from 'node:path';
import { stat, readdir } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { Config, SaveMode } from './config.js';
import { ScreenshotRunner } from './runner.js';
/**
 * Constants
 */
const COMMAND_NAME = 'wle-screenshot-testing';
const CONFIG_NAME = 'config.screenshot.json';
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
/* Find all config files to run. */
const configPath = positionals[0] ?? CONFIG_NAME;
let configFiles = [];
if ((await stat(configPath)).isDirectory()) {
    configFiles = (await readdir(configPath, { recursive: true }))
        .filter((v) => v.endsWith(CONFIG_NAME))
        .map((v) => join(configPath, v));
}
else {
    configFiles.push(configPath);
}
const config = new Config();
config.watch = args.watch ?? null;
config.output = args.output ? resolve(args.output) : null;
config.save = args['save-on-failure'] ? SaveMode.OnFailure : SaveMode.None;
config.save = args.save ? SaveMode.All : config.save;
const promises = await Promise.allSettled(configFiles.map((c) => config.add(c)));
let configFailed = false;
for (let i = 0; i < promises.length; ++i) {
    const promise = promises[i];
    if (promise.status === 'fulfilled')
        continue;
    configFailed = true;
    console.error(`❌ Could not resolve configuration '${configFiles[i]}', reason:\n`);
    console.error(promise.reason);
}
if (configFailed) {
    process.exit(1);
}
try {
    await config.validate();
}
catch (e) {
    console.error(`❌ Configuration error(s) found:\n`);
    console.error(e);
    process.exit(1);
}
if (config.watch && !config.scenarioForEvent(config.watch)) {
    console.error(`❌ Could not find scenario to watch: '${config.watch}`);
    process.exit(1);
}
const runner = new ScreenshotRunner();
const success = await runner.run(config);
process.exit(success ? 0 : 1);

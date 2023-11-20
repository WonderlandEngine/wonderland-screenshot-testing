<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/WonderlandEngine/api/blob/master/img/wle-logo-horizontal-reversed-dark.png?raw=true">
  <source media="(prefers-color-scheme: light)" srcset="https://github.com/WonderlandEngine/api/blob/master/img/wle-logo-horizontal-reversed-light.png?raw=true">
  <source srcset="https://github.com/WonderlandEngine/api/blob/master/img/wle-logo-horizontal-reversed-light.png?raw=true">
  <img alt="Wonderland Engine Logo">
</picture>

# Wonderland Screenshot Testing

Tests runner helping to prevent visual regressions in Wonderland Engine projects.

Learn more about Wonderland Engine at [https://wonderlandengine.com](https://wonderlandengine.com).

## Usage

Install via `npm` or `yarn`:

```sh
npm i --save-dev @wonderlandengine/screenshot-testing
# or:
yarn add @wonderlandengine/screenshot-testing --D
```

Add a test script in the `package.json` file:

```json
{
    "scripts": {
        "test": "wle-fidelity path/to/config.fidelity.json"
    }
}
```

Alternatively, you can reference the binary using:

```sh
./node_modules/.bin/wle-fidely path/to/config.fidelity.json
```

For more information about the CLI, have a look at the [CLI Arguments](#cli-arguments) section.

By default, the **CLI** looks for a file named `config.screenshot.json` in the working directory.

## Basic Example

A simple setup contains a reference to compare to (`reference.png`), and a configuration file (`config.screenshot.json`):

```sh
MyWonderland.wlp
config.screenshot.json
deploy/
js/
test/
    reference.png
```

_config.screenshot.json_

```json
{
    "scenarios": {
        "readyEvent": "MyWonderland.bin",
        "reference": "./test/reference.png"
    }
}
```

The `readyEvent` is used to take the screenshot once the scene `MyWonderland.bin`
is loaded. The screenshot is then compared to the file `./test/reference.png`.

For more information about the configuration, have a look at the [Configuration File](#configuration-file) section.

## Configuration File

Every project must have a configuration file:

```json
{
    // If this timeout is reached, the test suite will fail.
    "timeout": 60000,

    "scenarios": [
        {
            // Default loading event: Wait for `MyScene.bin` to load
            "readyEvent": "MyScene.bin",
            // Reference image to compare against
            "reference": "./scene-loaded.png",
            // RMSE tolerance for the entire image
            "tolerance": 4,
            // Maximum authorized error per-pixel
            "maxThreshold": 16
        },
        {
            // Custom event sent from the application
            "event": "on-shoot",
            "reference": "./shoot.png"
        }
    ]
}
```

The test suite is made of multiple **scenarios**, associating a screenshot event
to a reference image:

* `readyEvent`: Event sent after a scene load
* `event`: Programmatic custom event coming from the project. For more information,
have a look at the [Project section](#project)
* `reference`: Path to the reference file, i.e., the ground truth image to compare against

## Custom Events

Screenshots are taken in an event-based fashion. The runner works in **three** steps:
1. Load and run the project
2. Listen for events coming from the project
3. Compare screenshots captured upon event to their reference

You can send events in your running application using:

_Application_

```js
/* The argument represents the event id.
 * The id must match the `event` field in the configuration. */

player.shoot();
await window.fidelityScreenshot('on-shoot');

game.showGameOver();
await window.fidelityScreenshot('gameover');
```

The `fidelityScreenshot` method returns a [Promise](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise). You
must wait until the promise resolves before taking another screenshot.

### Test Entry Point

In order to avoid mixing production & test code, it's advised to use a custom entry point (`index.js`)
with the test runner.

This custom entry point can then reference components for the sole purpose of testing, e.g.,

```js
if (isPlayerShooting()) {
    await window.fidelityScreenshot('on-shoot');
    console.log('Test screenshot captured!');
}
```

## CLI Arguments

|Argument|Type|Description|
|:--:|:--:|:--------------------|
|**--save-on-failure**|_Flag_|Overwrites failed reference(s) with the test(s) screenshot|
|**--save**|_Flag_|Save every screenshot|
|**-o, --output**|_Path_|Output folder for saved screenshots. References overwritten by default|
|**-w, --watch**|_String_|Event to watch, i.e., to freeze the runner on|

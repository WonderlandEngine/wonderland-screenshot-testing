<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/WonderlandEngine/api/blob/master/img/wle-logo-horizontal-reversed-dark.png?raw=true">
  <source media="(prefers-color-scheme: light)" srcset="https://github.com/WonderlandEngine/api/blob/master/img/wle-logo-horizontal-reversed-light.png?raw=true">
  <source srcset="https://github.com/WonderlandEngine/api/blob/master/img/wle-logo-horizontal-reversed-light.png?raw=true">
  <img alt="Wonderland Engine Logo">
</picture>

# Wonderland Engine Fidelity Tests

Fidelity tests runner helping to prevent visual regressions in Wonderland Engine projects.

Learn more about Wonderland Engine at [https://wonderlandengine.com](https://wonderlandengine.com).

## Usage

Install via `npm` or `yarn`:

```sh
npm i --save-dev @wonderlandengine/fidelity-test-runner
# or:
yarn add @wonderlandengine/fidelity-test-runner --D
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

### Configuration File

```json
{
    "project": "./path/to/Project.wlp",
    "timeout": 60000,
    "scenarios": [
        {
            "event": "post-scene-load",
            "reference": "./scene-loaded-correctly.png"
        },
        {
            "event": "on-shoot",
            "reference": "./shoot.png"
        }
    ]
}
```

* `event`: Event coming from the project, at runtime. For more information,
have a look at the [Project section](#project)
* `reference`: Path to the reference file, i.e., the ground truth image to compare against

### CLI Arguments

|Argument|Type|Description|
|:--:|:--:|:--------------------|
|**-w, --watch**|_String_|Event to watch, i.e., to freeze the runner on|
|**--save-on-failure**|_Flag_|Overwrites failed reference(s) with the test(s) screenshot|

## Project

Screenshots are taken on an event-based fashion. The runner works in **three** steps:
1. Load and run the project
2. Listen for events coming from the project (on the browser side)
3. Compare screenshot captured upon event to their reference

You can send events in your running application using:

```js
/* The argument represents the event id.
 * The id must match an entry in the configuration. */
await window.fidelityScreenshot('on-shoot');
```

The `fidelityScreenshot` method returns a [Promise](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise). You
must wait until the promise resolve before taking another screenshot.

### Test Entry Point

In order to avoid mixing production & test code, it's advised to use a custom entry point (`index.js`)
with the test runner.

This custom entry point can then reference components for the sole purpose of testing, e.g.,

```js
import {Component} from '@wonderlandengine/api';

export class FidelityTestComponent extends Component {

    update() {
        if (isPlayerShooting()) {
            window.fidelityScreenshot('on-shoot').then(() => {
                console.log('Test screenshot captured!');
            });
        }
    }

}
```

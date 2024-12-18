import { resolve } from "path";
/* Taken from:
 * https://github.com/meta-quest/immersive-web-emulator/blob/7abf503a42ac9d235351ca84d5bf9f3e06bb65de/src/devtool/js/devices.js
 *
 * This is required by `navigator.xr.isSessionSupported`, needing a device to resolve those promises.
 */
const Devices = [
    {
        id: 'Oculus Quest 2',
        name: 'Oculus Quest 2',
        shortName: 'Quest 2',
        profile: 'oculus-touch-v3',
        modes: ['inline', 'immersive-vr', 'immersive-ar'],
        headset: {
            hasPosition: true,
            hasRotation: true,
        },
        controllers: [
            {
                id: 'Oculus Touch V3 (Left)',
                buttonNum: 7,
                primaryButtonIndex: 1,
                primarySqueezeButtonIndex: 2,
                hasPosition: true,
                hasRotation: true,
                hasSqueezeButton: true,
                handedness: 'left',
            },
            {
                id: 'Oculus Touch V3 (Right)',
                buttonNum: 7,
                primaryButtonIndex: 1,
                primarySqueezeButtonIndex: 2,
                hasPosition: true,
                hasRotation: true,
                hasSqueezeButton: true,
                handedness: 'right',
            },
        ],
        polyfillInputMapping: {
            axes: [2, 3, 0, 1],
            buttons: [1, 2, null, 0, 3, 4, null],
        },
    }
];
/** Inject the WebXR specification polyfill */
export async function injectWebXRPolyfill(page) {
    /* Inject the Meta webxr polyfill */
    await page.addScriptTag({ path: resolve(import.meta.dirname, 'webxr-polyfill.js'), type: 'text/javascript' });
    /* Meta's webxr polyfill is tightly coupled with the extension.
     * The polyfill listens to event sent by the dev tools to work properly. */
    return page.evaluate((device) => {
        window.dispatchEvent(new CustomEvent('pa-device-init', {
            detail: {
                deviceDefinition: device
            }
        }));
    }, Devices[0]);
}

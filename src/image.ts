/** Dimension type */
export interface Dimensions {
    /** Dimension width */
    width: number;
    /** Dimension height */
    height: number;
}

/** Basic 2d image type */
export type Image2d = Dimensions & {
    /** Pixel data */
    data: Uint8ClampedArray;
};

/** Difference color */
const DIFF_COLOR = [255, 0, 255];

/**
 * Generate a difference image between two images.
 *
 * The generated diff is the linear difference between the two images.
 *
 * The result will contain pink pixels where differences are found.
 * Stronger differences will be represented as stronger shade of pink.
 *
 * @param value The image to compare
 * @param expected The expected image
 * @returns A Uint8ClampedArray, containing the image to compare with pinkish
 *     pixels, where errors have been found
 */
export function generateImageDiff(value: Image2d, expected: Image2d) {
    const result = new Uint8ClampedArray(value.data.length);
    for (let i = 0; i < value.data.length; i += 4) {
        const r = value.data[i];
        const g = value.data[i + 1];
        const b = value.data[i + 2];
        const alphaR = Math.abs(r - expected.data[i]) / 255.0;
        const alphaG = Math.abs(g - expected.data[i + 1]) / 255.0;
        const alphaB = Math.abs(b - expected.data[i + 2]) / 255.0;
        result[i] = r * (1.0 - alphaR) + alphaR * DIFF_COLOR[0];
        result[i + 1] = g * (1.0 - alphaG) + alphaG * DIFF_COLOR[1];
        result[i + 2] = b * (1.0 - alphaB) + alphaB * DIFF_COLOR[2];
        result[i + 3] = 255;
    }
    return result;
}

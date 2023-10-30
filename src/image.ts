export interface Image2d {
    width: number;
    height: number;
    data: Uint8ClampedArray;
}

function basicSquareErrorDistance(
    data: Uint8ClampedArray,
    expected: Uint8ClampedArray,
    index: number
): number {
    const r = expected[index] - data[index];
    const g = expected[index + 1] - data[index + 1];
    const b = expected[index + 2] - data[index + 2];
    const a = expected[index + 3] - data[index + 3];
    return r * r + g * g + b * b + a * a;
}

/**
 * Compare two images.
 *
 * @param image The image to compare.
 * @param expected The reference to compare against.
 * @returns The root mean square error.
 */
export function compare(image: Image2d, expected: Image2d) {
    const {width, height} = image;
    if (width !== expected.width || height !== expected.height) {
        throw new Error(
            `image has dimensions ${width}x${height},` +
                `but expected dimensions ${expected.width}x${expected.height}`
        );
    }

    const pixels = width * height;
    let squareSum = 0;
    for (let i = 0; i < pixels; ++i) {
        /* For now, we use a basic error metric. We could eventually allow
         * using a perceptual metric. */
        squareSum += basicSquareErrorDistance(image.data, expected.data, i * 4);
    }

    /* Basic rmse for now */
    return Math.sqrt(squareSum / pixels);
}

export interface Dimensions {
    width: number;
    height: number;
}

export type Image2d = Dimensions & {
    data: Uint8ClampedArray;
};

const DIFF_COLOR = [255, 0, 255];

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

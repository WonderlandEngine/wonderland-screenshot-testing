export interface Dimensions {
    width: number;
    height: number;
}
export type Image2d = Dimensions & {
    data: Uint8ClampedArray;
};
/**
 * Compare two images.
 *
 * @param image The image to compare.
 * @param expected The reference to compare against.
 * @returns The root mean square error.
 */
export declare function compare(image: Image2d, expected: Image2d): {
    rmse: number;
    max: number;
};

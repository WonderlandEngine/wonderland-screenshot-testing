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

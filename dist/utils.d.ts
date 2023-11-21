/**
 * Summarize a path into '/path/<...>/to/something.
 *
 * @param path The path to summarize.
 * @returns A string representing a summary of the path.
 */
export declare function summarizePath(path: string): string;
/**
 * Filter out succeeded promise results.
 *
 * @param promises The promise list to filter.
 * @returns An array containing only rejected promises reason.
 */
export declare function settlePromises(promises: Promise<unknown>[]): Promise<{
    i: number;
    reason: any;
}[]>;
/**
 * Log an error on stderr.
 *
 * @param msg Message to log.
 */
export declare function logError(msg: any): void;

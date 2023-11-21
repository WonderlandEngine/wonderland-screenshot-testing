/**
 * Summarize a path into '/path/<...>/to/something.
 *
 * @param path The path to summarize.
 * @returns A string representing a summary of the path.
 */
export function summarizePath(path: string): string {
    const paths = path.split('/');
    const last = paths.length - 1;
    if (last < 5) return path;

    const head = paths[0] ? paths[0] : `${paths[0]}/${paths[1]}`;
    const tail = `${paths[last - 2]}/${paths[last - 1]}/${paths[last]}`;
    return `${head}/<...>/${tail}`;
}

/**
 * Filter out succeeded promise results.
 *
 * @param promises The promise list to filter.
 * @returns An array containing only rejected promises reason.
 */
export async function settlePromises(
    promises: Promise<unknown>[]
): Promise<{i: number; reason: any}[]> {
    const results = await Promise.allSettled(promises);
    return results
        .map((r, i) => (r.status === 'rejected' ? {i, reason: r.reason} : null))
        .filter((v) => v !== null) as {i: number; reason: any}[];
}

/**
 * Log an error on stderr.
 *
 * @param msg Message to log.
 */
export function logError(msg: any) {
    console.error(`\x1b[31m${msg}\x1b[0m`);
}

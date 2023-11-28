import {mkdir, stat} from 'node:fs/promises';

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
 * Make directory if doesn't exist.
 *
 * @param path The path to make.
 * @returns A promise that resolves once the directory is created.
 */
export async function mkdirp(path: string) {
    try {
        const s = await stat(path);
        if (!s.isDirectory) {
            throw new Error(`directory '${path}' already exists`);
        }
    } catch (e) {
        return mkdir(path);
    }
}

/**
 * Log an error on stderr.
 *
 * @param msg Message to log.
 * @param error The error content to log.
 */
export function logError(msg: any, error?: any) {
    console.error(`\x1b[31m${msg}\x1b[0m`);
    if (error) console.error(error);
}

/**
 * Log an error on stderr and exit the process with return code`1`.
 *
 * @param msg Message to log.
 * @param error The error content to log.
 */
export function logErrorExit(msg: any, error?: any): never {
    logError(msg, error);
    process.exit(1);
}

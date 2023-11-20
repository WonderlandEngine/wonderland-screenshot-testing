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

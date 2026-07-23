/**
 * ReplacementChunk interface representing a single block edit.
 */
export interface ReplacementChunk {
    startLine: number;
    endLine: number;
    targetContent: string;
    replacementContent: string;
}

/**
 * Helper class for validating line boundaries and applying text replacements.
 */
export class FileReplacementHelper {
    /**
     * Applies a list of replacement chunks to file lines content in descending order.
     * @param lines Array of file lines.
     * @param chunks Array of replacement chunks.
     * @param filePath Relative or absolute path for error formatting.
     * @returns Result string containing error details or empty string on success.
     */
    static applyChunks(lines: string[], chunks: ReplacementChunk[], filePath: string): string {
        const sortedChunks = [...chunks].sort((a, b) => b.startLine - a.startLine);

        for (let i = 0; i < sortedChunks.length; i++) {
            const chunk = sortedChunks[i];
            const startIdx = chunk.startLine - 1;
            const endIdx = chunk.endLine - 1;

            if (startIdx < 0 || endIdx >= lines.length || startIdx > endIdx) {
                return `Error in chunk ${i + 1}: Line range [${chunk.startLine}, ${chunk.endLine}] is out of bounds for file ${filePath} (total lines: ${lines.length}).`;
            }

            const targetLinesFromFile = lines.slice(startIdx, endIdx + 1);
            const fileBlockNormalized = targetLinesFromFile.join('\n');
            const targetContentNormalized = chunk.targetContent.replace(/\r?\n/g, '\n');

            if (fileBlockNormalized !== targetContentNormalized) {
                return `Error in chunk ${i + 1} at lines ${chunk.startLine}-${chunk.endLine}: Content does not match the targetContent exactly.\n` +
                       `Expected:\n${targetContentNormalized}\n\n` +
                       `Found in file:\n${fileBlockNormalized}`;
            }

            const replacementLines = chunk.replacementContent.split(/\r?\n/);
            lines.splice(startIdx, targetLinesFromFile.length, ...replacementLines);
        }

        return '';
    }
}

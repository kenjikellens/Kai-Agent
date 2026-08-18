/**
 * Helper service providing fuzzy line matching and actionable error feedback for file editing tools.
 * Helps AI agents immediately recover from small indentation, whitespace, or line drift mismatches.
 */
export class FuzzyMatchHelper {
    /**
     * Normalizes a string by trimming whitespace on every line and converting CRLF to LF.
     * @param text Raw text block.
     * @returns Normalized text string.
     */
    public static normalizeWhitespace(text: string): string {
        return text
            .split(/\r?\n/)
            .map(line => line.trim())
            .join('\n');
    }

    /**
     * Computes similarity score between 0.0 and 1.0 using Levenshtein distance on normalized strings.
     * @param str1 First string.
     * @param str2 Second string.
     * @returns Similarity score between 0 (completely different) and 1 (identical).
     */
    public static calculateSimilarity(str1: string, str2: string): number {
        const s1 = this.normalizeWhitespace(str1);
        const s2 = this.normalizeWhitespace(str2);
        if (s1 === s2) return 1.0;
        if (!s1 || !s2) return 0.0;

        const len1 = s1.length;
        const len2 = s2.length;
        const maxLen = Math.max(len1, len2);
        if (maxLen === 0) return 1.0;

        // Bounded matrix for edit distance
        const dp: number[] = Array(len2 + 1).fill(0);
        for (let j = 0; j <= len2; j++) {
            dp[j] = j;
        }

        for (let i = 1; i <= len1; i++) {
            let prev = dp[0];
            dp[0] = i;
            for (let j = 1; j <= len2; j++) {
                const temp = dp[j];
                if (s1[i - 1] === s2[j - 1]) {
                    dp[j] = prev;
                } else {
                    dp[j] = 1 + Math.min(prev, dp[j], dp[j - 1]);
                }
                prev = temp;
            }
        }

        const distance = dp[len2];
        return Math.max(0, (maxLen - distance) / maxLen);
    }

    /**
     * Finds the best matching line range in a file for a given target content block.
     * @param fileLines Array of all lines in the file.
     * @param targetContent Expected target content block.
     * @param hintStartLine Optional 1-indexed start line hint.
     * @param hintEndLine Optional 1-indexed end line hint.
     * @returns Best matching range metadata with 1-indexed line numbers and match score.
     */
    public static findBestMatchingRange(
        fileLines: string[],
        targetContent: string,
        hintStartLine?: number,
        hintEndLine?: number
    ): { startLine: number; endLine: number; score: number; content: string } | null {
        if (!fileLines.length || !targetContent.trim()) {
            return null;
        }

        const targetLines = targetContent.split(/\r?\n/);
        const targetLen = Math.max(1, targetLines.length);

        let bestScore = -1;
        let bestStart = 1;
        let bestEnd = Math.min(fileLines.length, targetLen);

        // Allow window sizes from targetLen - 2 to targetLen + 2
        const minWindow = Math.max(1, targetLen - 2);
        const maxWindow = Math.min(fileLines.length, targetLen + 2);

        // First search within a radius around hint line bounds if provided
        const checkRanges: { start: number; end: number }[] = [];
        if (hintStartLine && hintStartLine >= 1 && hintStartLine <= fileLines.length) {
            const startHint = hintStartLine - 1;
            const endHint = (hintEndLine && hintEndLine >= hintStartLine && hintEndLine <= fileLines.length)
                ? hintEndLine - 1
                : startHint + targetLen;

            const searchStart = Math.max(0, startHint - 35);
            const searchEnd = Math.min(fileLines.length, endHint + 35);
            checkRanges.push({ start: searchStart, end: searchEnd });
        }
        // Also check the rest of the file
        checkRanges.push({ start: 0, end: fileLines.length });

        const evaluatedSpans = new Set<string>();

        for (const range of checkRanges) {
            for (let w = minWindow; w <= maxWindow; w++) {
                for (let i = range.start; i <= range.end - w; i++) {
                    const key = `${i}-${w}`;
                    if (evaluatedSpans.has(key)) continue;
                    evaluatedSpans.add(key);

                    const candidateLines = fileLines.slice(i, i + w);
                    const candidateText = candidateLines.join('\n');
                    const score = this.calculateSimilarity(candidateText, targetContent);

                    if (score > bestScore) {
                        bestScore = score;
                        bestStart = i + 1;
                        bestEnd = i + w;
                    }
                }
            }
            if (bestScore > 0.85) {
                break;
            }
        }

        if (bestScore <= 0.25) {
            return null;
        }

        const matchedLines = fileLines.slice(bestStart - 1, bestEnd);
        return {
            startLine: bestStart,
            endLine: bestEnd,
            score: bestScore,
            content: matchedLines.join('\n')
        };
    }

    /**
     * Formats actionable error feedback with exact file line contents and recovery hints.
     * @param filePath Relative or absolute path of the target file.
     * @param requestedRange 1-indexed requested start and end lines.
     * @param expectedContent Expected target content supplied by caller.
     * @param fileLines Array of all lines in the file.
     * @returns Formatted recovery message string.
     */
    public static formatMismatchFeedback(
        filePath: string,
        requestedRange: { startLine: number; endLine: number },
        expectedContent: string,
        fileLines: string[]
    ): string {
        const { startLine, endLine } = requestedRange;
        const totalLines = fileLines.length;

        let output = `Error in replacement at lines ${startLine}-${endLine} of ${filePath}:\n`;
        output += `The specified content does not match the actual file content.\n\n`;

        output += `[Expected targetContent]:\n${expectedContent}\n\n`;

        if (startLine >= 1 && startLine <= totalLines) {
            const safeEnd = Math.min(totalLines, Math.max(startLine, endLine));
            const actualLines = fileLines.slice(startLine - 1, safeEnd);
            const actualNumbered = actualLines
                .map((line, idx) => `${startLine + idx}: ${line}`)
                .join('\n');

            output += `[Actual content in file at lines ${startLine}-${safeEnd}]:\n${actualNumbered}\n\n`;
        }

        // Find closest match in the file
        const bestMatch = this.findBestMatchingRange(fileLines, expectedContent, startLine, endLine);
        if (bestMatch && (bestMatch.startLine !== startLine || bestMatch.endLine !== endLine || bestMatch.score < 0.99)) {
            const matchLines = fileLines.slice(bestMatch.startLine - 1, bestMatch.endLine);
            const matchNumbered = matchLines
                .map((line, idx) => `${bestMatch.startLine + idx}: ${line}`)
                .join('\n');

            const scorePercent = Math.round(bestMatch.score * 100);
            output += `[Auto-Recovery Hint]: Closest match found at lines ${bestMatch.startLine}-${bestMatch.endLine} (similarity: ${scorePercent}%):\n`;
            output += `${matchNumbered}\n\n`;
            output += `To fix this, update your tool call parameters with startLine: ${bestMatch.startLine}, endLine: ${bestMatch.endLine} and the exact lines above.`;
        }

        return output.trim();
    }

    /**
     * Formats search mismatch feedback for edit_file tool.
     * @param filePath Relative or absolute path of the target file.
     * @param searchStr Search string that could not be matched.
     * @param fileLines Array of all lines in the file.
     * @returns Formatted recovery message string.
     */
    public static formatSearchMismatchFeedback(
        filePath: string,
        searchStr: string,
        fileLines: string[]
    ): string {
        let output = `Error: Exact search block was not found in file: ${filePath}.\n\n`;
        output += `[Search Block]:\n${searchStr}\n\n`;

        const bestMatch = this.findBestMatchingRange(fileLines, searchStr);
        if (bestMatch) {
            const matchLines = fileLines.slice(bestMatch.startLine - 1, bestMatch.endLine);
            const matchNumbered = matchLines
                .map((line, idx) => `${bestMatch.startLine + idx}: ${line}`)
                .join('\n');

            const scorePercent = Math.round(bestMatch.score * 100);
            output += `[Auto-Recovery Hint]: Closest matching section found at lines ${bestMatch.startLine}-${bestMatch.endLine} (similarity: ${scorePercent}%):\n`;
            output += `${matchNumbered}\n\n`;
            output += `Use replace_file_content with startLine: ${bestMatch.startLine}, endLine: ${bestMatch.endLine} and the exact lines shown above.`;
        }

        return output.trim();
    }
}

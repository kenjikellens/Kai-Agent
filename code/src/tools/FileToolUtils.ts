import * as fs from 'fs';
import * as path from 'path';

/**
 * Utility functions for file system operations in agent tools.
 */
export class FileToolUtils {
    /**
     * Verifies if a resolved file path exists.
     * @param targetPath Absolute target path.
     * @param relativePath Original relative path.
     * @returns Error message string if file does not exist, or null if file exists.
     */
    static checkFileExists(targetPath: string, relativePath: string): string | null {
        if (!fs.existsSync(targetPath)) {
            return `File does not exist: ${relativePath}`;
        }
        return null;
    }

    /**
     * Recursively creates parent directory if it does not exist.
     * @param targetPath Absolute file path.
     */
    static async ensureParentDirExists(targetPath: string): Promise<void> {
        const parentDir = path.dirname(targetPath);
        if (!fs.existsSync(parentDir)) {
            await fs.promises.mkdir(parentDir, { recursive: true });
        }
    }
}

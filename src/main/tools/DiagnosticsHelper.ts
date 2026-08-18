import * as path from 'path';
import * as fs from 'fs';

/**
 * Service for capturing diagnostics after file edits in standalone desktop mode.
 */
export class DiagnosticsHelper {
    /**
     * Retrieves a compact diagnostics note for modified workspace files.
     * @param targetFilePath Relative or absolute path of the modified file.
     * @param workspacePath Workspace root path.
     * @param isNewFile Whether the file was newly created.
     * @returns Formatted diagnostics note string or empty string if no issues exist.
     */
    public static async getPostEditDiagnosticsNote(
        targetFilePath: string,
        workspacePath: string,
        _isNewFile: boolean = false
    ): Promise<string> {
        try {
            const absolutePath = path.isAbsolute(targetFilePath)
                ? targetFilePath
                : path.join(workspacePath, targetFilePath);

            if (!fs.existsSync(absolutePath)) {
                return '';
            }

            // Standalone mode syntax validation for common file types (JSON, etc.)
            if (targetFilePath.endsWith('.json')) {
                try {
                    const content = fs.readFileSync(absolutePath, 'utf8');
                    JSON.parse(content);
                } catch (e: any) {
                    return `\n[Diagnostics note]: errors: [${targetFilePath}: Invalid JSON syntax - ${e.message}]`;
                }
            }

            return '';
        } catch {
            return '';
        }
    }

    /**
     * Formats error and warning arrays into a concise single-line note.
     * @param errors Array of formatted error strings.
     * @param warnings Array of formatted warning strings.
     * @returns Formatted diagnostics note.
     */
    public static formatDiagnosticsNote(errors: string[], warnings: string[]): string {
        if (errors.length === 0 && warnings.length === 0) {
            return '';
        }

        const parts: string[] = [];
        if (errors.length > 0) {
            const errorList = errors.slice(0, 5).join(', ');
            const errorSuffix = errors.length > 5 ? ` (+${errors.length - 5} more)` : '';
            parts.push(`errors: [${errorList}${errorSuffix}]`);
        }

        if (warnings.length > 0) {
            const warningList = warnings.slice(0, 3).join(', ');
            const warningSuffix = warnings.length > 3 ? ` (+${warnings.length - 3} more)` : '';
            parts.push(`warnings: [${warningList}${warningSuffix}]`);
        }

        return `\n[Diagnostics note]: ${parts.join(' ')}`;
    }
}

import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Service for capturing, waiting for, and formatting compiler/linter diagnostics
 * after file edits so the AI agent can self-heal type and syntax errors.
 */
export class DiagnosticsHelper {
    /**
     * Retrieves a compact diagnostics note for modified and open workspace files.
     * Polls the VS Code language server up to 1.5s to ensure diagnostics are up-to-date.
     * @param targetFilePath Relative or absolute path of the modified file.
     * @param workspacePath Workspace root path.
     * @param isNewFile Whether the file was newly created and needs explicit indexing.
     * @returns Formatted diagnostics note string or empty string if no issues exist.
     */
    public static async getPostEditDiagnosticsNote(
        targetFilePath: string,
        workspacePath: string,
        isNewFile: boolean = false
    ): Promise<string> {
        try {
            const absolutePath = path.isAbsolute(targetFilePath)
                ? targetFilePath
                : path.join(workspacePath, targetFilePath);

            const fileUri = vscode.Uri.file(absolutePath);

            // Index new files in the language server
            if (isNewFile) {
                try {
                    await vscode.workspace.openTextDocument(fileUri);
                } catch {
                    // ignore open document errors
                }
            }

            // Poll the language server briefly to allow AST recalculation
            const maxWaitMs = 1500;
            const pollIntervalMs = 150;
            const startTime = Date.now();

            let targetDiagnostics: vscode.Diagnostic[] = [];

            while (Date.now() - startTime < maxWaitMs) {
                targetDiagnostics = vscode.languages.getDiagnostics(fileUri) || [];
                // If diagnostics appeared or we waited at least 300ms, proceed
                if (targetDiagnostics.length > 0 || (Date.now() - startTime >= 300)) {
                    break;
                }
                await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
            }

            // Gather all relevant URIs (target file + open workspace documents for cascade errors)
            const uriSet = new Set<string>();
            uriSet.add(fileUri.toString());

            const openDocs = vscode.workspace.textDocuments || [];
            for (const doc of openDocs) {
                if (doc.uri.scheme === 'file' && doc.uri.fsPath.startsWith(workspacePath)) {
                    uriSet.add(doc.uri.toString());
                }
            }

            const errorEntries: string[] = [];
            const warningEntries: string[] = [];

            for (const uriStr of uriSet) {
                const currentUri = vscode.Uri.parse(uriStr);
                const diags = vscode.languages.getDiagnostics(currentUri) || [];
                const relPath = path.relative(workspacePath, currentUri.fsPath).replace(/\\/g, '/');

                for (const diag of diags) {
                    const line = diag.range.start.line + 1;
                    const cleanMessage = diag.message.replace(/\r?\n/g, ' ').trim();

                    if (diag.severity === vscode.DiagnosticSeverity.Error) {
                        errorEntries.push(`${relPath} L${line}: ${cleanMessage}`);
                    } else if (diag.severity === vscode.DiagnosticSeverity.Warning) {
                        warningEntries.push(`${relPath} L${line}: ${cleanMessage}`);
                    }
                }
            }

            return this.formatDiagnosticsNote(errorEntries, warningEntries);
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

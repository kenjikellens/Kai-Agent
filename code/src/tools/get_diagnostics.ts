import * as vscode from 'vscode';
import * as path from 'path';
import { Tool, ToolContext, FunctionDeclaration } from './Tool';

/**
 * Tool for retrieving active editor and workspace diagnostics (linter errors, TypeScript type errors, warnings).
 */
export class GetDiagnosticsTool extends Tool {
    public readonly name = 'get_diagnostics';
    public readonly description = 'Retrieves active workspace diagnostics including TypeScript compiler errors, linter warnings, and syntax issues.';

    public getFunctionDeclaration(): FunctionDeclaration {
        return {
            type: 'function',
            function: {
                name: this.name,
                description: this.description,
                parameters: {
                    type: 'object',
                    properties: {
                        path: {
                            type: 'string',
                            description: 'Optional relative path to filter diagnostics for a specific file.'
                        }
                    }
                }
            }
        };
    }

    /**
     * Executes the diagnostics retrieval.
     * @param args Optional file path filter.
     * @param context Workspace context.
     * @returns Formatted diagnostics summary.
     */
    public async execute(args: { path?: string }, context: ToolContext): Promise<string> {
        const allDiagnostics = vscode.languages.getDiagnostics();
        if (!allDiagnostics || allDiagnostics.length === 0) {
            return 'No workspace diagnostics found (0 errors / 0 warnings).';
        }

        const results: string[] = [];
        for (const [uri, diagnostics] of allDiagnostics) {
            if (uri.scheme !== 'file' || diagnostics.length === 0) {
                continue;
            }

            const relPath = path.relative(context.workspacePath, uri.fsPath);
            if (args.path && !relPath.toLowerCase().includes(args.path.toLowerCase())) {
                continue;
            }

            results.push(`\nFile: ${relPath}`);
            for (const diag of diagnostics) {
                const severity = diag.severity === vscode.DiagnosticSeverity.Error ? '[ERROR]' :
                                 diag.severity === vscode.DiagnosticSeverity.Warning ? '[WARN]' : '[INFO]';
                const line = diag.range.start.line + 1;
                const col = diag.range.start.character + 1;
                results.push(`  ${severity} Line ${line}:${col} - ${diag.message}`);
            }
        }

        if (results.length === 0) {
            return args.path ? `No diagnostics found matching path: "${args.path}"` : 'No workspace diagnostics found.';
        }

        return this.truncateOutput(results.join('\n'));
    }
}

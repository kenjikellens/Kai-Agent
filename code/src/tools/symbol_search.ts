import * as vscode from 'vscode';
import * as path from 'path';
import { Tool, ToolContext, FunctionDeclaration } from './Tool';

/**
 * Tool for searching workspace AST symbols (classes, functions, interfaces, methods) using VS Code's symbol providers.
 */
export class SymbolSearchTool extends Tool {
    public readonly name = 'symbol_search';
    public readonly description = 'Searches for AST symbols (classes, functions, methods, variables) across the workspace.';

    public getFunctionDeclaration(): FunctionDeclaration {
        return {
            type: 'function',
            function: {
                name: this.name,
                description: this.description,
                parameters: {
                    type: 'object',
                    properties: {
                        query: {
                            type: 'string',
                            description: 'Symbol name query (e.g. "LMStudioClient" or "chatCompletion").'
                        }
                    },
                    required: ['query']
                }
            }
        };
    }

    /**
     * Executes symbol search via VS Code command palette provider.
     * @param args Symbol query parameter.
     * @param context Workspace context.
     * @returns Formatted symbol location list.
     */
    public async execute(args: { query: string }, context: ToolContext): Promise<string> {
        if (!args.query) {
            return 'Error: Symbol search query cannot be empty.';
        }

        try {
            const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
                'vscode.executeWorkspaceSymbolProvider',
                args.query
            );

            if (!symbols || symbols.length === 0) {
                return `No symbols found matching query: "${args.query}"`;
            }

            const symbolKindMap: Record<number, string> = {
                [vscode.SymbolKind.Class]: 'Class',
                [vscode.SymbolKind.Method]: 'Method',
                [vscode.SymbolKind.Function]: 'Function',
                [vscode.SymbolKind.Interface]: 'Interface',
                [vscode.SymbolKind.Variable]: 'Variable',
                [vscode.SymbolKind.Property]: 'Property',
                [vscode.SymbolKind.Constant]: 'Constant',
                [vscode.SymbolKind.Enum]: 'Enum'
            };

            const formatted = symbols.map(s => {
                const relPath = path.relative(context.workspacePath, s.location.uri.fsPath);
                const kind = symbolKindMap[s.kind] || 'Symbol';
                const line = s.location.range.start.line + 1;
                const container = s.containerName ? ` (in ${s.containerName})` : '';
                return `[${kind}] ${s.name}${container} -> ${relPath}:${line}`;
            });

            return this.truncateOutput(formatted.join('\n'));
        } catch (e: any) {
            return `Failed to execute symbol search: ${e.message || e}`;
        }
    }
}

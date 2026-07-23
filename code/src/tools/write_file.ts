import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Tool, ToolContext, FunctionDeclaration, resolveSafePath } from './Tool';
import { FileToolUtils } from './FileToolUtils';

/**
 * Tool for writing or creating new file content within the workspace.
 */
export class WriteFileTool extends Tool {
    public readonly name = 'write_file';
    public readonly description = 'Creates a new file or completely overwrites an existing file with the specified content.';

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
                            description: 'Relative path of the target file.'
                        },
                        content: {
                            type: 'string',
                            description: 'Full string content to write.'
                        }
                    },
                    required: ['path', 'content']
                }
            }
        };
    }

    /**
     * Executes the file writing operation.
     * @param args Arguments containing the relative path and string content.
     * @param context The current execution context containing the workspace path.
     * @returns A status message indicating success.
     */
    public async execute(args: { path: string; content: string }, context: ToolContext): Promise<string> {
        const targetPath = resolveSafePath(args.path, context.workspacePath);
        await FileToolUtils.ensureParentDirExists(targetPath);

        await fs.promises.writeFile(targetPath, args.content, 'utf8');
        vscode.window.showInformationMessage(`Kai: Created/Updated file ${path.basename(args.path)}`);
        return `Successfully wrote ${args.content.length} characters to file: ${args.path}`;
    }
}

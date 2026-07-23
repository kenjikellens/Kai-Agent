import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Tool, ToolContext, FunctionDeclaration, resolveSafePath } from './Tool';
import { FileToolUtils } from './FileToolUtils';

/**
 * Tool for editing existing file content within the workspace using search-and-replace.
 */
export class EditFileTool extends Tool {
    public readonly name = 'edit_file';
    public readonly description = 'Edits an existing file using exact search and replace string blocks.';

    public getFunctionDeclaration(): FunctionDeclaration {
        return {
            type: 'function',
            function: {
                name: this.name,
                description: this.description,
                parameters: {
                    type: 'object',
                    properties: {
                        path: { type: 'string', description: 'Relative path of the target file.' },
                        search: { type: 'string', description: 'Exact string block to search for in the file.' },
                        replace: { type: 'string', description: 'New string block to replace the search target.' }
                    },
                    required: ['path', 'search', 'replace']
                }
            }
        };
    }

    /**
     * Executes the search-and-replace editing operation.
     * @param args Arguments containing path, search block, and replacement block.
     * @param context The current execution context containing the workspace path.
     * @returns A status message indicating success or an error if the search block was not found.
     */
    public async execute(args: { path: string; search: string; replace: string }, context: ToolContext): Promise<string> {
        const targetPath = resolveSafePath(args.path, context.workspacePath);
        const existsError = FileToolUtils.checkFileExists(targetPath, args.path);
        if (existsError) {
            return existsError;
        }

        const content = await fs.promises.readFile(targetPath, 'utf8');
        const searchStr = args.search;
        const replaceStr = args.replace;

        if (!content.includes(searchStr)) {
            return `Error: Exact search block was not found in the file: ${args.path}. Please verify the search block matches exactly.`;
        }

        const updatedContent = content.replace(searchStr, replaceStr);
        await fs.promises.writeFile(targetPath, updatedContent, 'utf8');
        vscode.window.showInformationMessage(`Kai: Edited file ${path.basename(args.path)}`);
        return `Successfully updated file: ${args.path}`;
    }
}

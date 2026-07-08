import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Tool, ToolContext, resolveSafePath } from './Tool';

/**
 * Tool for editing existing file content within the workspace using search-and-replace.
 */
export class EditFileTool implements Tool {
    public readonly name = 'edit_file';

    /**
     * Executes the search-and-replace editing operation.
     * @param args Arguments containing path, search block, and replacement block.
     * @param context The current execution context containing the workspace path.
     * @returns A status message indicating success or an error if the search block was not found.
     */
    public async execute(args: { path: string; search: string; replace: string }, context: ToolContext): Promise<string> {
        const targetPath = resolveSafePath(args.path, context.workspacePath);
        if (!fs.existsSync(targetPath)) {
            return `File does not exist: ${args.path}`;
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

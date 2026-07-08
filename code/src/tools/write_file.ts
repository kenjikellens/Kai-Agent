import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Tool, ToolContext, resolveSafePath } from './Tool';

/**
 * Tool for writing or creating new file content within the workspace.
 */
export class WriteFileTool implements Tool {
    public readonly name = 'write_file';

    /**
     * Executes the file writing operation.
     * @param args Arguments containing the relative path and string content.
     * @param context The current execution context containing the workspace path.
     * @returns A status message indicating success.
     */
    public async execute(args: { path: string; content: string }, context: ToolContext): Promise<string> {
        const targetPath = resolveSafePath(args.path, context.workspacePath);
        const parentDir = path.dirname(targetPath);

        // Recursively create parent directories if they don't exist
        if (!fs.existsSync(parentDir)) {
            await fs.promises.mkdir(parentDir, { recursive: true });
        }

        await fs.promises.writeFile(targetPath, args.content, 'utf8');
        vscode.window.showInformationMessage(`Kai: Created/Updated file ${path.basename(args.path)}`);
        return `Successfully wrote ${args.content.length} characters to file: ${args.path}`;
    }
}

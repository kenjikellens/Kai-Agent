import * as fs from 'fs';
import { Tool, ToolContext, FunctionDeclaration, resolveSafePath } from './Tool';

/**
 * Tool for listing directories and files in a path relative to the workspace.
 */
export class ListDirTool extends Tool {
    public readonly name = 'list_dir';
    public readonly description = 'Lists all files and subdirectories within a given relative directory path.';

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
                            description: 'Relative directory path from workspace root (default ".").'
                        }
                    }
                }
            }
        };
    }

    /**
     * Executes the directory listing.
     * @param args Arguments containing the relative path to list (defaults to workspace root).
     * @param context The current execution context containing the workspace path.
     * @returns A string representation of the directory contents.
     */
    public async execute(args: { path?: string }, context: ToolContext): Promise<string> {
        const relativePath = args.path || '.';
        const targetPath = resolveSafePath(relativePath, context.workspacePath);
        if (!fs.existsSync(targetPath)) {
            return `Directory does not exist: ${relativePath}`;
        }
        const stats = await fs.promises.stat(targetPath);
        if (!stats.isDirectory()) {
            return `Path is not a directory: ${relativePath}`;
        }
        const entries = await fs.promises.readdir(targetPath, { withFileTypes: true });
        if (entries.length === 0) {
            return `Directory is empty.`;
        }
        const result = entries
            .map((e) => `${e.isDirectory() ? '[DIR]' : '[FILE]'} ${e.name}`)
            .join('\n');

        return this.truncateOutput(result);
    }
}

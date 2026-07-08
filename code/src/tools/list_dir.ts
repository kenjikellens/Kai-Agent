import * as fs from 'fs';
import { Tool, ToolContext, resolveSafePath } from './Tool';

/**
 * Tool for listing directories and files in a path relative to the workspace.
 */
export class ListDirTool implements Tool {
    public readonly name = 'list_dir';

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
        return entries
            .map((e) => `${e.isDirectory() ? '[DIR]' : '[FILE]'} ${e.name}`)
            .join('\n');
    }
}

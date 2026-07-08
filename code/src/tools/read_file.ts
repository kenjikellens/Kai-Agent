import * as fs from 'fs';
import { Tool, ToolContext, resolveSafePath } from './Tool';

/**
 * Tool for reading the content of a file within the workspace.
 */
export class ReadFileTool implements Tool {
    public readonly name = 'read_file';

    /**
     * Executes the file reading operation.
     * @param args Arguments containing the relative file path.
     * @param context The current execution context containing the workspace path.
     * @returns The file content if successful, or an error message.
     */
    public async execute(args: { path: string }, context: ToolContext): Promise<string> {
        const targetPath = resolveSafePath(args.path, context.workspacePath);
        if (!fs.existsSync(targetPath)) {
            return `File does not exist: ${args.path}`;
        }
        return await fs.promises.readFile(targetPath, 'utf8');
    }
}

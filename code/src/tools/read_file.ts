import * as fs from 'fs';
import { Tool, ToolContext, FunctionDeclaration, resolveSafePath } from './Tool';

/**
 * Tool for reading the content of a file within the workspace.
 */
export class ReadFileTool extends Tool {
    public readonly name = 'read_file';
    public readonly description = 'Reads the content of a file in the workspace, returning line-numbered text.';

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
                            description: 'Relative file path from the workspace root.'
                        }
                    },
                    required: ['path']
                }
            }
        };
    }

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
        const content = await fs.promises.readFile(targetPath, 'utf8');
        if (content.length === 0) {
            return '';
        }
        const lines = content.split(/\r?\n/);
        const formatted = lines.map((line, idx) => `${idx + 1}: ${line}`).join('\n');
        return this.truncateOutput(formatted);
    }
}

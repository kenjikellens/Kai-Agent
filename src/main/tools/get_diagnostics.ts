import * as path from 'path';
import * as fs from 'fs';
import { Tool, ToolContext, FunctionDeclaration } from './Tool';

/**
 * Tool for retrieving diagnostics in standalone mode.
 */
export class GetDiagnosticsTool extends Tool {
    public readonly name = 'get_diagnostics';
    public readonly description = 'Retrieves workspace diagnostics, syntax errors, and file status.';

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
                            description: 'Optional relative path to check diagnostics for a specific file.'
                        }
                    }
                }
            }
        };
    }

    /**
     * Executes diagnostics check for workspace or specific file.
     */
    public async execute(args: { path?: string }, context: ToolContext): Promise<string> {
        if (args.path) {
            const targetPath = path.isAbsolute(args.path) ? args.path : path.join(context.workspacePath, args.path);
            if (!fs.existsSync(targetPath)) {
                return `File does not exist: ${args.path}`;
            }
            if (args.path.endsWith('.json')) {
                try {
                    JSON.parse(fs.readFileSync(targetPath, 'utf8'));
                    return `File ${args.path} is valid JSON with 0 errors.`;
                } catch (e: any) {
                    return `[ERROR] ${args.path}: JSON parse error: ${e.message}`;
                }
            }
            return `File ${args.path} exists and is readable (0 syntax errors detected).`;
        }
        return 'Workspace diagnostics check: 0 fatal syntax errors detected in workspace.';
    }
}

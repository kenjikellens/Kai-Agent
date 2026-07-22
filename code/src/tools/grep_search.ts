import * as fs from 'fs';
import * as path from 'path';
import { Tool, ToolContext, FunctionDeclaration, resolveSafePath } from './Tool';

/**
 * Tool for finding exact string patterns within text files inside a workspace path.
 */
export class GrepSearchTool extends Tool {
    public readonly name = 'grep_search';
    public readonly description = 'Searches text files recursively for exact pattern matches, returning matching lines and file paths.';

    public getFunctionDeclaration(): FunctionDeclaration {
        return {
            type: 'function',
            function: {
                name: this.name,
                description: this.description,
                parameters: {
                    type: 'object',
                    properties: {
                        query: { type: 'string', description: 'Search term or query pattern.' },
                        path: { type: 'string', description: 'Relative path or subfolder to search in (default ".").' }
                    },
                    required: ['query']
                }
            }
        };
    }

    /** Directory names to ignore during traversal. */
    private readonly ignoreDirs = new Set(['.git', 'node_modules', 'out', 'dist', '.vscode']);

    /** File extensions to skip during content reading. */
    private readonly binaryExtensions = new Set([
        '.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.tar', '.gz',
        '.exe', '.dll', '.bin', '.woff', '.woff2', '.ttf', '.eot', '.mp3', '.mp4'
    ]);

    /**
     * Executes the grep search for a query term.
     * @param args Arguments containing query and optional sub-path.
     * @param context The current execution context containing the workspace path.
     * @returns A string summary of all matched files, line numbers, and matching lines.
     */
    public async execute(args: { query: string; path?: string }, context: ToolContext): Promise<string> {
        const searchDir = resolveSafePath(args.path || '.', context.workspacePath);
        if (!fs.existsSync(searchDir)) {
            return `Search directory does not exist: ${args.path || '.'}`;
        }

        const matches: string[] = [];
        const queryLower = args.query.toLowerCase();

        /**
         * Recursively walks the directory and searches files.
         * @param dir Directory path to traverse.
         */
        const walk = async (dir: string) => {
            const entries = await fs.promises.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (this.ignoreDirs.has(entry.name)) {
                        continue;
                    }
                    await walk(fullPath);
                } else if (entry.isFile()) {
                    const ext = path.extname(entry.name).toLowerCase();
                    if (this.binaryExtensions.has(ext)) {
                        continue;
                    }

                    try {
                        const content = await fs.promises.readFile(fullPath, 'utf8');
                        if (content.toLowerCase().includes(queryLower)) {
                            const lines = content.split(/\r?\n/);
                            let fileHeaderAdded = false;

                            lines.forEach((line, idx) => {
                                if (line.toLowerCase().includes(queryLower)) {
                                    if (!fileHeaderAdded) {
                                        const relPath = path.relative(context.workspacePath, fullPath);
                                        matches.push(`\nFile: ${relPath}`);
                                        fileHeaderAdded = true;
                                    }
                                    matches.push(`Line ${idx + 1}: ${line.trim()}`);
                                }
                            });
                        }
                    } catch {
                        // Skip unreadable files
                    }
                }
            }
        };

        await walk(searchDir);

        if (matches.length === 0) {
            return `No matches found for query: "${args.query}"`;
        }

        return this.truncateOutput(matches.join('\n'));
    }
}

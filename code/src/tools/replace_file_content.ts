import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Tool, ToolContext, FunctionDeclaration, resolveSafePath } from './Tool';

/**
 * Tool for replacing a single contiguous block of lines in a file.
 */
export class ReplaceFileContentTool extends Tool {
    public readonly name = 'replace_file_content';
    public readonly description = 'Replaces a contiguous block of lines in an existing file after verifying line range and target content match.';

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
                        startLine: { type: 'number', description: '1-indexed starting line number.' },
                        endLine: { type: 'number', description: '1-indexed ending line number.' },
                        targetContent: { type: 'string', description: 'Exact content expected inside line range.' },
                        replacementContent: { type: 'string', description: 'New content to replace the target block.' }
                    },
                    required: ['path', 'startLine', 'endLine', 'targetContent', 'replacementContent']
                }
            }
        };
    }

    /**
     * Executes the replacement of a contiguous block of text within a file.
     * @param args Arguments containing path, startLine, endLine, targetContent, and replacementContent.
     * @param context The current execution context containing the workspace path.
     * @returns A status message indicating success or an error details.
     */
    public async execute(
        args: { path: string; startLine: number; endLine: number; targetContent: string; replacementContent: string },
        context: ToolContext
    ): Promise<string> {
        const targetPath = resolveSafePath(args.path, context.workspacePath);
        if (!fs.existsSync(targetPath)) {
            return `File does not exist: ${args.path}`;
        }

        const content = await fs.promises.readFile(targetPath, 'utf8');
        const lines = content.split(/\r?\n/);

        const startIdx = args.startLine - 1;
        const endIdx = args.endLine - 1;

        if (startIdx < 0 || endIdx >= lines.length || startIdx > endIdx) {
            return `Error: Line range [${args.startLine}, ${args.endLine}] is out of bounds for file ${args.path} (total lines: ${lines.length}).`;
        }

        const targetLinesFromFile = lines.slice(startIdx, endIdx + 1);
        const fileBlockNormalized = targetLinesFromFile.join('\n');
        const targetContentNormalized = args.targetContent.replace(/\r?\n/g, '\n');

        if (fileBlockNormalized !== targetContentNormalized) {
            return `Error: The content at lines ${args.startLine}-${args.endLine} does not match the targetContent exactly.\n` +
                   `Expected:\n${targetContentNormalized}\n\n` +
                   `Found in file:\n${fileBlockNormalized}`;
        }

        const replacementLines = args.replacementContent.split(/\r?\n/);
        lines.splice(startIdx, targetLinesFromFile.length, ...replacementLines);

        await fs.promises.writeFile(targetPath, lines.join('\n'), 'utf8');
        vscode.window.showInformationMessage(`Kai: Replaced content in ${path.basename(args.path)}`);
        return `Successfully updated file: ${args.path} (lines ${args.startLine}-${args.endLine})`;
    }
}

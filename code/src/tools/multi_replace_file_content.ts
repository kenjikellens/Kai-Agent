import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Tool, ToolContext, FunctionDeclaration, resolveSafePath } from './Tool';

/**
 * Interface representing a single replacement chunk.
 */
interface ReplacementChunk {
    startLine: number;
    endLine: number;
    targetContent: string;
    replacementContent: string;
}

/**
 * Tool for replacing multiple non-contiguous blocks of lines in a file.
 */
export class MultiReplaceFileContentTool extends Tool {
    public readonly name = 'multi_replace_file_content';
    public readonly description = 'Replaces multiple non-contiguous blocks of lines in a single file in one pass.';

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
                        chunks: {
                            type: 'array',
                            description: 'List of replacement chunk objects.',
                            items: {
                                type: 'object',
                                properties: {
                                    startLine: { type: 'number', description: '1-indexed starting line number.' },
                                    endLine: { type: 'number', description: '1-indexed ending line number.' },
                                    targetContent: { type: 'string', description: 'Exact content expected inside line range.' },
                                    replacementContent: { type: 'string', description: 'New content to replace the target block.' }
                                },
                                required: ['startLine', 'endLine', 'targetContent', 'replacementContent']
                            }
                        }
                    },
                    required: ['path', 'chunks']
                }
            }
        };
    }

    /**
     * Executes multiple non-contiguous replacements within a file.
     * Applies changes in descending order of startLine to maintain correct line number references.
     * @param args Arguments containing path and chunks array.
     * @param context The current execution context containing the workspace path.
     * @returns A status message indicating success or an error details.
     */
    public async execute(
        args: { path: string; chunks: ReplacementChunk[] },
        context: ToolContext
    ): Promise<string> {
        const targetPath = resolveSafePath(args.path, context.workspacePath);
        if (!fs.existsSync(targetPath)) {
            return `File does not exist: ${args.path}`;
        }

        if (!args.chunks || !Array.isArray(args.chunks) || args.chunks.length === 0) {
            return `Error: Chunks list is empty or invalid.`;
        }

        const content = await fs.promises.readFile(targetPath, 'utf8');
        const lines = content.split(/\r?\n/);

        // Sort chunks in descending order of startLine to avoid index shift issues
        const sortedChunks = [...args.chunks].sort((a, b) => b.startLine - a.startLine);

        for (let i = 0; i < sortedChunks.length; i++) {
            const chunk = sortedChunks[i];
            const startIdx = chunk.startLine - 1;
            const endIdx = chunk.endLine - 1;

            if (startIdx < 0 || endIdx >= lines.length || startIdx > endIdx) {
                return `Error in chunk ${i + 1}: Line range [${chunk.startLine}, ${chunk.endLine}] is out of bounds for file ${args.path} (total lines: ${lines.length}).`;
            }

            const targetLinesFromFile = lines.slice(startIdx, endIdx + 1);
            const fileBlockNormalized = targetLinesFromFile.join('\n');
            const targetContentNormalized = chunk.targetContent.replace(/\r?\n/g, '\n');

            if (fileBlockNormalized !== targetContentNormalized) {
                return `Error in chunk ${i + 1} at lines ${chunk.startLine}-${chunk.endLine}: Content does not match the targetContent exactly.\n` +
                       `Expected:\n${targetContentNormalized}\n\n` +
                       `Found in file:\n${fileBlockNormalized}`;
            }

            const replacementLines = chunk.replacementContent.split(/\r?\n/);
            lines.splice(startIdx, targetLinesFromFile.length, ...replacementLines);
        }

        await fs.promises.writeFile(targetPath, lines.join('\n'), 'utf8');
        vscode.window.showInformationMessage(`Kai: Multi-replaced content in ${path.basename(args.path)}`);
        return `Successfully updated file: ${args.path} (${args.chunks.length} chunks applied)`;
    }
}

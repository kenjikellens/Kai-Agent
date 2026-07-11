"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MultiReplaceFileContentTool = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const Tool_1 = require("./Tool");
/**
 * Tool for replacing multiple non-contiguous blocks of lines in a file.
 */
class MultiReplaceFileContentTool {
    constructor() {
        this.name = 'multi_replace_file_content';
    }
    /**
     * Executes multiple non-contiguous replacements within a file.
     * Applies changes in descending order of startLine to maintain correct line number references.
     * @param args Arguments containing path and chunks array.
     * @param context The current execution context containing the workspace path.
     * @returns A status message indicating success or an error details.
     */
    async execute(args, context) {
        const targetPath = (0, Tool_1.resolveSafePath)(args.path, context.workspacePath);
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
exports.MultiReplaceFileContentTool = MultiReplaceFileContentTool;
//# sourceMappingURL=multi_replace_file_content.js.map
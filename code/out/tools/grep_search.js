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
exports.GrepSearchTool = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const Tool_1 = require("./Tool");
/**
 * Tool for finding exact string patterns within text files inside a workspace path.
 */
class GrepSearchTool {
    constructor() {
        this.name = 'grep_search';
        /** Directory names to ignore during traversal. */
        this.ignoreDirs = new Set(['.git', 'node_modules', 'out', 'dist', '.vscode']);
        /** File extensions to skip during content reading. */
        this.binaryExtensions = new Set([
            '.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.tar', '.gz',
            '.exe', '.dll', '.bin', '.woff', '.woff2', '.ttf', '.eot', '.mp3', '.mp4'
        ]);
    }
    /**
     * Executes the grep search for a query term.
     * @param args Arguments containing query and optional sub-path.
     * @param context The current execution context containing the workspace path.
     * @returns A string summary of all matched files, line numbers, and matching lines.
     */
    async execute(args, context) {
        const searchDir = (0, Tool_1.resolveSafePath)(args.path || '.', context.workspacePath);
        if (!fs.existsSync(searchDir)) {
            return `Search directory does not exist: ${args.path || '.'}`;
        }
        const matches = [];
        const queryLower = args.query.toLowerCase();
        /**
         * Recursively walks the directory and searches files.
         * @param dir Directory path to traverse.
         */
        const walk = async (dir) => {
            const entries = await fs.promises.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (this.ignoreDirs.has(entry.name)) {
                        continue;
                    }
                    await walk(fullPath);
                }
                else if (entry.isFile()) {
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
                    }
                    catch {
                        // Skip unreadable files
                    }
                }
            }
        };
        await walk(searchDir);
        if (matches.length === 0) {
            return `No matches found for query: "${args.query}"`;
        }
        return matches.join('\n');
    }
}
exports.GrepSearchTool = GrepSearchTool;
//# sourceMappingURL=grep_search.js.map
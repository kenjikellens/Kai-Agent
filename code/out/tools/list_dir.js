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
exports.ListDirTool = void 0;
const fs = __importStar(require("fs"));
const Tool_1 = require("./Tool");
/**
 * Tool for listing directories and files in a path relative to the workspace.
 */
class ListDirTool {
    constructor() {
        this.name = 'list_dir';
    }
    /**
     * Executes the directory listing.
     * @param args Arguments containing the relative path to list (defaults to workspace root).
     * @param context The current execution context containing the workspace path.
     * @returns A string representation of the directory contents.
     */
    async execute(args, context) {
        const relativePath = args.path || '.';
        const targetPath = (0, Tool_1.resolveSafePath)(relativePath, context.workspacePath);
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
exports.ListDirTool = ListDirTool;
//# sourceMappingURL=list_dir.js.map
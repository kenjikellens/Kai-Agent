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
exports.EditFileTool = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const Tool_1 = require("./Tool");
/**
 * Tool for editing existing file content within the workspace using search-and-replace.
 */
class EditFileTool {
    constructor() {
        this.name = 'edit_file';
    }
    /**
     * Executes the search-and-replace editing operation.
     * @param args Arguments containing path, search block, and replacement block.
     * @param context The current execution context containing the workspace path.
     * @returns A status message indicating success or an error if the search block was not found.
     */
    async execute(args, context) {
        const targetPath = (0, Tool_1.resolveSafePath)(args.path, context.workspacePath);
        if (!fs.existsSync(targetPath)) {
            return `File does not exist: ${args.path}`;
        }
        const content = await fs.promises.readFile(targetPath, 'utf8');
        const searchStr = args.search;
        const replaceStr = args.replace;
        if (!content.includes(searchStr)) {
            return `Error: Exact search block was not found in the file: ${args.path}. Please verify the search block matches exactly.`;
        }
        const updatedContent = content.replace(searchStr, replaceStr);
        await fs.promises.writeFile(targetPath, updatedContent, 'utf8');
        vscode.window.showInformationMessage(`Kai: Edited file ${path.basename(args.path)}`);
        return `Successfully updated file: ${args.path}`;
    }
}
exports.EditFileTool = EditFileTool;
//# sourceMappingURL=edit_file.js.map
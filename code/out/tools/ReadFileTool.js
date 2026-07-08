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
exports.ReadFileTool = void 0;
const fs = __importStar(require("fs"));
const Tool_1 = require("./Tool");
/**
 * Tool for reading the content of a file within the workspace.
 */
class ReadFileTool {
    constructor() {
        this.name = 'read_file';
    }
    /**
     * Executes the file reading operation.
     * @param args Arguments containing the relative file path.
     * @param context The current execution context containing the workspace path.
     * @returns The file content if successful, or an error message.
     */
    async execute(args, context) {
        const targetPath = (0, Tool_1.resolveSafePath)(args.path, context.workspacePath);
        if (!fs.existsSync(targetPath)) {
            return `File does not exist: ${args.path}`;
        }
        return await fs.promises.readFile(targetPath, 'utf8');
    }
}
exports.ReadFileTool = ReadFileTool;
//# sourceMappingURL=ReadFileTool.js.map
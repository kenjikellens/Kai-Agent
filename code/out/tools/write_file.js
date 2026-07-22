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
exports.WriteFileTool = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const Tool_1 = require("./Tool");
/**
 * Tool for writing or creating new file content within the workspace.
 */
class WriteFileTool extends Tool_1.Tool {
    constructor() {
        super(...arguments);
        this.name = 'write_file';
        this.description = 'Creates a new file or completely overwrites an existing file with the specified content.';
    }
    getFunctionDeclaration() {
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
                            description: 'Relative path of the target file.'
                        },
                        content: {
                            type: 'string',
                            description: 'Full string content to write.'
                        }
                    },
                    required: ['path', 'content']
                }
            }
        };
    }
    /**
     * Executes the file writing operation.
     * @param args Arguments containing the relative path and string content.
     * @param context The current execution context containing the workspace path.
     * @returns A status message indicating success.
     */
    async execute(args, context) {
        const targetPath = (0, Tool_1.resolveSafePath)(args.path, context.workspacePath);
        const parentDir = path.dirname(targetPath);
        // Recursively create parent directories if they don't exist
        if (!fs.existsSync(parentDir)) {
            await fs.promises.mkdir(parentDir, { recursive: true });
        }
        await fs.promises.writeFile(targetPath, args.content, 'utf8');
        vscode.window.showInformationMessage(`Kai: Created/Updated file ${path.basename(args.path)}`);
        return `Successfully wrote ${args.content.length} characters to file: ${args.path}`;
    }
}
exports.WriteFileTool = WriteFileTool;
//# sourceMappingURL=write_file.js.map
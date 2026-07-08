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
exports.RunCommandTool = void 0;
const childProcess = __importStar(require("child_process"));
const vscode = __importStar(require("vscode"));
/**
 * Tool for running shell commands in the workspace root with a timeout and user confirmation request.
 */
class RunCommandTool {
    constructor() {
        this.name = 'run_command';
    }
    /**
     * Executes the requested command in the workspace root.
     * Requests user confirmation inside VS Code before execution.
     * @param args Arguments containing the terminal command to run.
     * @param context The current execution context containing the workspace path.
     * @returns A string summary of stdout, stderr, and/or errors.
     */
    async execute(args, context) {
        const choice = await vscode.window.showWarningMessage(`Kai wants to execute: ${args.command}`, 'Allow', 'Refuse');
        if (choice !== 'Allow') {
            return `[Execution Cancelled]: User refused to execute the command: ${args.command}`;
        }
        return new Promise((resolve) => {
            childProcess.exec(args.command, { cwd: context.workspacePath, timeout: 30000 }, (error, stdout, stderr) => {
                let result = '';
                if (stdout) {
                    result += `[Stdout]:\n${stdout}\n`;
                }
                if (stderr) {
                    result += `[Stderr]:\n${stderr}\n`;
                }
                if (error) {
                    if (error.killed) {
                        result += `[Error]: Command execution timed out after 30 seconds.\n`;
                    }
                    else {
                        result += `[Exit Code]: ${error.code || 1}\n[Error]: ${error.message}\n`;
                    }
                }
                if (!result) {
                    result = `Command executed with success (empty output).`;
                }
                if (!error) {
                    vscode.window.showInformationMessage(`Kai: Successfully executed command: ${args.command}`);
                }
                resolve(result);
            });
        });
    }
}
exports.RunCommandTool = RunCommandTool;
//# sourceMappingURL=run_command.js.map
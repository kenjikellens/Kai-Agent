import * as childProcess from 'child_process';
import * as vscode from 'vscode';
import { Tool, ToolContext } from './Tool';

/**
 * Tool for running shell commands in the workspace root with a timeout and user confirmation request.
 */
export class RunCommandTool implements Tool {
    public readonly name = 'run_command';

    /**
     * Executes the requested command in the workspace root.
     * Requests user confirmation inside VS Code before execution.
     * @param args Arguments containing the terminal command to run.
     * @param context The current execution context containing the workspace path.
     * @returns A string summary of stdout, stderr, and/or errors.
     */
    public async execute(args: { command: string }, context: ToolContext): Promise<string> {
        const choice = await vscode.window.showWarningMessage(
            `Kai wants to execute: ${args.command}`,
            'Allow',
            'Refuse'
        );
        if (choice !== 'Allow') {
            return `[Execution Cancelled]: User refused to execute the command: ${args.command}`;
        }

        return new Promise((resolve) => {
            childProcess.exec(
                args.command,
                { cwd: context.workspacePath, timeout: 30000 },
                (error, stdout, stderr) => {
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
                        } else {
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
                }
            );
        });
    }
}

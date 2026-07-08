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
exports.InlineEditHandler = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const LMStudioClient_1 = require("./LMStudioClient");
/**
 * InlineEditHandler coordinates selecting code, asking the user for instructions,
 * querying LM Studio to edit the code, and presenting a diff view for verification.
 */
class InlineEditHandler {
    /**
     * Triggers the inline edit process for the active text editor selection.
     */
    static async run() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active text editor found.');
            return;
        }
        const document = editor.document;
        const selection = editor.selection;
        const selectedText = document.getText(selection);
        if (!selectedText) {
            vscode.window.showWarningMessage('Please select some code to edit.');
            return;
        }
        // Ask the user what edits they want to perform
        const instruction = await vscode.window.showInputBox({
            prompt: 'Describe the edits you want to apply to the selected code',
            placeHolder: 'e.g., Add error handling, refactor to async/await, optimize...'
        });
        if (!instruction || !instruction.trim()) {
            return;
        }
        // Fetch extension configuration
        const config = vscode.workspace.getConfiguration('kai');
        const serverUrl = config.get('serverUrl') || 'http://localhost:1234/v1';
        const temperature = config.get('temperature') || 0.7;
        const client = new LMStudioClient_1.LMStudioClient(serverUrl);
        // Run with progress indication
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Kai: Generating inline edits...',
            cancellable: true
        }, async (_progress, token) => {
            const abortController = new AbortController();
            token.onCancellationRequested(() => {
                abortController.abort();
            });
            try {
                // Check if server is connected first
                const models = await client.getModels();
                const activeModel = models.length > 0 ? models[0] : 'local-model';
                const prompt = this.buildPrompt(selectedText, instruction, document.languageId);
                const systemPrompt = `You are a precise developer assistant.
Your task is to rewrite the selected code based on the instructions.
You must output ONLY the replacement code inside markdown code blocks (e.g. \`\`\`js ... \`\`\`).
Do NOT include any explanations, introduction, or warnings. Output only the modified code.`;
                const messages = [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: prompt }
                ];
                const rawResponse = await client.chatCompletion(messages, activeModel, temperature, abortController.signal);
                const editedCode = this.cleanCodeBlocks(rawResponse);
                if (!editedCode.trim()) {
                    throw new Error('Received empty response from the local model.');
                }
                // Create the full modified document text
                const fullText = document.getText();
                const startOffset = document.offsetAt(selection.start);
                const endOffset = document.offsetAt(selection.end);
                const modifiedText = fullText.slice(0, startOffset) + editedCode + fullText.slice(endOffset);
                // Create a temp file for the diff view next to the original file
                const dirName = path.dirname(document.uri.fsPath);
                const baseName = path.basename(document.uri.fsPath);
                const tempFilePath = path.join(dirName, `.kai-tmp.${baseName}`);
                await fs.promises.writeFile(tempFilePath, modifiedText, 'utf8');
                const tempUri = vscode.Uri.file(tempFilePath);
                // Show diff editor comparing original document vs temp modified document
                await vscode.commands.executeCommand('vscode.diff', document.uri, tempUri, `Kai Suggestion: ${baseName} <-> Suggested Edit`);
                // Ask user to apply changes or discard
                const choice = await vscode.window.showInformationMessage('Apply the suggested AI changes to your file?', 'Apply', 'Discard');
                if (choice === 'Apply') {
                    const edit = new vscode.WorkspaceEdit();
                    edit.replace(document.uri, selection, editedCode);
                    await vscode.workspace.applyEdit(edit);
                    await document.save();
                    vscode.window.showInformationMessage('Kai: Changes applied successfully.');
                }
                // Clean up the temp file
                if (fs.existsSync(tempFilePath)) {
                    await fs.promises.unlink(tempFilePath);
                }
                // Close the diff tab by closing the active editor if it matches the temp file uri
                const activeTab = vscode.window.activeTextEditor;
                if (activeTab && activeTab.document.uri.fsPath === tempFilePath) {
                    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                }
            }
            catch (err) {
                if (err.name === 'AbortError') {
                    vscode.window.showInformationMessage('Kai: Inline edit generation cancelled.');
                }
                else {
                    vscode.window.showErrorMessage(`Kai Inline Edit Error: ${err.message || err}`);
                }
            }
        });
    }
    /**
     * Builds the instruction prompt for the model.
     */
    static buildPrompt(code, instruction, languageId) {
        return `Code language: ${languageId}

Original Code to Modify:
\`\`\`${languageId}
${code}
\`\`\`

Instructions:
${instruction}

Please output the replacement code.`;
    }
    /**
     * Strips markdown code blocks and backticks from the model response.
     */
    static cleanCodeBlocks(text) {
        // Match standard markdown code block fences
        const fenceRegex = /```(?:[a-zA-Z0-9\-]+)?\n([\s\S]*?)\n```/i;
        const match = fenceRegex.exec(text);
        if (match) {
            return match[1];
        }
        // Strip leading/trailing single backticks or markdown fences if model was messy
        let cleaned = text.trim();
        if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/^```[a-zA-Z0-9\-]*\n?/g, '');
        }
        if (cleaned.endsWith('```')) {
            cleaned = cleaned.replace(/\n?```$/g, '');
        }
        return cleaned;
    }
}
exports.InlineEditHandler = InlineEditHandler;
//# sourceMappingURL=InlineEditHandler.js.map
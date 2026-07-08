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
exports.deactivate = exports.activate = void 0;
const vscode = __importStar(require("vscode"));
const SidebarProvider_1 = require("./SidebarProvider");
const InlineEditHandler_1 = require("./InlineEditHandler");
/**
 * Entry point activation hook for the extension.
 * VS Code runs this method when the extension is activated (i.e. view is loaded).
 * @param context VS Code extension context providing subscription storage and files path.
 */
function activate(context) {
    // Instantiate our custom WebviewView sidebar provider with the extension context
    const sidebarProvider = new SidebarProvider_1.SidebarProvider(context);
    // Register our custom ViewProvider with VS Code matching the views ID in package.json
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(SidebarProvider_1.SidebarProvider.viewType, sidebarProvider));
    // Register the command to send selected text to the chat pane
    context.subscriptions.push(vscode.commands.registerCommand('kai.sendSelection', () => {
        sidebarProvider.sendSelectionToChat();
    }));
    // Register command to programmatically focus and show the LM Studio Chat View
    context.subscriptions.push(vscode.commands.registerCommand('kai.focusChat', () => {
        vscode.commands.executeCommand('kai-chat-sidebar.focus');
    }));
    // Register command to run inline code editing
    context.subscriptions.push(vscode.commands.registerCommand('kai.inlineEdit', () => {
        InlineEditHandler_1.InlineEditHandler.run();
    }));
    // Create a new Status Bar Item positioned on the right side (alignment priority 100)
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'kai.focusChat';
    statusBarItem.text = '$(hubot) Kai';
    statusBarItem.tooltip = 'Open Kai Agent Chat';
    statusBarItem.show();
    // Ensure resources are cleaned up on extension deactivation
    context.subscriptions.push(statusBarItem);
}
exports.activate = activate;
/**
 * Entry point deactivation hook for the extension.
 * Executed when the extension is shut down or disabled by the IDE.
 */
function deactivate() { }
exports.deactivate = deactivate;
//# sourceMappingURL=extension.js.map
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Metadata representing the user's active editor environment and selection state.
 */
export interface EditorContext {
    activeFile?: {
        fileName: string;
        filePath: string;
        languageId: string;
    };
    cursor?: {
        line: number;
        character: number;
    };
    selection?: {
        startLine: number;
        endLine: number;
        text: string;
        isMultiline: boolean;
    };
    visibleRange?: {
        startLine: number;
        endLine: number;
    };
    openTabs?: string[];
}

/**
 * Service for safely capturing and formatting active VS Code editor state,
 * including active selections, cursor positions, and open workspace tabs.
 */
export class EditorContextProvider {
    /**
     * Captures current active editor context from the VS Code window state.
     * @param workspacePath Optional workspace root path for computing relative file paths.
     * @returns Structured EditorContext object.
     */
    public static captureEditorContext(workspacePath?: string): EditorContext {
        const context: EditorContext = {};
        const activeEditor = vscode.window.activeTextEditor;

        if (activeEditor && activeEditor.document.uri.scheme === 'file') {
            const doc = activeEditor.document;
            const fullPath = doc.uri.fsPath;
            let relPath = fullPath;
            if (workspacePath) {
                relPath = path.relative(workspacePath, fullPath).replace(/\\/g, '/');
            }

            context.activeFile = {
                fileName: path.basename(fullPath),
                filePath: relPath,
                languageId: doc.languageId
            };

            const selection = activeEditor.selection;
            if (selection) {
                context.cursor = {
                    line: selection.active.line + 1,
                    character: selection.active.character + 1
                };

                if (!selection.isEmpty) {
                    const startLine = selection.start.line + 1;
                    const endLine = selection.end.line + 1;
                    let selectedText = doc.getText(selection);
                    const selectedLines = selectedText.split(/\r?\n/);

                    if (selectedLines.length > 100) {
                        selectedText = selectedLines.slice(0, 100).join('\n') + `\n... [${selectedLines.length - 100} lines omitted]`;
                    }

                    context.selection = {
                        startLine,
                        endLine,
                        text: selectedText,
                        isMultiline: startLine !== endLine
                    };
                }
            }

            if (activeEditor.visibleRanges && activeEditor.visibleRanges.length > 0) {
                const visible = activeEditor.visibleRanges[0];
                context.visibleRange = {
                    startLine: visible.start.line + 1,
                    endLine: visible.end.line + 1
                };
            }
        }

        // Capture open tabs across all tab groups
        const openTabs: string[] = [];
        try {
            if (vscode.window.tabGroups && vscode.window.tabGroups.all) {
                for (const group of vscode.window.tabGroups.all) {
                    for (const tab of group.tabs) {
                        if (tab.input && typeof tab.input === 'object' && 'uri' in tab.input) {
                            const uri = (tab.input as any).uri;
                            if (uri && uri.scheme === 'file') {
                                let tabRel = uri.fsPath;
                                if (workspacePath) {
                                    tabRel = path.relative(workspacePath, tabRel).replace(/\\/g, '/');
                                }
                                if (!openTabs.includes(tabRel)) {
                                    openTabs.push(tabRel);
                                }
                            }
                        }
                    }
                }
            }
        } catch {
            // Fallback for environments where tabGroups might be restricted
        }

        if (openTabs.length > 0) {
            context.openTabs = openTabs.slice(0, 10);
        }

        return context;
    }

    /**
     * Formats an EditorContext object into a clean, markdown-formatted context banner for the AI agent.
     * @param context Active editor context object.
     * @returns Formatted markdown string, or empty string if no relevant context exists.
     */
    public static formatContextBanner(context: EditorContext): string {
        if (!context.activeFile && (!context.openTabs || context.openTabs.length === 0)) {
            return '';
        }

        const parts: string[] = ['[CURRENT ACTIVE EDITOR CONTEXT]'];

        if (context.activeFile) {
            parts.push(`- Active File: \`${context.activeFile.filePath}\` (${context.activeFile.languageId})`);
        }

        if (context.cursor) {
            parts.push(`- Cursor Position: Line ${context.cursor.line}, Column ${context.cursor.character}`);
        }

        if (context.selection && context.selection.text.trim()) {
            const rangeLabel = context.selection.isMultiline
                ? `Lines ${context.selection.startLine}-${context.selection.endLine}`
                : `Line ${context.selection.startLine}`;

            const lang = context.activeFile ? context.activeFile.languageId : '';
            parts.push(`- Currently Selected Code (${rangeLabel}):\n\`\`\`${lang}\n${context.selection.text}\n\`\`\``);
        }

        if (context.openTabs && context.openTabs.length > 0) {
            const formattedTabs = context.openTabs.map(t => `\`${t}\``).join(', ');
            parts.push(`- Open Workspace Tabs: ${formattedTabs}`);
        }

        return parts.join('\n') + '\n\n';
    }
}

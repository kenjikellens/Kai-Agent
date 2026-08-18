import * as path from 'path';

/**
 * Interface representing editor context details.
 */
export interface EditorContext {
    activeFile?: {
        fileName: string;
        filePath: string;
        relativePath: string;
        languageId?: string;
    };
    selection?: {
        text: string;
        startLine: number;
        endLine: number;
    };
    openTabs?: {
        fileName: string;
        filePath: string;
        relativePath: string;
    }[];
}

/**
 * Provides contextual file/tab metadata in the standalone application.
 */
export class EditorContextProvider {
    /**
     * Formats the context banner for injection into the user prompt.
     */
    public static formatContextBanner(context: EditorContext): string {
        const lines: string[] = [];

        if (context.activeFile) {
            lines.push(`[Active File: ${context.activeFile.relativePath || context.activeFile.fileName}]`);
        }

        if (context.selection && context.selection.text) {
            lines.push(`[Active Selection (Lines ${context.selection.startLine}-${context.selection.endLine})]:`);
            lines.push(`\`\`\``);
            lines.push(context.selection.text);
            lines.push(`\`\`\``);
        }

        return lines.length > 0 ? `${lines.join('\n')}\n\n` : '';
    }

    /**
     * Captures current active file details.
     */
    public static captureEditorContext(_workspacePath: string): EditorContext | undefined {
        return undefined;
    }
}

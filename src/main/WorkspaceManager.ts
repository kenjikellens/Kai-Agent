import * as path from 'path';
import * as fs from 'fs';
import { dialog, BrowserWindow } from 'electron';

/**
 * WorkspaceManager handles the active workspace folder state, directory validation,
 * and native folder/file picker dialogs in the desktop application.
 */
export class WorkspaceManager {
    private activeWorkspacePath: string = '';

    /**
     * Initializes the workspace manager with a default directory (e.g. cwd).
     * @param initialPath Optional starting directory path.
     */
    constructor(initialPath?: string) {
        this.activeWorkspacePath = initialPath || process.cwd();
    }

    /**
     * Retrieves the currently active workspace root directory path.
     */
    public getWorkspacePath(): string {
        return this.activeWorkspacePath;
    }

    /**
     * Sets the active workspace directory path if it exists.
     * @param targetPath Absolute path to directory.
     */
    public setWorkspacePath(targetPath: string): boolean {
        if (targetPath && fs.existsSync(targetPath)) {
            this.activeWorkspacePath = path.resolve(targetPath);
            return true;
        }
        return false;
    }

    /**
     * Resolves a relative or absolute path against the active workspace root.
     * @param relativeOrAbsolute File or directory path.
     */
    public resolvePath(relativeOrAbsolute: string): string {
        if (path.isAbsolute(relativeOrAbsolute)) {
            return relativeOrAbsolute;
        }
        return path.join(this.activeWorkspacePath, relativeOrAbsolute);
    }

    /**
     * Converts an absolute path into a relative path from the workspace root.
     * @param absolutePath Absolute file path.
     */
    public getRelativePath(absolutePath: string): string {
        if (!this.activeWorkspacePath) {
            return absolutePath;
        }
        return path.relative(this.activeWorkspacePath, absolutePath);
    }

    /**
     * Opens native Electron folder picker dialog to select an active workspace.
     * @param window Target BrowserWindow instance for dialog modal attachment.
     */
    public async openWorkspacePicker(window?: BrowserWindow): Promise<string | null> {
        const result = window
            ? await dialog.showOpenDialog(window, {
                  properties: ['openDirectory', 'createDirectory'],
                  title: 'Select Workspace Directory'
              })
            : await dialog.showOpenDialog({
                  properties: ['openDirectory', 'createDirectory'],
                  title: 'Select Workspace Directory'
              });

        if (!result.canceled && result.filePaths.length > 0) {
            const selected = result.filePaths[0];
            this.setWorkspacePath(selected);
            return selected;
        }
        return null;
    }
}

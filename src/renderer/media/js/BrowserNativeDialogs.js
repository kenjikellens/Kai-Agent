/**
 * BrowserNativeDialogs: Manages file and folder picker dialog interactions for browser preview mode.
 */
class BrowserNativeDialogs {
    /**
     * Opens native file picker dialog and reads selected file contents.
     * @returns {Promise<Array<{ fileName: string, filePath: string, relativePath: string, content: string }>>}
     */
    static openFilePicker() {
        return new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.multiple = true;
            input.accept = '.js,.ts,.jsx,.tsx,.py,.html,.css,.json,.md,.txt,.csv,.java,.c,.cpp,.rs,.go,.php,.rb,.sql,.sh,.yaml,.yml,.xml,.env,.toml,.png,.jpg,.jpeg,.webp,.gif';
            input.addEventListener('change', async () => {
                const files = [];
                for (const file of Array.from(input.files || [])) {
                    if (file.size > 2 * 1024 * 1024) continue;
                    try {
                        const content = await file.text();
                        files.push({ fileName: file.name, filePath: file.name, relativePath: file.name, content });
                    } catch (error) {}
                }
                resolve(files);
            }, { once: true });
            input.click();
        });
    }

    /**
     * Opens native folder picker dialog for workspace directory via backend endpoint.
     * @returns {Promise<string | null>} Selected workspace folder path or null.
     */
    static async openWorkspaceFolderPicker() {
        try {
            const res = await fetch('/api/workspace/pick', { method: 'POST' });
            if (res.ok) {
                const data = await res.json();
                if (!data.canceled && data.workspacePath) {
                    return data.workspacePath;
                }
            }
        } catch (e) {
            console.error('Error selecting workspace folder:', e);
        }
        return null;
    }

    /**
     * Opens native folder picker dialog for LM Studio cache directory via backend endpoint.
     * @returns {Promise<string | null>} Selected LM Studio cache path or null.
     */
    static async openLMStudioFolderPicker() {
        try {
            const res = await fetch('/api/lmstudio/pick', { method: 'POST' });
            if (res.ok) {
                const data = await res.json();
                if (!data.canceled && data.lmStudioCacheDir) {
                    return data.lmStudioCacheDir;
                }
            }
        } catch (e) {
            console.error('Error selecting LM Studio directory:', e);
        }
        return null;
    }
}

if (typeof window !== 'undefined') {
    window.BrowserNativeDialogs = BrowserNativeDialogs;
}

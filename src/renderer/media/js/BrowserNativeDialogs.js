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
     * Opens folder picker dialog for workspace directory using File System Access API or HTML5 webkitdirectory.
     * @returns {Promise<string | null>} Selected workspace folder name/path or null.
     */
    static openWorkspaceFolderPicker() {
        return new Promise(async (resolve) => {
            // Method 1: Try modern window.showDirectoryPicker if supported
            if (typeof window.showDirectoryPicker === 'function') {
                try {
                    const dirHandle = await window.showDirectoryPicker();
                    if (dirHandle && dirHandle.name) {
                        return resolve(dirHandle.name);
                    }
                } catch (e) {
                    if (e.name !== 'AbortError') {
                        console.warn('showDirectoryPicker error, falling back to input:', e);
                    } else {
                        return resolve(null);
                    }
                }
            }

            // Method 2: Standard HTML5 input element with webkitdirectory
            const input = document.createElement('input');
            input.type = 'file';
            input.webkitdirectory = true;
            input.directory = true;
            input.multiple = true;
            input.style.display = 'none';

            input.addEventListener('change', () => {
                if (input.files && input.files.length > 0) {
                    const firstFile = input.files[0];
                    const relPath = firstFile.webkitRelativePath || '';
                    const folderName = relPath.split('/')[0] || firstFile.name;
                    resolve(folderName);
                } else {
                    resolve(null);
                }
                input.remove();
            }, { once: true });

            document.body.appendChild(input);
            input.click();
        });
    }

    /**
     * Opens folder picker dialog for LM Studio cache directory.
     * @returns {Promise<string | null>} Selected LM Studio cache path or null.
     */
    static openLMStudioFolderPicker() {
        return new Promise(async (resolve) => {
            if (typeof window.showDirectoryPicker === 'function') {
                try {
                    const dirHandle = await window.showDirectoryPicker();
                    if (dirHandle && dirHandle.name) {
                        return resolve(dirHandle.name);
                    }
                } catch (e) {
                    if (e.name === 'AbortError') return resolve(null);
                }
            }

            const input = document.createElement('input');
            input.type = 'file';
            input.webkitdirectory = true;
            input.directory = true;
            input.style.display = 'none';

            input.addEventListener('change', () => {
                if (input.files && input.files.length > 0) {
                    const firstFile = input.files[0];
                    const relPath = firstFile.webkitRelativePath || '';
                    const folderName = relPath.split('/')[0] || firstFile.name;
                    resolve(folderName);
                } else {
                    resolve(null);
                }
                input.remove();
            }, { once: true });

            document.body.appendChild(input);
            input.click();
        });
    }
}

if (typeof window !== 'undefined') {
    window.BrowserNativeDialogs = BrowserNativeDialogs;
}

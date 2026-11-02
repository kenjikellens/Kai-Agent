/**
 * BrowserNativeDialogs: Manages file and folder picker dialog interactions for browser preview mode.
 */
class BrowserNativeDialogs {
    /**
     * Opens native file picker dialog and reads selected file contents.
     * Attaches temporary input to document body to comply with browser user-activation security policies.
     * @returns {Promise<Array<{ fileName: string, filePath: string, relativePath: string, content: string }>>}
     */
    static openFilePicker() {
        return new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.multiple = true;
            input.style.display = 'none';
            input.accept = '.js,.ts,.jsx,.tsx,.py,.html,.css,.json,.md,.txt,.csv,.java,.c,.cpp,.rs,.go,.php,.rb,.sql,.sh,.yaml,.yml,.xml,.env,.toml,.png,.jpg,.jpeg,.webp,.gif';
            input.addEventListener('change', async () => {
                const files = [];
                for (const file of Array.from(input.files || [])) {
                    if (file.size > 15 * 1024 * 1024) continue;
                    try {
                        const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|svg)$/i.test(file.name);
                        let content = '';
                        if (isImage) {
                            content = await new Promise((res) => {
                                const reader = new FileReader();
                                reader.onload = () => res(reader.result);
                                reader.onerror = () => res('');
                                reader.readAsDataURL(file);
                            });
                        } else {
                            content = await file.text();
                        }
                        files.push({
                            fileName: file.name,
                            filePath: file.name,
                            relativePath: file.name,
                            content: content,
                            isImage: isImage
                        });
                    } catch (error) {}
                }
                input.remove();
                resolve(files);
            }, { once: true });
            document.body.appendChild(input);
            input.click();
        });
    }

    /**
     * Opens native Windows folder picker via backend API with timeout protection and resolves the absolute directory path.
     * Mutates application workspace path and updates top bar and badges upon selection.
     * @returns {Promise<string | null>} Selected absolute workspace folder path or null if canceled.
     */
    static openWorkspaceFolderPicker() {
        return new Promise(async (resolve) => {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 120000);
                const res = await fetch('/api/workspace/pick', {
                    method: 'POST',
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                if (res.ok) {
                    const data = await res.json();
                    if (data && !data.canceled && data.workspacePath) {
                        return resolve(data.workspacePath);
                    }
                    if (data && data.canceled) {
                        return resolve(null);
                    }
                }
            } catch (e) {
                console.warn('Backend folder picker unavailable or timed out:', e);
            }

            resolve(null);
        });
    }

    /**
     * Opens folder picker dialog for LM Studio cache directory via backend Windows dialog or HTML5 fallback.
     * Requests native folder selection to obtain absolute cache directory path.
     * @returns {Promise<string | null>} Selected LM Studio cache path or null.
     */
    static openLMStudioFolderPicker() {
        return new Promise(async (resolve) => {
            // Method 1: Backend Windows PowerShell FolderBrowserDialog (/api/lmstudio/pick)
            try {
                const res = await fetch('/api/lmstudio/pick', { method: 'POST' });
                if (res.ok) {
                    const data = await res.json();
                    if (data && !data.canceled && data.lmStudioCacheDir) {
                        return resolve(data.lmStudioCacheDir);
                    }
                    if (data && data.canceled) {
                        return resolve(null);
                    }
                }
            } catch (e) {}

            // Method 2: Modern window.showDirectoryPicker if supported
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

            // Method 3: Standard HTML5 input element with webkitdirectory
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

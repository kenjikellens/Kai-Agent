/**
 * FileUploadController manages file attachments, file preview chips,
 * file validation, and IPC triggers for the Plus (+) upload button.
 */
class FileUploadController {
    /**
     * Initializes FileUploadController.
     * @param {WebviewIPCBridge} ipcBridge IPC bridge instance.
     * @param {AppState} appState Global application state instance.
     */
    constructor(ipcBridge, appState) {
        this.ipcBridge = ipcBridge;
        this.appState = appState;

        this.attachFileBtn = document.getElementById('attach-file-btn');
        this.attachedFilesBar = document.getElementById('attached-files-bar');

        this.initEventListeners();
        this.initIPCListeners();
    }

    /**
     * Binds DOM event listeners for the attach file button.
     */
    initEventListeners() {
        if (this.attachFileBtn) {
            this.attachFileBtn.addEventListener('click', () => {
                this.ipcBridge.openFilePicker();
            });
        }
    }

    /**
     * Binds IPC event listeners for incoming filesSelected messages.
     */
    initIPCListeners() {
        this.ipcBridge.on('filesSelected', (message) => {
            if (message.files && Array.isArray(message.files)) {
                this.addFiles(message.files);
            }
        });
    }

    /**
     * Appends new file objects to state and refreshes the preview chips bar.
     * @param {Array<object>} files File objects array.
     */
    addFiles(files) {
        for (const file of files) {
            if (!this.appState.attachedFiles.some(f => f.filePath === file.filePath)) {
                this.appState.attachedFiles.push(file);
            }
        }
        this.render();
    }

    /**
     * Removes an attached file by index and re-renders the preview bar.
     * @param {number} index Array index to remove.
     */
    removeFile(index) {
        if (index >= 0 && index < this.appState.attachedFiles.length) {
            this.appState.attachedFiles.splice(index, 1);
            this.render();
        }
    }

    /**
     * Clears all attached files and hides the preview bar.
     */
    clear() {
        this.appState.attachedFiles = [];
        this.render();
    }

    /**
     * Retrieves a copy of the attached files for prompt context sending.
     * @returns {Array<object>} Attached file objects.
     */
    getAttachedFiles() {
        return [...this.appState.attachedFiles];
    }

    /**
     * Resolves the standardized SVG icon corresponding to the file extension.
     * @param {string} fileName File name string.
     * @returns {string} Standardized SVG markup.
     */
    getFileIconSvg(fileName) {
        const svgs = window.KAI_SVGS || {};
        return svgs['read_file'] || '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>';
    }

    /**
     * Renders attached file preview chips into the DOM container.
     */
    render() {
        if (!this.attachedFilesBar) return;

        const files = this.appState.attachedFiles || [];
        if (files.length === 0) {
            this.attachedFilesBar.classList.add('hidden');
            this.attachedFilesBar.innerHTML = '';
            return;
        }

        this.attachedFilesBar.classList.remove('hidden');
        this.attachedFilesBar.innerHTML = '';

        files.forEach((file, index) => {
            const chip = document.createElement('div');
            chip.className = 'attached-file-chip';
            chip.title = file.filePath;

            const parts = file.fileName.split('.');
            const ext = parts.length > 1 ? parts.pop().toUpperCase() : 'FILE';

            // 1. Square Icon Box
            const iconBox = document.createElement('div');
            iconBox.className = 'chip-file-icon-box';
            iconBox.innerHTML = this.getFileIconSvg(file.fileName);

            // 2. Info block: Filename on top, uppercase light extension below
            const infoDiv = document.createElement('div');
            infoDiv.className = 'chip-file-info';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'chip-filename';
            nameSpan.textContent = file.fileName;

            const extSpan = document.createElement('span');
            extSpan.className = 'chip-extension';
            extSpan.textContent = ext;

            infoDiv.appendChild(nameSpan);
            infoDiv.appendChild(extSpan);

            // 3. Remove Button
            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'chip-remove-btn';
            deleteBtn.textContent = '✕';
            deleteBtn.title = 'Remove attached file';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.removeFile(index);
            });

            chip.appendChild(iconBox);
            chip.appendChild(infoDiv);
            chip.appendChild(deleteBtn);
            this.attachedFilesBar.appendChild(chip);
        });
    }
}

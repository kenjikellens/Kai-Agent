/**
 * HelpModalController manages the quick guide modal dialog lifecycle,
 * keyboard shortcuts display, feature documentation, and backdrop events.
 */
class HelpModalController {
    /**
     * Initializes the modal controller, creates the DOM elements if missing, and binds event listeners.
     * @param {WebviewIPCBridge} [ipcBridge] Optional IPC bridge instance.
     */
    constructor(ipcBridge) {
        this.ipcBridge = ipcBridge;
        this.container = document.getElementById('help-container');
        if (!this.container) {
            this.initModalDOM();
        }
        this.initEventListeners();
    }

    /**
     * Dynamically creates the help modal container structure in the DOM.
     */
    initModalDOM() {
        const modal = document.createElement('div');
        modal.id = 'help-container';
        modal.className = 'help-container hidden';
        modal.innerHTML = `
            <div class="help-backdrop"></div>
            <div class="help-modal-card">
                <div class="help-modal-header">
                    <div class="help-modal-title">
                        <img src="media/svg/help_circle.svg" width="16" height="16" alt="help" class="help-title-icon" />
                        <span id="help-modal-title-text">Kai Quick Guide & Shortcuts</span>
                    </div>
                    <button type="button" class="help-close-btn" id="close-help-btn" title="Close">
                        <img src="media/svg/close.svg" width="12" height="12" alt="close" class="help-close-icon" />
                    </button>
                </div>
                <div class="help-modal-body" id="help-modal-body">
                    <!-- Populated dynamically via renderHelpContent() -->
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        this.container = modal;
    }

    /**
     * Registers close button click, backdrop click, and Escape key dismissal.
     */
    initEventListeners() {
        if (!this.container) return;

        // Close button click
        const closeBtn = this.container.querySelector('#close-help-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.close());
        }

        // Backdrop click to dismiss
        const backdrop = this.container.querySelector('.help-backdrop');
        if (backdrop) {
            backdrop.addEventListener('click', () => this.close());
        }

        // Global Escape key listener
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen()) {
                this.close();
            }
        });
    }

    /**
     * Checks whether the help modal is currently visible.
     * @returns {boolean} True if open, false if hidden.
     */
    isOpen() {
        return Boolean(this.container && !this.container.classList.contains('hidden'));
    }

    /**
     * Opens the help modal and renders the latest localized guide content.
     * @param {boolean} [syncHash=true] Whether to trigger hash sync.
     */
    open(syncHash = true) {
        if (!this.container) return;
        this.renderHelpContent();
        this.container.classList.remove('hidden');
        if (syncHash && typeof this.onOpen === 'function') {
            this.onOpen();
        }
    }

    /**
     * Closes the help modal dialog.
     * @param {boolean} [syncHash=true] Whether to trigger hash sync.
     */
    close(syncHash = true) {
        if (!this.container) return;
        this.container.classList.add('hidden');
        if (syncHash && typeof this.onClose === 'function') {
            this.onClose();
        }
    }

    /**
     * Formats and injects the localized sections and keyboard shortcuts table.
     */
    renderHelpContent() {
        const bodyEl = document.getElementById('help-modal-body');
        if (!bodyEl) return;

        bodyEl.innerHTML = `
            <div class="help-section">
                <div class="help-section-title">Modes</div>
                <div class="help-text-block">
                    <p><strong>Chat</strong>: Default mode when no workspace folder is attached. Provides general assistance, calculations, and web search without filesystem access.</p>
                    <p><strong>Ask</strong>: Read-only inspection of the active workspace. Inspects code, searches files, and answers architecture questions without modifying files.</p>
                    <p><strong>Agent</strong>: Autonomous workspace execution. Creates, edits, and deletes project files, and executes commands.</p>
                    <p><strong>Plan</strong>: Generates structured step-by-step implementation plans before performing edits.</p>
                </div>
            </div>

            <div class="help-section">
                <div class="help-section-title">Workspace Management</div>
                <div class="help-text-block">
                    <p>Folder attachment is managed per chat session via the folder button in the input toolbar.</p>
                    <p>When a folder is selected, the AI receives root directory mapping. To change or disconnect the folder, use the central top bar or the close button on the workspace badge.</p>
                </div>
            </div>

            <div class="help-section">
                <div class="help-section-title">Tools & Capabilities</div>
                <div class="help-text-block">
                    <p><strong>Filesystem:</strong> <code>list_dir</code>, <code>read_file</code>, <code>write_file</code>, <code>replace_file_content</code>, <code>delete_item</code></p>
                    <p><strong>Code Search:</strong> <code>grep_search</code>, <code>symbol_search</code>, <code>get_diagnostics</code></p>
                    <p><strong>Web & Network:</strong> <code>web_search</code>, <code>fetch_url</code></p>
                    <p><strong>Utilities:</strong> <code>calculate</code>, <code>get_time</code>, <code>unit_converter</code>, <code>text_stats</code>, <code>uuid_random</code></p>
                </div>
            </div>

            <div class="help-section">
                <div class="help-section-title">Shortcuts</div>
                <div class="help-shortcuts-table">
                    <div class="help-shortcut-row">
                        <span>Send message</span>
                        <kbd class="help-kbd">Enter</kbd>
                    </div>
                    <div class="help-shortcut-row">
                        <span>New line in input</span>
                        <kbd class="help-kbd">Shift + Enter</kbd>
                    </div>
                    <div class="help-shortcut-row">
                        <span>Cancel active generation</span>
                        <kbd class="help-kbd">Escape</kbd>
                    </div>
                    <div class="help-shortcut-row">
                        <span>Open mode selector</span>
                        <kbd class="help-kbd">@</kbd>
                    </div>
                </div>
            </div>
        `;
    }
}

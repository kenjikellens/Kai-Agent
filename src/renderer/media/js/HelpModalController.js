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
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                        <span id="help-modal-title-text">Kai Quick Guide & Shortcuts</span>
                    </div>
                    <button type="button" class="help-close-btn" id="close-help-btn" title="Close">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
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
     */
    open() {
        if (!this.container) return;
        this.renderHelpContent();
        this.container.classList.remove('hidden');
    }

    /**
     * Closes the help modal dialog.
     */
    close() {
        if (!this.container) return;
        this.container.classList.add('hidden');
    }

    /**
     * Formats and injects the localized sections and keyboard shortcuts table.
     */
    renderHelpContent() {
        const bodyEl = document.getElementById('help-modal-body');
        if (!bodyEl) return;

        const i18n = window.KAI_I18N || {};

        bodyEl.innerHTML = `
            <div class="help-section">
                <div class="help-section-title">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
                    <span>${i18n.lmStudioHeader || 'LM Studio & Local Models'}</span>
                </div>
                <div class="help-section-desc">
                    Connect to your local LM Studio server (<code>http://localhost:1234/v1</code>) or select a detected model directly from the toolbar dropdown.
                </div>
            </div>

            <div class="help-section">
                <div class="help-section-title">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path></svg>
                    <span>${i18n.thinkingToggle || 'Thinking & Reasoning'}</span>
                </div>
                <div class="help-section-desc">
                    Toggle model reasoning effort and choose between collapsible or persistent thought process rendering in the settings.
                </div>
            </div>

            <div class="help-section">
                <div class="help-section-title">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"></circle><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"></path></svg>
                    <span>${i18n.planningMode || 'Planning Mode (@)'}</span>
                </div>
                <div class="help-section-desc">
                    Click the <strong>@</strong> icon to enforce step-by-step implementation planning before code modifications begin.
                </div>
            </div>

            <div class="help-section">
                <div class="help-section-title">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"></rect><line x1="6" y1="8" x2="6" y2="8"></line><line x1="10" y1="8" x2="10" y2="8"></line><line x1="14" y1="8" x2="14" y2="8"></line><line x1="18" y1="8" x2="18" y2="8"></line><line x1="6" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="18" y2="12"></line><line x1="6" y1="16" x2="18" y2="16"></line></svg>
                    <span>Keyboard Shortcuts</span>
                </div>
                <div class="help-shortcuts-grid">
                    <div class="help-shortcut-row">
                        <span class="help-shortcut-label">Send message</span>
                        <kbd class="help-kbd">Enter</kbd>
                    </div>
                    <div class="help-shortcut-row">
                        <span class="help-shortcut-label">New line</span>
                        <kbd class="help-kbd">Shift + Enter</kbd>
                    </div>
                    <div class="help-shortcut-row">
                        <span class="help-shortcut-label">Inline edit selection</span>
                        <kbd class="help-kbd">Ctrl + Alt + K</kbd>
                    </div>
                </div>
            </div>
        `;
    }
}

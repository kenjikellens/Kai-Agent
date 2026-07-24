/**
 * SettingsController manages the settings panel UI, localStorage preferences,
 * language select, Gemini thinking level, and the provider API key overlay modal.
 */
class SettingsController {
    /**
     * Initializes setting controls and registers DOM listeners.
     * @param {WebviewIPCBridge} ipcBridge IPC bridge instance.
     */
    constructor(ipcBridge) {
        this.ipcBridge = ipcBridge;

        this.showThinkingToggle = document.getElementById('show-thinking-toggle');
        this.thinkingSubsettings = document.getElementById('thinking-subsettings');
        this.keepThinkingExpandedToggle = document.getElementById('keep-thinking-expanded-toggle');
        this.keepThinkingFinishedExpandedToggle = document.getElementById('keep-thinking-finished-expanded-toggle');
        this.apiKeyInput = document.getElementById('api-key-input');
        this.languageSelectInput = document.getElementById('language-select-input');
        this.geminiThinkingLevelInput = document.getElementById('gemini-thinking-level-input');
        this.keysContainer = document.getElementById('keys-container');
        this.manageKeysBtn = document.getElementById('manage-keys-btn');
        this.closeKeysBtn = document.getElementById('close-keys-btn');
        this.dynamicKeysList = document.getElementById('dynamic-keys-list');

        this.freeProviders = [...KAI_CONSTANTS.DEFAULT_FREE_PROVIDERS];

        this.initSettings();
        this.initEventListeners();
    }

    /**
     * Initializes setting toggles from localStorage.
     */
    initSettings() {
        if (this.showThinkingToggle) {
            const stored = localStorage.getItem('kai.showThinking');
            this.showThinkingToggle.checked = stored === null ? true : stored === 'true';
        }

        if (this.keepThinkingExpandedToggle) {
            const stored = localStorage.getItem('kai.keepThinkingExpanded');
            this.keepThinkingExpandedToggle.checked = stored === null ? true : stored === 'true';
        }

        if (this.keepThinkingFinishedExpandedToggle) {
            const stored = localStorage.getItem('kai.keepThinkingFinishedExpanded');
            this.keepThinkingFinishedExpandedToggle.checked = stored === null ? false : stored === 'true';
        }

        if (this.geminiThinkingLevelInput) {
            const storedLevel = localStorage.getItem('kai.geminiThinkingLevel');
            this.geminiThinkingLevelInput.value = storedLevel || 'high';
        }

        this.updateSubsettingsVisibility();

        if (this.languageSelectInput && window.KAI_LANG) {
            this.languageSelectInput.value = window.KAI_LANG;
        }
    }

    /**
     * Registers event listeners for settings controls and keys panel.
     */
    initEventListeners() {
        if (this.showThinkingToggle) {
            this.showThinkingToggle.addEventListener('change', () => {
                localStorage.setItem('kai.showThinking', this.showThinkingToggle.checked);
                this.updateSubsettingsVisibility();
            });
        }

        if (this.keepThinkingExpandedToggle) {
            this.keepThinkingExpandedToggle.addEventListener('change', () => {
                localStorage.setItem('kai.keepThinkingExpanded', this.keepThinkingExpandedToggle.checked);
            });
        }

        if (this.keepThinkingFinishedExpandedToggle) {
            this.keepThinkingFinishedExpandedToggle.addEventListener('change', () => {
                localStorage.setItem('kai.keepThinkingFinishedExpanded', this.keepThinkingFinishedExpandedToggle.checked);
            });
        }

        if (this.geminiThinkingLevelInput) {
            this.geminiThinkingLevelInput.addEventListener('change', () => {
                const val = this.geminiThinkingLevelInput.value;
                localStorage.setItem('kai.geminiThinkingLevel', val);
                const textEl = document.getElementById('gemini-thinking-text');
                const menuEl = document.getElementById('gemini-thinking-menu');
                if (textEl) {
                    const labels = { 'high': 'Thinking: High', 'medium': 'Thinking: Med', 'low': 'Thinking: Low', 'minimal': 'Thinking: Off' };
                    textEl.textContent = labels[val] || 'Thinking: High';
                }
                if (menuEl) {
                    const items = menuEl.querySelectorAll('.dropdown-item');
                    items.forEach(item => {
                        if (item.dataset.level === val) item.classList.add('selected');
                        else item.classList.remove('selected');
                    });
                }
            });
        }

        if (this.apiKeyInput) {
            this.apiKeyInput.addEventListener('change', () => {
                this.saveAllApiKeys();
            });
        }

        if (this.languageSelectInput) {
            this.languageSelectInput.addEventListener('change', () => {
                this.ipcBridge.updateSettings({
                    language: this.languageSelectInput.value
                });
            });
        }

        if (this.manageKeysBtn) {
            this.manageKeysBtn.addEventListener('click', () => {
                if (this.keysContainer) {
                    this.keysContainer.classList.remove('hidden');
                    this.renderProviderKeyInputs();
                }
            });
        }

        if (this.closeKeysBtn) {
            this.closeKeysBtn.addEventListener('click', () => {
                if (this.keysContainer) {
                    this.keysContainer.classList.add('hidden');
                }
            });
        }
    }

    /**
     * Retrieves the active Gemini reasoning level setting (high, medium, low, minimal).
     * @returns {string} The active reasoning level string.
     */
    getGeminiThinkingLevel(modelId) {
        if (modelId) {
            const perModel = localStorage.getItem(`kai.geminiThinkingLevel.${modelId}`);
            if (perModel) return perModel;
        }
        if (this.geminiThinkingLevelInput) {
            return this.geminiThinkingLevelInput.value || 'high';
        }
        return localStorage.getItem('kai.geminiThinkingLevel') || 'high';
    }

    /**
     * Updates settings state and renders API key inputs when connection status arrives from extension host.
     * @param {object} message Connection status message.
     */
    updateConnectionStatus(message) {
        if (this.apiKeyInput && message.apiKey !== undefined) {
            this.apiKeyInput.value = message.apiKey;
        }
        if (message.freeProviders && message.freeProviders.length > 0) {
            this.freeProviders = message.freeProviders;
        }
        this.renderProviderKeyInputs();
    }

    /**
     * Toggles visibility of thinking subsettings based on showThinkingToggle state.
     */
    updateSubsettingsVisibility() {
        if (this.thinkingSubsettings && this.showThinkingToggle) {
            if (this.showThinkingToggle.checked) {
                this.thinkingSubsettings.classList.remove('hidden');
            } else {
                this.thinkingSubsettings.classList.add('hidden');
            }
        }
    }

    /**
     * Collects all provider API keys and sends an updateSettings IPC payload.
     */
    saveAllApiKeys() {
        const providerKeys = {};
        document.querySelectorAll('.provider-api-key-input').forEach(input => {
            const configKey = input.dataset.configKey;
            if (configKey) {
                providerKeys[configKey] = input.value;
            }
        });
        this.ipcBridge.updateSettings({
            apiKey: this.apiKeyInput ? this.apiKeyInput.value : '',
            providerKeys
        });
    }

    /**
     * Renders API key input fields for free tier providers in the keys overlay modal.
     * @param {Array<object>|null} freeProviders Optional override list of provider config objects.
     */
    renderProviderKeyInputs(freeProviders = null) {
        if (!this.dynamicKeysList) return;
        this.dynamicKeysList.innerHTML = '';

        const providers = freeProviders || (this.freeProviders && this.freeProviders.length > 0 ? this.freeProviders : KAI_CONSTANTS.DEFAULT_FREE_PROVIDERS);

        for (const provider of providers) {
            const wrapper = document.createElement('div');
            wrapper.className = 'setting-item';

            const label = document.createElement('label');
            label.textContent = `${provider.name} API Key`;
            label.setAttribute('for', `provider-key-${provider.configKey}`);

            const input = document.createElement('input');
            input.type = 'password';
            input.id = `provider-key-${provider.configKey}`;
            input.className = 'provider-api-key-input';
            input.dataset.configKey = provider.configKey;
            input.placeholder = provider.keyHint || 'Enter API key…';
            input.value = provider.apiKey || '';

            input.addEventListener('change', () => {
                this.saveAllApiKeys();
            });

            wrapper.appendChild(label);
            wrapper.appendChild(input);
            this.dynamicKeysList.appendChild(wrapper);
        }
    }

    /**
     * Closes the API keys overlay modal if open.
     */
    hideKeysOverlay() {
        if (this.keysContainer) {
            this.keysContainer.classList.add('hidden');
        }
    }
}

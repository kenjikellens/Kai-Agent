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
     * Initializes setting toggles from localStorage using ToggleComponent.
     */
    initSettings() {
        const i18n = window.KAI_I18N || {};

        const showContainer = document.getElementById('show-thinking-toggle-container');
        if (showContainer) {
            showContainer.innerHTML = '';
            const stored = localStorage.getItem('kai.showThinking');
            const isChecked = stored === null ? true : stored === 'true';
            const el = ToggleComponent.create({
                id: 'show-thinking-toggle',
                checked: isChecked,
                label: i18n.showThinking || 'Show thinking process',
                onChange: (checked) => {
                    localStorage.setItem('kai.showThinking', checked);
                    this.updateSubsettingsVisibility();
                }
            });
            showContainer.appendChild(el);
            this.showThinkingToggle = el.querySelector('input[type="checkbox"]');
        }

        const keepContainer = document.getElementById('keep-thinking-expanded-container');
        if (keepContainer) {
            keepContainer.innerHTML = '';
            const stored = localStorage.getItem('kai.keepThinkingExpanded');
            const isChecked = stored === null ? true : stored === 'true';
            const el = ToggleComponent.create({
                id: 'keep-thinking-expanded-toggle',
                checked: isChecked,
                label: i18n.keepThinkingGenerating || 'Keep thinking expanded while generating',
                onChange: (checked) => {
                    localStorage.setItem('kai.keepThinkingExpanded', checked);
                }
            });
            keepContainer.appendChild(el);
            this.keepThinkingExpandedToggle = el.querySelector('input[type="checkbox"]');
        }

        const finishedContainer = document.getElementById('keep-thinking-finished-container');
        if (finishedContainer) {
            finishedContainer.innerHTML = '';
            const stored = localStorage.getItem('kai.keepThinkingFinishedExpanded');
            const isChecked = stored === null ? false : stored === 'true';
            const el = ToggleComponent.create({
                id: 'keep-thinking-finished-expanded-toggle',
                checked: isChecked,
                label: i18n.keepThinkingFinished || 'Keep thinking expanded after reasoning',
                onChange: (checked) => {
                    localStorage.setItem('kai.keepThinkingFinishedExpanded', checked);
                }
            });
            finishedContainer.appendChild(el);
            this.keepThinkingFinishedExpandedToggle = el.querySelector('input[type="checkbox"]');
        }

        if (this.geminiThinkingLevelInput) {
            const storedLevel = localStorage.getItem('kai.geminiThinkingLevel');
            this.geminiThinkingLevelInput.value = storedLevel || 'high';
        }

        this.updateSubsettingsVisibility();

        const langContainer = document.getElementById('language-select-container');
        if (langContainer && typeof CustomSelectComponent !== 'undefined') {
            const initialLang = window.KAI_LANG || 'auto';
            const langOptions = [
                { value: 'auto', label: 'Auto (VS Code)' },
                { value: 'en', label: 'English' },
                { value: 'nl', label: 'Nederlands' },
                { value: 'de', label: 'Deutsch' },
                { value: 'fr', label: 'Français' },
                { value: 'es', label: 'Español' }
            ];
            this.languageSelectComponent = new CustomSelectComponent({
                container: langContainer,
                id: 'language-select-input',
                options: langOptions,
                value: initialLang,
                onChange: (selectedLang) => {
                    this.ipcBridge.updateSettings({
                        language: selectedLang
                    });
                }
            });
        }

        const styleContainer = document.getElementById('thinking-display-style-container');
        if (styleContainer && typeof CustomSelectComponent !== 'undefined') {
            const storedStyle = localStorage.getItem('kai.thinkingDisplayStyle') || 'both';
            const styleOptions = [
                { value: 'both', label: 'Battery Icon + Text' },
                { value: 'icon', label: 'Battery Icon Only' },
                { value: 'text', label: 'Text Only' }
            ];
            this.thinkingStyleComponent = new CustomSelectComponent({
                container: styleContainer,
                id: 'thinking-display-style-input',
                options: styleOptions,
                value: storedStyle,
                onChange: (selectedStyle) => {
                    localStorage.setItem('kai.thinkingDisplayStyle', selectedStyle);
                    window.dispatchEvent(new CustomEvent('kaiThinkingStyleChanged', { detail: { style: selectedStyle } }));
                }
            });
        }
    }

    /**
     * Registers event listeners for settings controls and keys panel.
     */
    initEventListeners() {
        if (this.geminiThinkingLevelInput) {
            this.geminiThinkingLevelInput.addEventListener('change', () => {
                const val = this.geminiThinkingLevelInput.value;
                localStorage.setItem('kai.geminiThinkingLevel', val);
            });
        }

        if (this.apiKeyInput) {
            this.apiKeyInput.addEventListener('change', () => {
                this.saveAllApiKeys();
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
        const globalSaved = localStorage.getItem('kai.geminiThinkingLevel');
        if (globalSaved) return globalSaved;
        if (this.geminiThinkingLevelInput) {
            return this.geminiThinkingLevelInput.value || 'high';
        }
        return 'high';
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

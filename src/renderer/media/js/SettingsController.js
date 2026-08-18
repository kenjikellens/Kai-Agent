/**
 * SettingsController manages the settings panel UI, localStorage preferences,
 * custom select dropdowns, category collapse states, LM Studio server & cache configuration,
 * and external provider API keys with overlay modal.
 */
class SettingsController {
    /**
     * Initializes setting controls and registers DOM listeners.
     * @param {WebviewIPCBridge} ipcBridge IPC bridge instance.
     */
    constructor(ipcBridge) {
        this.ipcBridge = ipcBridge;

        this.serverUrlInput = document.getElementById('settings-server-url');
        this.lmStudioPathInput = document.getElementById('settings-lmstudio-path');
        this.browseLMStudioBtn = document.getElementById('browse-lmstudio-path-btn');
        this.cacheStatusDot = document.getElementById('cache-status-dot');
        this.cacheStatusText = document.getElementById('cache-status-text');

        this.showThinkingToggle = document.getElementById('show-thinking-toggle');
        this.thinkingSubsettings = document.getElementById('thinking-subsettings');
        this.keepThinkingExpandedToggle = document.getElementById('keep-thinking-expanded-toggle');
        this.keepThinkingFinishedExpandedToggle = document.getElementById('keep-thinking-finished-expanded-toggle');
        this.geminiThinkingLevelInput = document.getElementById('gemini-thinking-level-input');
        this.apiKeyInput = document.getElementById('api-key-input');

        this.keysContainer = document.getElementById('keys-container');
        this.manageKeysBtn = document.getElementById('manage-keys-btn');
        this.closeKeysBtn = document.getElementById('close-keys-btn');
        this.dynamicKeysList = document.getElementById('dynamic-keys-list');

        this.freeProviders = [...KAI_CONSTANTS.DEFAULT_FREE_PROVIDERS];

        this.initSettings();
        this.initEventListeners();
    }

    /**
     * Initializes setting toggles and custom selects from localStorage.
     */
    initSettings() {
        const i18n = window.KAI_I18N || {};

        // 1. Show thinking process toggle
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

        // 2. Keep thinking expanded while generating
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

        // 3. Keep thinking expanded after reasoning
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

        // 4. Gemini Default Thinking Level
        if (this.geminiThinkingLevelInput) {
            const storedLevel = localStorage.getItem('kai.geminiThinkingLevel');
            this.geminiThinkingLevelInput.value = storedLevel || 'high';
        }

        this.updateSubsettingsVisibility();

        // 5. Language Custom Select Dropdown
        const langContainer = document.getElementById('language-select-container');
        if (langContainer && typeof CustomSelectComponent !== 'undefined') {
            const initialLang = window.KAI_LANG || 'auto';
            const langOptions = window.KAI_SUPPORTED_LANGUAGES || [
                { value: 'auto', label: 'Auto (System Default)' },
                { value: 'en', label: 'English' },
                { value: 'nl', label: 'Nederlands' }
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

        // 6. Thinking Display Style Custom Select Dropdown (Icon + Text / Icon Only / Text Only)
        const styleContainer = document.getElementById('thinking-display-style-container');
        if (styleContainer && typeof CustomSelectComponent !== 'undefined') {
            const storedStyle = localStorage.getItem('kai.thinkingDisplayStyle') || 'both';
            const styleOptions = [
                { value: 'both', label: i18n.iconAndText || 'Icon + Text' },
                { value: 'icon', label: i18n.iconOnly || 'Icon Only' },
                { value: 'text', label: i18n.textOnly || 'Text Only' }
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
     * Registers event listeners for settings controls, categories, and keys overlay.
     */
    initEventListeners() {
        // Collapsible category accordion headers
        const categoryBtns = document.querySelectorAll('.category-header-btn');
        categoryBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const categoryEl = btn.closest('.settings-category');
                if (categoryEl) {
                    categoryEl.classList.toggle('collapsed');
                }
            });
        });

        if (this.browseLMStudioBtn) {
            this.browseLMStudioBtn.addEventListener('click', () => {
                this.ipcBridge.browseLMStudioFolder();
            });
        }

        if (this.serverUrlInput) {
            this.serverUrlInput.addEventListener('change', () => {
                this.saveAllSettings();
            });
        }

        if (this.lmStudioPathInput) {
            this.lmStudioPathInput.addEventListener('change', () => {
                this.saveAllSettings();
            });
        }

        if (this.geminiThinkingLevelInput) {
            this.geminiThinkingLevelInput.addEventListener('change', () => {
                localStorage.setItem('kai.geminiThinkingLevel', this.geminiThinkingLevelInput.value);
            });
        }

        if (this.apiKeyInput) {
            this.apiKeyInput.addEventListener('change', () => {
                this.saveAllSettings();
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
                this.hideKeysOverlay();
            });
        }
    }

    /**
     * Hides the provider API keys overlay modal.
     */
    hideKeysOverlay() {
        if (this.keysContainer) {
            this.keysContainer.classList.add('hidden');
        }
    }

    /**
     * Retrieves the active Gemini reasoning level setting.
     * @param {string} modelId Model ID string.
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
        if (this.serverUrlInput && message.serverUrl !== undefined) {
            this.serverUrlInput.value = message.serverUrl;
        }
        if (this.lmStudioPathInput && message.lmStudioCacheDir !== undefined) {
            this.lmStudioPathInput.value = message.lmStudioCacheDir;
        }
        if (this.apiKeyInput && message.apiKey !== undefined) {
            this.apiKeyInput.value = message.apiKey;
        }

        if (message.lmStudioCacheStatus && this.cacheStatusDot && this.cacheStatusText) {
            const status = message.lmStudioCacheStatus;
            const i18n = window.KAI_I18N || {};
            if (status.valid) {
                this.cacheStatusDot.className = 'status-dot status-connected';
                const template = i18n.cacheLoaded || 'Model index loaded ({count} models detected)';
                this.cacheStatusText.textContent = `✓ ${template.replace('{count}', status.modelCount)}`;
                this.cacheStatusText.style.color = 'var(--app-success, #4ec9b0)';
            } else {
                this.cacheStatusDot.className = 'status-dot status-disconnected';
                this.cacheStatusText.textContent = `✗ ${status.error || i18n.cacheNotFound || 'Model index not found'}`;
                this.cacheStatusText.style.color = 'var(--app-danger, #f44747)';
            }
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
     * Collects all settings (Server URL, LM Studio Path, API keys) and sends updateSettings IPC.
     */
    saveAllSettings() {
        const providerKeys = {};
        document.querySelectorAll('.provider-api-key-input').forEach(input => {
            const configKey = input.dataset.configKey;
            if (configKey) {
                providerKeys[configKey] = input.value;
            }
        });

        this.ipcBridge.updateSettings({
            serverUrl: this.serverUrlInput ? this.serverUrlInput.value : 'http://localhost:1234/v1',
            lmStudioCacheDir: this.lmStudioPathInput ? this.lmStudioPathInput.value : '',
            apiKey: this.apiKeyInput ? this.apiKeyInput.value : '',
            providerKeys: providerKeys
        });
    }

    /**
     * Renders API key input fields for external providers inside the keys modal overlay.
     */
    renderProviderKeyInputs() {
        if (!this.dynamicKeysList) return;
        this.dynamicKeysList.innerHTML = '';

        const providers = this.freeProviders && this.freeProviders.length > 0 ? this.freeProviders : KAI_CONSTANTS.DEFAULT_FREE_PROVIDERS;

        for (const provider of providers) {
            const wrapper = document.createElement('div');
            wrapper.className = 'setting-item';

            const label = document.createElement('label');
            label.className = 'setting-label';
            label.textContent = `${provider.name} API Key / URL`;
            label.setAttribute('for', `provider-key-${provider.configKey}`);

            const input = document.createElement('input');
            input.type = provider.configKey.includes('Url') ? 'text' : 'password';
            input.id = `provider-key-${provider.configKey}`;
            input.className = 'settings-input provider-api-key-input';
            input.dataset.configKey = provider.configKey;
            input.placeholder = provider.keyHint || 'Enter API key…';
            input.value = provider.apiKey || '';

            input.addEventListener('change', () => this.saveAllSettings());

            wrapper.appendChild(label);
            wrapper.appendChild(input);
            this.dynamicKeysList.appendChild(wrapper);
        }
    }
}

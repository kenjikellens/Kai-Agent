/**
 * SettingsController manages the settings panel UI, localStorage preferences,
 * language selection, LM Studio server & cache configuration, and provider API keys.
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
        this.settingsSaveBtn = document.getElementById('settings-save-btn');
        this.providersContainer = document.getElementById('settings-providers-container');

        this.showThinkingToggle = document.getElementById('show-thinking-toggle');
        this.thinkingSubsettings = document.getElementById('thinking-subsettings');
        this.keepThinkingExpandedToggle = document.getElementById('keep-thinking-expanded-toggle');
        this.keepThinkingFinishedExpandedToggle = document.getElementById('keep-thinking-finished-expanded-toggle');
        this.geminiThinkingLevelInput = document.getElementById('gemini-thinking-level-input');

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

        const langSelect = document.getElementById('settings-language');
        if (langSelect) {
            langSelect.value = window.KAI_LANG || 'auto';
            langSelect.addEventListener('change', () => {
                this.ipcBridge.updateSettings({
                    language: langSelect.value
                });
            });
        }
    }

    /**
     * Registers event listeners for settings controls and folder browse button.
     */
    initEventListeners() {
        if (this.browseLMStudioBtn) {
            this.browseLMStudioBtn.addEventListener('click', () => {
                this.ipcBridge.browseLMStudioFolder();
            });
        }

        if (this.settingsSaveBtn) {
            this.settingsSaveBtn.addEventListener('click', () => {
                this.saveAllSettings();
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

        if (message.lmStudioCacheStatus && this.cacheStatusDot && this.cacheStatusText) {
            const status = message.lmStudioCacheStatus;
            if (status.valid) {
                this.cacheStatusDot.className = 'status-dot status-connected';
                this.cacheStatusText.textContent = `✓ Model index geladen (${status.modelCount} modellen gedetecteerd)`;
                this.cacheStatusText.style.color = 'var(--app-success, #4ec9b0)';
            } else {
                this.cacheStatusDot.className = 'status-dot status-disconnected';
                this.cacheStatusText.textContent = `✗ ${status.error || 'Model index niet gevonden'}`;
                this.cacheStatusText.style.color = 'var(--app-danger, #f44747)';
            }
        }

        if (message.freeProviders && message.freeProviders.length > 0) {
            this.freeProviders = message.freeProviders;
        }
        this.renderProviderKeyInputs(message.apiKey);
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

        const geminiKeyInput = document.getElementById('provider-key-apiKey');
        const geminiApiKey = geminiKeyInput ? geminiKeyInput.value : '';

        this.ipcBridge.updateSettings({
            serverUrl: this.serverUrlInput ? this.serverUrlInput.value : 'http://localhost:1234/v1',
            lmStudioCacheDir: this.lmStudioPathInput ? this.lmStudioPathInput.value : '',
            apiKey: geminiApiKey,
            providerKeys: providerKeys
        });
    }

    /**
     * Renders API key input fields for external providers in the settings panel.
     * @param {string} geminiApiKey Active Gemini API key.
     */
    renderProviderKeyInputs(geminiApiKey = '') {
        const container = this.providersContainer || document.getElementById('settings-providers-container');
        if (!container) return;
        container.innerHTML = '';

        // 1. Google Gemini API key
        const geminiWrapper = document.createElement('div');
        geminiWrapper.className = 'setting-item';
        geminiWrapper.style.marginBottom = '8px';

        const geminiLabel = document.createElement('label');
        geminiLabel.className = 'settings-label';
        geminiLabel.textContent = 'Google Gemini API Key';
        geminiLabel.setAttribute('for', 'provider-key-apiKey');

        const geminiInput = document.createElement('input');
        geminiInput.type = 'password';
        geminiInput.id = 'provider-key-apiKey';
        geminiInput.className = 'settings-input provider-api-key-input';
        geminiInput.dataset.configKey = 'apiKey';
        geminiInput.placeholder = 'AIzaSy...';
        geminiInput.value = geminiApiKey || '';
        geminiInput.addEventListener('change', () => this.saveAllSettings());

        geminiWrapper.appendChild(geminiLabel);
        geminiWrapper.appendChild(geminiInput);
        container.appendChild(geminiWrapper);

        // 2. Free external cloud providers (Mistral, Cohere, Cerebras, Zhipu, OmniRoute)
        const providers = this.freeProviders && this.freeProviders.length > 0 ? this.freeProviders : KAI_CONSTANTS.DEFAULT_FREE_PROVIDERS;

        for (const provider of providers) {
            const wrapper = document.createElement('div');
            wrapper.className = 'setting-item';
            wrapper.style.marginBottom = '8px';

            const label = document.createElement('label');
            label.className = 'settings-label';
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
            container.appendChild(wrapper);
        }
    }
}

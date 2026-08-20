/**
 * SettingsController manages the clean settings panel UI, localStorage preferences,
 * custom select dropdowns, LM Studio server & cache configuration,
 * external provider API keys, and dynamic multi-language localization.
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

        this.showThinkingToggle = null;
        this.keepThinkingExpandedToggle = null;
        this.keepThinkingFinishedExpandedToggle = null;
        this.geminiThinkingLevelInput = document.getElementById('gemini-thinking-level-input');
        this.geminiKeyInput = document.getElementById('settings-gemini-key');

        this.closeSettingsBtn = document.getElementById('close-settings-btn');
        this.freeProvidersKeysList = document.getElementById('free-providers-keys-list');

        this.freeProviders = [...KAI_CONSTANTS.DEFAULT_FREE_PROVIDERS];

        this.initSettings();
        this.initEventListeners();
    }

    /**
     * Initializes setting toggles and custom selects from localStorage.
     */
    initSettings() {
        const i18n = window.KAI_I18N || {};

        // 1. Show thinking process row
        const showRow = document.getElementById('show-thinking-setting-row');
        if (showRow) {
            showRow.innerHTML = `
                <div class="setting-info">
                    <span class="setting-label" data-i18n="showThinking">${i18n.showThinking || 'Verbose (Show thinking process)'}</span>
                </div>
                <div class="setting-control" id="show-thinking-toggle-container"></div>
            `;
            const showContainer = document.getElementById('show-thinking-toggle-container');
            const stored = localStorage.getItem('kai.showThinking');
            const isChecked = stored === null ? true : stored === 'true';
            const el = ToggleComponent.create({
                id: 'show-thinking-toggle',
                checked: isChecked,
                label: '',
                onChange: (checked) => {
                    localStorage.setItem('kai.showThinking', checked);
                    this.updateSubsettingsVisibility();
                }
            });
            showContainer.appendChild(el);
            this.showThinkingToggle = el.querySelector('input[type="checkbox"]');
        }

        // 2. Keep thinking expanded while generating row
        const keepRow = document.getElementById('keep-thinking-generating-setting-row');
        if (keepRow) {
            keepRow.innerHTML = `
                <div class="setting-info">
                    <span class="setting-label" data-i18n="keepThinkingGenerating">${i18n.keepThinkingGenerating || 'Keep thinking expanded while generating'}</span>
                </div>
                <div class="setting-control" id="keep-thinking-expanded-container"></div>
            `;
            const keepContainer = document.getElementById('keep-thinking-expanded-container');
            const stored = localStorage.getItem('kai.keepThinkingExpanded');
            const isChecked = stored === null ? true : stored === 'true';
            const el = ToggleComponent.create({
                id: 'keep-thinking-expanded-toggle',
                checked: isChecked,
                label: '',
                onChange: (checked) => {
                    localStorage.setItem('kai.keepThinkingExpanded', checked);
                }
            });
            keepContainer.appendChild(el);
            this.keepThinkingExpandedToggle = el.querySelector('input[type="checkbox"]');
        }

        // 3. Keep thinking expanded after reasoning row
        const finishedRow = document.getElementById('keep-thinking-finished-setting-row');
        if (finishedRow) {
            finishedRow.innerHTML = `
                <div class="setting-info">
                    <span class="setting-label" data-i18n="keepThinkingFinished">${i18n.keepThinkingFinished || 'Keep thinking expanded after reasoning is done'}</span>
                </div>
                <div class="setting-control" id="keep-thinking-finished-container"></div>
            `;
            const finishedContainer = document.getElementById('keep-thinking-finished-container');
            const stored = localStorage.getItem('kai.keepThinkingFinishedExpanded');
            const isChecked = stored === null ? false : stored === 'true';
            const el = ToggleComponent.create({
                id: 'keep-thinking-finished-expanded-toggle',
                checked: isChecked,
                label: '',
                onChange: (checked) => {
                    localStorage.setItem('kai.keepThinkingFinishedExpanded', checked);
                }
            });
            finishedContainer.appendChild(el);
            this.keepThinkingFinishedExpandedToggle = el.querySelector('input[type="checkbox"]');
        }

        this.updateSubsettingsVisibility();

        // 4. Language Custom Select Dropdown (All 18 languages)
        const langContainer = document.getElementById('language-select-container');
        if (langContainer && typeof CustomSelectComponent !== 'undefined') {
            const initialLang = localStorage.getItem('kai.language') || window.KAI_LANG || 'auto';
            const langOptions = window.KAI_SUPPORTED_LANGUAGES || [
                { value: 'auto', label: 'Auto (System)' },
                { value: 'en', label: 'English' },
                { value: 'nl', label: 'Nederlands' }
            ];
            this.languageSelectComponent = new CustomSelectComponent({
                container: langContainer,
                id: 'language-select-input',
                options: langOptions,
                value: initialLang,
                onChange: (selectedLang) => {
                    localStorage.setItem('kai.language', selectedLang);
                    window.KAI_LANG = selectedLang;

                    const allLocales = window.KAI_ALL_LOCALES || {};
                    let targetDict = allLocales[selectedLang];
                    if (!targetDict && selectedLang === 'auto') {
                        const sys = (navigator.language || 'en').slice(0, 2).toLowerCase();
                        targetDict = allLocales[sys] || allLocales.en;
                    }
                    if (!targetDict && allLocales) {
                        targetDict = allLocales.en || {};
                    }

                    if (targetDict && typeof window.applyAllTranslations === 'function') {
                        window.applyAllTranslations(targetDict);
                    }

                    this.ipcBridge.updateSettings({
                        language: selectedLang
                    });
                }
            });
        }

        // 5. UI Scale Custom Select Dropdown (Scales text, buttons, icons, modals)
        const uiScaleContainer = document.getElementById('ui-scale-select-container');
        if (uiScaleContainer && typeof CustomSelectComponent !== 'undefined') {
            const storedScale = localStorage.getItem('kai.uiScale') || '1.0';
            const scaleOptions = [
                { value: '0.8', label: '80% (Compact)' },
                { value: '0.9', label: '90%' },
                { value: '1.0', label: '100% (Default)' },
                { value: '1.1', label: '110%' },
                { value: '1.2', label: '120% (Comfortable)' },
                { value: '1.3', label: '130% (Large)' },
                { value: '1.4', label: '140% (Extra Large)' }
            ];
            this.uiScaleComponent = new CustomSelectComponent({
                container: uiScaleContainer,
                id: 'ui-scale-select-input',
                options: scaleOptions,
                value: storedScale,
                onChange: (selectedScale) => {
                    localStorage.setItem('kai.uiScale', selectedScale);
                    document.documentElement.style.zoom = selectedScale;
                }
            });
        }

        // 6. Thinking Process Max Height Custom Select Dropdown (50px to 400px in steps of 50px)
        const maxHeightContainer = document.getElementById('thinking-max-height-select-container');
        if (maxHeightContainer && typeof CustomSelectComponent !== 'undefined') {
            const storedHeight = localStorage.getItem('kai.thinkingMaxHeight') || '150px';
            const heightOptions = [
                { value: '50px', label: '50px' },
                { value: '100px', label: '100px' },
                { value: '150px', label: '150px' },
                { value: '200px', label: '200px' },
                { value: '250px', label: '250px' },
                { value: '300px', label: '300px' },
                { value: '350px', label: '350px' },
                { value: '400px', label: '400px' }
            ];
            this.thinkingMaxHeightComponent = new CustomSelectComponent({
                container: maxHeightContainer,
                id: 'thinking-max-height-input',
                options: heightOptions,
                value: storedHeight,
                onChange: (selectedHeight) => {
                    localStorage.setItem('kai.thinkingMaxHeight', selectedHeight);
                    document.documentElement.style.setProperty('--app-thinking-max-height', selectedHeight);
                }
            });
        }
    }

    /**
     * Registers event listeners for settings controls.
     */
    initEventListeners() {
        // Collapsible category accordion headers (independent toggle)
        const categoryBtns = document.querySelectorAll('.category-header-btn');
        categoryBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const categoryEl = btn.closest('.settings-category');
                if (!categoryEl) return;
                
                categoryEl.classList.toggle('collapsed');
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

        if (this.geminiKeyInput) {
            this.geminiKeyInput.addEventListener('input', () => {
                const keyVal = this.geminiKeyInput.value.trim();
                localStorage.setItem('kai.geminiApiKey', keyVal);
                localStorage.setItem('kai.apiKey', keyVal);
                if (this.settingsRepo) this.settingsRepo.setProviderKey('geminiApiKey', keyVal);
                window.dispatchEvent(new CustomEvent('kaiProviderKeysUpdated'));
            });
            this.geminiKeyInput.addEventListener('change', () => {
                this.saveAllSettings();
            });
        }

        const eyeSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
        const eyeOffSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';

        // Toggle password reveal buttons
        document.querySelectorAll('.toggle-password-btn').forEach(btn => {
            btn.innerHTML = eyeSvg;
            btn.addEventListener('click', () => {
                const targetId = btn.getAttribute('data-target');
                const targetInput = document.getElementById(targetId);
                if (targetInput) {
                    const isPassword = targetInput.type === 'password';
                    targetInput.type = isPassword ? 'text' : 'password';
                    btn.innerHTML = isPassword ? eyeOffSvg : eyeSvg;
                }
            });
        });
    }

    /**
     * Dynamically updates localized strings across all data-i18n nodes in Settings.
     * @param {object} translations Map of translation keys to translated strings.
     */
    applyTranslations(translations) {
        if (!translations) return;
        const i18nNodes = document.querySelectorAll('[data-i18n]');
        i18nNodes.forEach(node => {
            const key = node.getAttribute('data-i18n');
            if (translations[key]) {
                node.textContent = translations[key];
            }
        });
    }

    /**
     * Toggles visibility of dependent thinking subsettings based on main toggle state.
     */
    updateSubsettingsVisibility() {
        const isShow = this.showThinkingToggle ? this.showThinkingToggle.checked : true;
        const genRow = document.getElementById('keep-thinking-generating-setting-row');
        const finRow = document.getElementById('keep-thinking-finished-setting-row');
        if (genRow) genRow.style.display = isShow ? 'flex' : 'none';
        if (finRow) finRow.style.display = isShow ? 'flex' : 'none';
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
        return 'high';
    }

    /**
     * Updates settings state and renders API key inputs when connection status arrives.
     * @param {object} message Connection status message.
     */
    updateConnectionStatus(message) {
        if (message.translations) {
            this.applyTranslations(message.translations);
        }

        if (this.serverUrlInput && message.serverUrl !== undefined) {
            this.serverUrlInput.value = message.serverUrl;
        }
        if (this.lmStudioPathInput && message.lmStudioCacheDir !== undefined) {
            this.lmStudioPathInput.value = message.lmStudioCacheDir;
        }
        if (this.geminiKeyInput && message.apiKey !== undefined) {
            this.geminiKeyInput.value = message.apiKey;
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
     * Dynamically renders input fields for all free cloud providers matching standard row design.
     */
    renderProviderKeyInputs() {
        if (!this.freeProvidersKeysList) return;
        this.freeProvidersKeysList.innerHTML = '';

        this.freeProviders.forEach((provider) => {
            const row = document.createElement('div');
            row.className = 'provider-key-row setting-row';

            const info = document.createElement('div');
            info.className = 'setting-info';

            const name = document.createElement('span');
            name.className = 'setting-label';
            name.textContent = provider.name;
            info.appendChild(name);

            const control = document.createElement('div');
            control.className = 'provider-key-control setting-control';

            const passWrapper = document.createElement('div');
            passWrapper.className = 'password-input-wrapper';

            const inputId = `provider-key-${provider.id || provider.name.toLowerCase().replace(/\\s+/g, '-')}`;

            const input = document.createElement('input');
            input.id = inputId;
            input.type = 'password';
            input.className = 'setting-input-text';
            input.placeholder = `${provider.name} API Key`;
            input.value = provider.apiKey || '';

            const eyeSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
            const eyeOffSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';

            const toggleBtn = document.createElement('button');
            toggleBtn.type = 'button';
            toggleBtn.className = 'toggle-password-btn';
            toggleBtn.innerHTML = eyeSvg;
            toggleBtn.title = 'Show/Hide';
            toggleBtn.addEventListener('click', () => {
                const isPassword = input.type === 'password';
                input.type = isPassword ? 'text' : 'password';
                toggleBtn.innerHTML = isPassword ? eyeOffSvg : eyeSvg;
            });

            input.addEventListener('input', () => {
                provider.apiKey = input.value.trim();
                if (provider.configKey) {
                    localStorage.setItem(`kai.${provider.configKey}`, provider.apiKey);
                    if (this.settingsRepo) this.settingsRepo.setProviderKey(provider.configKey, provider.apiKey);
                    window.dispatchEvent(new CustomEvent('kaiProviderKeysUpdated'));
                }
            });

            input.addEventListener('change', () => {
                provider.apiKey = input.value.trim();
                this.saveAllSettings();
            });

            passWrapper.appendChild(input);
            passWrapper.appendChild(toggleBtn);
            control.appendChild(passWrapper);

            row.appendChild(info);
            row.appendChild(control);
            this.freeProvidersKeysList.appendChild(row);
        });
    }

    /**
     * Hides keys overlay if open.
     */
    hideKeysOverlay() {
        // No-op in flat section layout
    }

    /**
     * Persists all current settings values to host.
     */
    saveAllSettings() {
        const payload = {
            serverUrl: this.serverUrlInput ? this.serverUrlInput.value.trim() : undefined,
            lmStudioCacheDir: this.lmStudioPathInput ? this.lmStudioPathInput.value.trim() : undefined,
            apiKey: this.geminiKeyInput ? this.geminiKeyInput.value.trim() : undefined,
            freeProviders: this.freeProviders
        };
        this.ipcBridge.updateSettings(payload);
    }
}

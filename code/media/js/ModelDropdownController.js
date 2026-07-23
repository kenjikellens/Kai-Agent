/**
 * ModelDropdownController manages model status dots, provider accordions,
 * and active model selection state in the dropdown menu.
 */
class ModelDropdownController {
    /**
     * Initializes DOM references, initial dropdown values, and listeners.
     * @param {MarkdownFormatter} formatter Formatter instance.
     * @param {Function} onSelect Callback when a model selection changes.
     */
    constructor(formatter, onSelect) {
        this.formatter = formatter;
        this.onSelect = onSelect;
        this.selectedModelValue = localStorage.getItem('kai.selectedModel') || 'local-model';
        this.accordionStates = {};
        this.freeProvidersConfig = [
            { name: 'Mistral AI', configKey: 'mistralApiKey', keyHint: 'Get free key at console.mistral.ai' },
            { name: 'Cohere', configKey: 'cohereApiKey', keyHint: 'Get free key at dashboard.cohere.com' },
            { name: 'Cerebras', configKey: 'cerebrasApiKey', keyHint: 'Get free key at cloud.cerebras.ai' },
            { name: 'Zhipu AI', configKey: 'zhipuApiKey', keyHint: 'Get free key at open.bigmodel.cn' },
            { name: 'OmniRoute Gateway', configKey: 'omnirouteApiKey', keyHint: 'Run OmniRoute via npm: npx omniroute' }
        ];

        this.dropdownTriggerBtn = document.getElementById('dropdown-trigger-btn');
        this.dropdownOptionsMenu = document.getElementById('dropdown-options-menu');
        this.selectedModelText = document.getElementById('selected-model-text');
        this.statusDot = document.getElementById('status-dot');

        if (this.selectedModelText && this.selectedModelValue && this.selectedModelValue !== 'local-model') {
            this.selectedModelText.textContent = this.formatter.formatModelName(this.selectedModelValue);
        }

        this.initEventListeners();
        this.initDefaultDropdown();
    }

    /**
     * Registers dropdown trigger and global click-outside listeners.
     */
    initEventListeners() {
        if (this.dropdownTriggerBtn) {
            this.dropdownTriggerBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.dropdownOptionsMenu) {
                    this.dropdownOptionsMenu.classList.toggle('hidden');
                }
            });
        }

        document.addEventListener('click', (e) => {
            if (!e.target.closest('#model-dropdown-container') && this.dropdownOptionsMenu) {
                this.dropdownOptionsMenu.classList.add('hidden');
            }
        });
    }

    /**
     * Creates and appends an accordion category group to the dropdown menu.
     * @param {string} title Category title string.
     * @param {Array<string>} modelsList List of model IDs under this category.
     * @param {boolean} isInitiallyExpanded Initial expansion state.
     * @param {Function|null} isModelConnectedFn Optional model connection check callback.
     */
    createAccordionGroup(title, modelsList, isInitiallyExpanded, isModelConnectedFn = null) {
        if (!this.dropdownOptionsMenu) return;

        const groupDiv = document.createElement('div');
        groupDiv.className = 'dropdown-category';

        const headerDiv = document.createElement('div');
        headerDiv.className = 'dropdown-category-header';
        
        const titleSpan = document.createElement('span');
        titleSpan.textContent = title;
        headerDiv.appendChild(titleSpan);

        const svgNS = 'http://www.w3.org/2000/svg';
        const chevronSvg = document.createElementNS(svgNS, 'svg');
        chevronSvg.setAttribute('class', 'chevron-icon');
        chevronSvg.setAttribute('width', '8');
        chevronSvg.setAttribute('height', '8');
        chevronSvg.setAttribute('viewBox', '0 0 24 24');
        chevronSvg.setAttribute('fill', 'none');
        chevronSvg.setAttribute('stroke', 'currentColor');
        chevronSvg.setAttribute('stroke-width', '3');
        chevronSvg.setAttribute('stroke-linecap', 'round');
        chevronSvg.setAttribute('stroke-linejoin', 'round');

        const polyline = document.createElementNS(svgNS, 'polyline');
        polyline.setAttribute('points', '6 9 12 15 18 9');
        chevronSvg.appendChild(polyline);
        headerDiv.appendChild(chevronSvg);

        const contentDiv = document.createElement('div');
        contentDiv.className = 'dropdown-category-content';
        
        let isExpanded = this.accordionStates[title];
        if (isExpanded === undefined || isExpanded === null) {
            isExpanded = isInitiallyExpanded;
            this.accordionStates[title] = isExpanded;
        }

        if (!isExpanded) {
            contentDiv.classList.add('collapsed');
            chevronSvg.style.transform = 'rotate(-90deg)';
        } else {
            chevronSvg.style.transform = 'rotate(0deg)';
        }

        headerDiv.addEventListener('click', (e) => {
            e.stopPropagation();
            const isCollapsed = contentDiv.classList.toggle('collapsed');
            chevronSvg.style.transform = isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
            this.accordionStates[title] = !isCollapsed;
        });

        if (modelsList.length === 0) {
            const placeholder = document.createElement('div');
            placeholder.className = 'dropdown-item-placeholder';
            placeholder.textContent = title.includes('Gemini') ? 'Add API key in settings' : (title.includes('LM Studio') ? 'LM Studio server offline' : 'No Models Available');
            contentDiv.appendChild(placeholder);
        } else {
            modelsList.forEach(m => {
                const item = document.createElement('div');
                item.className = 'dropdown-item';
                if (m === this.selectedModelValue) {
                    item.classList.add('selected');
                }
                item.dataset.value = m;
                const isLoaded = isModelConnectedFn ? isModelConnectedFn(m) : true;
                const dotClass = isLoaded ? 'status-connected' : 'status-disconnected';
                
                const statusDotSpan = document.createElement('span');
                statusDotSpan.className = `status-dot ${dotClass}`;
                item.appendChild(statusDotSpan);

                const textSpan = document.createElement('span');
                textSpan.className = 'dropdown-item-text';
                textSpan.textContent = this.formatter.formatModelName(m);
                item.appendChild(textSpan);
                
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.selectedModelValue = m;
                    localStorage.setItem('kai.selectedModel', m);
                    if (this.selectedModelText) {
                        this.selectedModelText.textContent = this.formatter.formatModelName(m);
                    }
                    if (this.statusDot) {
                        this.statusDot.className = (isModelConnectedFn && isModelConnectedFn(m)) ? 'status-dot status-connected' : 'status-dot status-disconnected';
                    }
                    this.dropdownOptionsMenu.classList.add('hidden');
                    
                    if (this.onSelect) {
                        this.onSelect(m);
                    }
                });
                contentDiv.appendChild(item);
            });
        }

        groupDiv.appendChild(headerDiv);
        groupDiv.appendChild(contentDiv);
        this.dropdownOptionsMenu.appendChild(groupDiv);
    }

    /**
     * Populates initial default cloud and free models so user never sees empty dropdown.
     */
    initDefaultDropdown() {
        if (!this.dropdownOptionsMenu) return;
        this.dropdownOptionsMenu.innerHTML = '';
        
        const i18n = window.KAI_I18N || {};
        const defaultGemini = [
            'gemini-3.6-flash',
            'gemini-3.5-flash',
            'gemini-3.5-flash-lite',
            'gemini-3-flash-preview',
            'gemini-3.1-pro-preview',
            'gemini-3.1-flash-lite',
        ];
        const defaultProviders = [
            { name: 'OmniRoute Gateway', models: ['omniroute/auto'] },
            { name: 'Mistral AI', models: ['mistral/mistral-small-latest', 'mistral/codestral-latest', 'mistral/open-mixtral-8x22b'] },
            { name: 'Cohere', models: ['cohere/command-r-plus', 'cohere/command-r'] },
            { name: 'Cerebras', models: ['cerebras/llama-3.3-70b', 'cerebras/llama-3.1-8b'] },
            { name: 'Zhipu AI', models: ['zhipu/glm-4-flash', 'zhipu/glm-4-plus'] }
        ];

        const lmTitle = `${i18n.lmStudioHeader || 'LM Studio'} (${i18n.checkingServer || 'Checking...'})`;
        const geminiTitle = 'Gemini';

        const showGeminiExpanded = this.selectedModelValue && this.selectedModelValue.toLowerCase().startsWith('gemini');
        this.createAccordionGroup(lmTitle, [], !showGeminiExpanded);
        this.createAccordionGroup(geminiTitle, defaultGemini, showGeminiExpanded);

        defaultProviders.forEach(p => {
            const isExpanded = this.selectedModelValue && p.models.includes(this.selectedModelValue);
            this.createAccordionGroup(p.name, p.models, isExpanded);
        });
    }

    /**
     * Updates model dropdown options and connection dots when extension connectionStatus event arrives.
     * @param {object} message Connection status payload from extension host.
     */
    updateConnectionStatus(message) {
        if (!this.dropdownOptionsMenu) return;

        const isModelConnected = (m) => {
            if (!m) return false;
            const lowerM = m.toLowerCase();
            if (lowerM.startsWith('gemini')) {
                return !!message.apiKey;
            }
            const freeProviders = message.freeProviders || [];
            for (const provider of freeProviders) {
                if (provider.models.includes(m)) {
                    return !!provider.apiKey;
                }
            }
            return message.connected && message.loadedModels && message.loadedModels.includes(m);
        };

        const lmStudioModels = message.lmStudioModels || [];
        const geminiModels = message.geminiModels || [];
        const combinedModels = [...lmStudioModels, ...geminiModels];

        if (this.selectedModelValue && this.selectedModelValue !== 'local-model' && this.selectedModelValue !== 'No Models Loaded') {
            this.selectedModelText.textContent = this.formatter.formatModelName(this.selectedModelValue);
            this.statusDot.className = isModelConnected(this.selectedModelValue) ? 'status-dot status-connected' : 'status-dot status-disconnected';
        } else if (combinedModels.length > 0) {
            this.selectedModelValue = combinedModels[0];
            this.selectedModelText.textContent = this.formatter.formatModelName(this.selectedModelValue);
            this.statusDot.className = isModelConnected(this.selectedModelValue) ? 'status-dot status-connected' : 'status-dot status-disconnected';
        } else {
            this.selectedModelValue = 'local-model';
            this.selectedModelText.textContent = 'local-model';
            this.statusDot.className = isModelConnected('local-model') ? 'status-dot status-connected' : 'status-dot status-disconnected';
        }

        this.dropdownOptionsMenu.innerHTML = '';

        const i18n = window.KAI_I18N || {};
        const lmStudioStatus = message.connected ? (i18n.connected || 'Connected') : (i18n.offline || 'Offline');
        const lmTitle = `${i18n.lmStudioHeader || 'LM Studio'} (${lmStudioStatus})`;
        const geminiTitle = 'Gemini';

        const showGeminiExpanded = this.selectedModelValue && this.selectedModelValue.toLowerCase().startsWith('gemini');
        this.createAccordionGroup(lmTitle, lmStudioModels, !showGeminiExpanded, isModelConnected);
        this.createAccordionGroup(geminiTitle, geminiModels.length > 0 ? geminiModels : ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3-flash-preview', 'gemini-3.1-pro-preview', 'gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash-lite'], showGeminiExpanded, isModelConnected);

        const freeProviders = message.freeProviders || [];
        this.freeProvidersConfig = freeProviders;
        for (const provider of freeProviders) {
            const isExpanded = this.selectedModelValue && provider.models.includes(this.selectedModelValue);
            const cleanName = provider.name.replace(/\s*\([^)]*\)/g, '').trim();
            this.createAccordionGroup(cleanName, provider.models, isExpanded, isModelConnected);
        }
    }

    /**
     * Gets currently selected model ID.
     * @returns {string} Selected model ID.
     */
    getSelectedModel() {
        return this.selectedModelValue;
    }

    /**
     * Sets active model ID and updates UI elements.
     * @param {string} modelId Model ID.
     */
    setSelectedModel(modelId) {
        this.selectedModelValue = modelId;
        if (this.selectedModelText) {
            this.selectedModelText.textContent = this.formatter.formatModelName(modelId);
        }
        if (this.dropdownOptionsMenu) {
            const items = this.dropdownOptionsMenu.querySelectorAll('.dropdown-item');
            items.forEach(item => {
                if (item.dataset.value === modelId) {
                    item.classList.add('selected');
                } else {
                    item.classList.remove('selected');
                }
            });
        }
    }
}

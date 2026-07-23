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
        this.freeProvidersConfig = [...KAI_CONSTANTS.DEFAULT_FREE_PROVIDERS];
        this.lmStudioRawModels = [];

        this.dropdownTriggerBtn = document.getElementById('dropdown-trigger-btn');
        this.dropdownOptionsMenu = document.getElementById('dropdown-options-menu');
        this.selectedModelText = document.getElementById('selected-model-text');
        this.statusDot = document.getElementById('status-dot');

        // 2nd Dropdown Container elements for Gemini Thinking Level
        this.geminiThinkingContainer = document.getElementById('gemini-thinking-dropdown-container');
        this.geminiThinkingTriggerBtn = document.getElementById('gemini-thinking-trigger-btn');
        this.geminiThinkingMenu = document.getElementById('gemini-thinking-menu');
        this.geminiThinkingText = document.getElementById('gemini-thinking-text');

        if (this.selectedModelText && this.selectedModelValue && this.selectedModelValue !== 'local-model') {
            this.selectedModelText.textContent = this.formatter.formatModelName(this.selectedModelValue);
        }

        this.initEventListeners();
        this.initDefaultDropdown();
        this.updateGeminiThinkingVisibility();
    }

    /**
     * Updates visibility and active text of 2nd Gemini Thinking Dropdown Container.
     */
    updateGeminiThinkingVisibility() {
        const rawModel = (this.selectedModelValue || '').toLowerCase();
        const isGeminiModel = rawModel.includes('gemini');

        if (this.geminiThinkingContainer) {
            if (isGeminiModel) {
                this.geminiThinkingContainer.classList.remove('hidden');
            } else {
                this.geminiThinkingContainer.classList.add('hidden');
            }
        }

        const storedLevel = localStorage.getItem('kai.geminiThinkingLevel') || 'high';
        this.setGeminiThinkingLevelDisplay(storedLevel);
    }

    /**
     * Sets display label for 2nd Gemini Thinking Dropdown Container.
     * @param {string} level Thinking level ('high', 'medium', 'low', 'minimal').
     */
    setGeminiThinkingLevelDisplay(level) {
        if (!this.geminiThinkingText) return;
        const labels = {
            'high': 'Thinking: High',
            'medium': 'Thinking: Med',
            'low': 'Thinking: Low',
            'minimal': 'Thinking: Off'
        };
        this.geminiThinkingText.textContent = labels[level] || 'Thinking: High';

        if (this.geminiThinkingMenu) {
            const items = this.geminiThinkingMenu.querySelectorAll('.dropdown-item');
            items.forEach(item => {
                if (item.dataset.level === level) {
                    item.classList.add('selected');
                } else {
                    item.classList.remove('selected');
                }
            });
        }
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
                if (this.geminiThinkingMenu) {
                    this.geminiThinkingMenu.classList.add('hidden');
                }
            });
        }

        if (this.geminiThinkingTriggerBtn) {
            this.geminiThinkingTriggerBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.geminiThinkingMenu) {
                    this.geminiThinkingMenu.classList.toggle('hidden');
                }
                if (this.dropdownOptionsMenu) {
                    this.dropdownOptionsMenu.classList.add('hidden');
                }
            });
        }

        if (this.geminiThinkingMenu) {
            const items = this.geminiThinkingMenu.querySelectorAll('.dropdown-item');
            items.forEach(item => {
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const level = item.dataset.level || 'high';
                    localStorage.setItem('kai.geminiThinkingLevel', level);
                    this.setGeminiThinkingLevelDisplay(level);
                    this.geminiThinkingMenu.classList.add('hidden');

                    const settingInput = document.getElementById('gemini-thinking-level-input');
                    if (settingInput) {
                        settingInput.value = level;
                    }
                });
            });
        }

        document.addEventListener('click', (e) => {
            if (!e.target.closest('#model-dropdown-container') && this.dropdownOptionsMenu) {
                this.dropdownOptionsMenu.classList.add('hidden');
            }
            if (!e.target.closest('#gemini-thinking-dropdown-container') && this.geminiThinkingMenu) {
                this.geminiThinkingMenu.classList.add('hidden');
            }
        });
    }

    /**
     * Creates and appends an accordion category group to the dropdown menu.
     * @param {string} title Category title string.
     * @param {Array<string>} modelsList List of model IDs under this category.
     * @param {boolean} isInitiallyExpanded Initial expansion state.
     * @param {Function|null} isModelConnectedFn Optional model connection check callback.
     * @param {boolean} isLMStudioCategory Whether this is the local LM Studio model category.
     */
    createAccordionGroup(title, modelsList, isInitiallyExpanded, isModelConnectedFn = null, isLMStudioCategory = false) {
        if (!this.dropdownOptionsMenu) return;

        const groupDiv = document.createElement('div');
        groupDiv.className = 'dropdown-category';

        const headerDiv = document.createElement('div');
        headerDiv.className = 'dropdown-category-header';
        
        const titleSpan = document.createElement('span');
        titleSpan.textContent = title;
        headerDiv.appendChild(titleSpan);

        const chevronSvg = DOMUtils.createChevronIcon('chevron-icon');
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
            const displayItems = [];
            if (isLMStudioCategory) {
                modelsList.forEach(m => {
                    displayItems.push({ value: `${m} (thinking)`, label: `${this.formatter.formatModelName(m)} (thinking)`, rawModel: m, thinking: true });
                    displayItems.push({ value: m, label: this.formatter.formatModelName(m), rawModel: m, thinking: false });
                });
            } else {
                modelsList.forEach(m => {
                    displayItems.push({ value: m, label: this.formatter.formatModelName(m), rawModel: m, thinking: true });
                });
            }

            displayItems.forEach(itemData => {
                const item = document.createElement('div');
                item.className = 'dropdown-item model-hover-item';
                if (itemData.value === this.selectedModelValue) {
                    item.classList.add('selected');
                }
                item.dataset.value = itemData.value;
                const isLoaded = isModelConnectedFn ? isModelConnectedFn(itemData.rawModel) : true;
                const dotClass = isLoaded ? 'status-connected' : 'status-disconnected';
                
                const statusDotSpan = document.createElement('span');
                statusDotSpan.className = `status-dot ${dotClass}`;
                item.appendChild(statusDotSpan);

                const textSpan = document.createElement('span');
                textSpan.className = 'dropdown-item-text';
                textSpan.textContent = itemData.label;
                item.appendChild(textSpan);

                const isGemini = itemData.rawModel.toLowerCase().includes('gemini');
                if (isGemini) {
                    const chevronSpan = document.createElement('span');
                    chevronSpan.className = 'model-flyout-chevron';
                    chevronSpan.textContent = '›';
                    item.appendChild(chevronSpan);

                    const flyoutMenu = document.createElement('div');
                    flyoutMenu.className = 'thinking-flyout-menu';
                    const currentGeminiLevel = localStorage.getItem('kai.geminiThinkingLevel') || 'high';
                    
                    const levels = [
                        { level: 'high', label: 'High' },
                        { level: 'medium', label: 'Medium' },
                        { level: 'low', label: 'Low' },
                        { level: 'minimal', label: 'Minimal (Off)' }
                    ];
                    
                    levels.forEach(lvl => {
                        const flyoutOpt = document.createElement('div');
                        flyoutOpt.className = `flyout-option ${lvl.level === currentGeminiLevel ? 'selected' : ''}`;
                        flyoutOpt.textContent = lvl.label;
                        flyoutOpt.addEventListener('click', (e) => {
                            e.stopPropagation();
                            localStorage.setItem('kai.geminiThinkingLevel', lvl.level);
                            this.selectedModelValue = itemData.value;
                            localStorage.setItem('kai.selectedModel', itemData.value);
                            if (this.selectedModelText) {
                                this.selectedModelText.textContent = itemData.label;
                            }
                            this.dropdownOptionsMenu.classList.add('hidden');
                            if (this.onSelect) {
                                this.onSelect(itemData.value);
                            }
                        });
                        flyoutMenu.appendChild(flyoutOpt);
                    });
                    item.appendChild(flyoutMenu);
                }
                
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.selectedModelValue = itemData.value;
                    localStorage.setItem('kai.selectedModel', itemData.value);
                    if (this.selectedModelText) {
                        this.selectedModelText.textContent = itemData.label;
                    }
                    if (this.statusDot) {
                        this.statusDot.className = (isModelConnectedFn && isModelConnectedFn(itemData.rawModel)) ? 'status-dot status-connected' : 'status-dot status-disconnected';
                    }
                    this.dropdownOptionsMenu.classList.add('hidden');
                    
                    if (this.onSelect) {
                        this.onSelect(itemData.value);
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
        const defaultGemini = KAI_CONSTANTS.DEFAULT_GEMINI_MODELS.slice(0, 6);
        const defaultProviders = KAI_CONSTANTS.DEFAULT_PROVIDERS_WITH_MODELS;

        const lmTitle = `${i18n.lmStudioHeader || 'LM Studio'} (${i18n.checkingServer || 'Checking...'})`;
        const geminiTitle = 'Gemini';

        const showGeminiExpanded = this.selectedModelValue && this.selectedModelValue.toLowerCase().startsWith('gemini');
        this.createAccordionGroup(lmTitle, [], !showGeminiExpanded, null, true);
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
            const bare = m.endsWith(' (thinking)') ? m.slice(0, -11) : m;
            const lowerM = bare.toLowerCase();
            if (lowerM.startsWith('gemini')) {
                return !!message.apiKey;
            }
            const freeProviders = message.freeProviders || [];
            for (const provider of freeProviders) {
                if (provider.models.includes(bare)) {
                    return !!provider.apiKey;
                }
            }
            return message.connected && message.loadedModels && message.loadedModels.includes(bare);
        };

        const lmStudioModels = message.lmStudioModels || [];
        this.lmStudioRawModels = lmStudioModels;
        const geminiModels = message.geminiModels || [];
        const combinedModels = [...lmStudioModels, ...geminiModels];

        if (this.selectedModelValue && this.selectedModelValue !== 'local-model' && this.selectedModelValue !== 'No Models Loaded') {
            const cleanDisplay = this.selectedModelValue.endsWith(' (thinking)')
                ? `${this.formatter.formatModelName(this.selectedModelValue.slice(0, -11))} (thinking)`
                : this.formatter.formatModelName(this.selectedModelValue);
            this.selectedModelText.textContent = cleanDisplay;
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
        this.createAccordionGroup(lmTitle, lmStudioModels, !showGeminiExpanded, isModelConnected, true);
        this.createAccordionGroup(geminiTitle, geminiModels.length > 0 ? geminiModels : KAI_CONSTANTS.DEFAULT_GEMINI_MODELS, showGeminiExpanded, isModelConnected);

        const freeProviders = message.freeProviders || [];
        this.freeProvidersConfig = freeProviders;
        for (const provider of freeProviders) {
            const isExpanded = this.selectedModelValue && provider.models.includes(this.selectedModelValue);
            const cleanName = provider.name.replace(/\s*\([^)]*\)/g, '').trim();
            this.createAccordionGroup(cleanName, provider.models, isExpanded, isModelConnected);
        }

        this.updateGeminiThinkingVisibility();
    }

    /**
     * Resolves currently selected model details including bare model ID and thinking toggle flag.
     * @returns {object} Object containing model ID string and boolean thinking flag.
     */
    getSelectedModelDetails() {
        let raw = this.selectedModelValue || 'local-model';
        let thinking = true;

        if (raw.endsWith(' (thinking)')) {
            return {
                model: raw.slice(0, -11),
                thinking: true
            };
        }

        // Check if raw model is a local LM Studio model without (thinking) suffix
        const isLocalModel = this.lmStudioRawModels.includes(raw);
        if (isLocalModel) {
            thinking = false;
        }

        return {
            model: raw,
            thinking: thinking
        };
    }

    /**
     * Gets currently selected model ID string.
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
            const cleanDisplay = modelId.endsWith(' (thinking)')
                ? `${this.formatter.formatModelName(modelId.slice(0, -11))} (thinking)`
                : this.formatter.formatModelName(modelId);
            this.selectedModelText.textContent = cleanDisplay;
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
        this.updateGeminiThinkingVisibility();
    }
}

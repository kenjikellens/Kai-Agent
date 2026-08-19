/**
 * ModelDropdownController manages model status dots, provider accordions,
 * and active model selection state in the dropdown menu.
 * 
 * ARCHITECTURAL DISTINCTION:
 * - MODEL SELECTOR DROPDOWN: The primary dropdown menu (#dropdown-options-menu) where users
 *   choose which AI Provider and Model to interact with (LM Studio, Gemini, Mistral, etc.).
 * - THINKING DROPDOWN / FLYOUT MENU: The sub-dropdown menu (.thinking-flyout-menu) where users
 *   configure the thinking/reasoning budget/level (High, Medium, Low, Minimal) for thinking models.
 */
class ModelDropdownController {
    /**
     * Initializes DOM references, initial dropdown values, and listeners.
     * @param {MarkdownFormatter} formatter Formatter instance.
     * @param {Function} onSelect Callback when a model selection changes in the Model Selector Dropdown.
     */
    constructor(formatter, onSelect) {
        this.formatter = formatter;
        this.onSelect = onSelect;
        this.selectedModelValue = localStorage.getItem('kai.selectedModel') || 'local-model';
        this.accordionStates = {};
        this.freeProvidersConfig = [...KAI_CONSTANTS.DEFAULT_FREE_PROVIDERS];
        this.lmStudioRawModels = [];
        this.activeFlyoutItem = null;
        this.flyoutCloseTimer = null;

        this.dropdownTriggerBtn = document.getElementById('dropdown-trigger-btn');
        this.dropdownOptionsMenu = document.getElementById('dropdown-options-menu');
        this.selectedModelText = document.getElementById('selected-model-text');
        this.statusDot = document.getElementById('status-dot');

        if (this.selectedModelText && this.selectedModelValue && this.selectedModelValue !== 'local-model') {
            this.selectedModelText.textContent = this.formatter.formatModelName(this.selectedModelValue);
        }

        this.initEventListeners();
        this.initDefaultDropdown();
        this.updateCapabilitiesToolbar();
        
        window.addEventListener('resize', () => this.updateTextOverflowMetrics());
        window.addEventListener('kaiThinkingStyleChanged', () => {
            this.setSelectedModel(this.selectedModelValue);
            this.initDefaultDropdown();
        });
        setTimeout(() => this.updateTextOverflowMetrics(), 50);
    }

    /**
     * Checks text overflow for all .model-text-container elements and calculates
     * the exact scroll distance and speed duration needed for the ping-pong hover loop.
     */
    updateTextOverflowMetrics() {
        const containers = document.querySelectorAll('.model-text-container');
        
        containers.forEach(container => {
            const innerSpan = container.querySelector('.model-text-inner');
            if (!innerSpan) return;

            // Ensure innerSpan doesn't shrink so scrollWidth gives true content width
            innerSpan.style.flexShrink = '0';

            const containerWidth = container.clientWidth;
            const contentWidth = innerSpan.scrollWidth;
            const overflowAmount = contentWidth - containerWidth;

            if (overflowAmount > 2) {
                // Content overflows container boundary
                container.classList.add('has-overflow');
                
                // Add safety padding (8px) so the end of text is comfortably visible
                const targetOffset = -(overflowAmount + 8);
                
                // Calculate dynamic animation duration proportional to scroll distance
                // Base pause time at end = 1.2s
                // In-between travel speed = 22px per second
                const basePauseTime = 1.2;
                const travelSpeed = 22;
                const travelTime = (2 * Math.abs(targetOffset)) / travelSpeed;
                
                const duration = Math.min(24, Math.max(4.5, basePauseTime + travelTime)).toFixed(2);
                
                container.style.setProperty('--scroll-offset', `${targetOffset}px`);
                container.style.setProperty('--scroll-duration', `${duration}s`);
            } else {
                container.classList.remove('has-overflow');
                container.style.removeProperty('--scroll-offset');
                container.style.removeProperty('--scroll-duration');
            }
        });
    }

    /**
     * Closes any currently open thinking flyout sub-menu immediately with 0ms delay.
     */
    closeActiveFlyoutImmediately() {
        if (this.flyoutCloseTimer) {
            clearTimeout(this.flyoutCloseTimer);
            this.flyoutCloseTimer = null;
        }
        if (this.activeFlyoutItem) {
            this.activeFlyoutItem.classList.remove('flyout-open');
            this.activeFlyoutItem = null;
        }
        const openFlyouts = document.querySelectorAll('.model-hover-item.flyout-open');
        openFlyouts.forEach(el => el.classList.remove('flyout-open'));
        if (document.activeElement && document.activeElement.closest('.thinking-flyout-menu')) {
            document.activeElement.blur();
        }
    }

    /**
     * Registers dropdown trigger and global click-outside listeners for the Model Selector Dropdown.
     */
    initEventListeners() {
        if (this.dropdownTriggerBtn) {
            this.dropdownTriggerBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.closeActiveFlyoutImmediately();
                if (this.dropdownOptionsMenu) {
                    this.dropdownOptionsMenu.classList.toggle('hidden');
                }
            });
        }

        document.addEventListener('click', (e) => {
            if (!e.target.closest('#model-dropdown-container') && this.dropdownOptionsMenu) {
                this.closeActiveFlyoutImmediately();
                this.dropdownOptionsMenu.classList.add('hidden');
            }
        });

        // Global mouseover delegation listener to calculate overflow & trigger ping-pong scroll instantly on hover
        document.addEventListener('mouseover', (e) => {
            const targetContainer = e.target.closest('.model-text-container') || e.target.closest('.dropdown-trigger') || e.target.closest('.dropdown-item');
            if (!targetContainer) return;

            const container = targetContainer.classList.contains('model-text-container') ? targetContainer : targetContainer.querySelector('.model-text-container');
            if (!container) return;

            const innerSpan = container.querySelector('.model-text-inner');
            if (!innerSpan) return;

            innerSpan.style.flexShrink = '0';
            const containerWidth = container.clientWidth;
            const contentWidth = innerSpan.scrollWidth;
            const overflowAmount = contentWidth - containerWidth;

            if (overflowAmount > 2) {
                container.classList.add('has-overflow');
                const targetOffset = -(overflowAmount + 8);
                const basePauseTime = 1.2;
                const travelSpeed = 22;
                const travelTime = (2 * Math.abs(targetOffset)) / travelSpeed;
                const duration = Math.min(24, Math.max(4.5, basePauseTime + travelTime)).toFixed(2);

                container.style.setProperty('--scroll-offset', `${targetOffset}px`);
                container.style.setProperty('--scroll-duration', `${duration}s`);
            } else {
                container.classList.remove('has-overflow');
            }
        }, true);
    }

    /**
     * Creates and appends an accordion category group to the Model Selector Dropdown menu.
     * Each model option is rendered as an explicit interactive button element (role="button").
     * For reasoning models (e.g. Gemini), an attached sub-menu (Thinking Dropdown) is rendered.
     * 
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
        headerDiv.setAttribute('role', 'button');
        headerDiv.setAttribute('tabindex', '0');
        headerDiv.setAttribute('aria-label', `Toggle category ${title}`);
        
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

        const toggleAccordion = (e) => {
            e.stopPropagation();
            this.closeActiveFlyoutImmediately();
            const isCollapsed = contentDiv.classList.toggle('collapsed');
            chevronSvg.style.transform = isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
            this.accordionStates[title] = !isCollapsed;
        };

        headerDiv.addEventListener('click', toggleAccordion);
        headerDiv.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleAccordion(e);
            }
        });

        if (modelsList.length === 0) {
            const placeholder = document.createElement('div');
            placeholder.className = 'dropdown-item-placeholder';
            placeholder.textContent = title.includes('Gemini') ? 'Add API key in settings' : (title.includes('LM Studio') ? 'LM Studio server offline' : 'No Models Available');
            contentDiv.appendChild(placeholder);
        } else {
            const displayItems = [];
            modelsList.forEach(m => {
                let cleanVal = m;
                if (cleanVal.endsWith(' (thinking)')) {
                    cleanVal = cleanVal.slice(0, -11);
                }
                if (!displayItems.some(i => i.value === cleanVal)) {
                    displayItems.push({ value: cleanVal, label: this.formatter.formatModelName(cleanVal), rawModel: cleanVal, thinking: false });
                }
            });

            displayItems.forEach(itemData => {
                // Model Selector Dropdown Button Item (Interactive button element)
                const item = document.createElement('div');
                item.className = 'dropdown-item';
                item.setAttribute('role', 'button');
                item.setAttribute('tabindex', '0');
                item.setAttribute('aria-label', `Select model ${itemData.label}`);
                
                if (itemData.value === this.selectedModelValue) {
                    item.classList.add('selected');
                }
                item.dataset.value = itemData.value;
                const isLoaded = isModelConnectedFn ? isModelConnectedFn(itemData.rawModel) : false;
                const dotClass = isLoaded ? 'status-connected' : 'status-disconnected';
                
                const statusDotSpan = document.createElement('span');
                statusDotSpan.className = `status-dot ${dotClass}`;
                item.appendChild(statusDotSpan);

                const textContainer = document.createElement('div');
                textContainer.className = 'model-text-container';

                const textSpan = document.createElement('span');
                textSpan.className = 'model-text-inner dropdown-item-text';
                textSpan.textContent = itemData.label;

                textContainer.appendChild(textSpan);
                item.appendChild(textContainer);

                if (itemData.value === this.selectedModelValue) {
                    const checkSvg = DOMUtils.createCheckIcon('check-icon');
                    item.appendChild(checkSvg);
                }
                
                const handleItemClick = (e) => {
                    e.stopPropagation();
                    this.selectedModelValue = itemData.value;
                    localStorage.setItem('kai.selectedModel', itemData.value);
                    
                    this.setSelectedModel(itemData.value);

                    if (this.statusDot) {
                        this.statusDot.className = (isModelConnectedFn && isModelConnectedFn(itemData.rawModel)) ? 'status-dot status-connected' : 'status-dot status-disconnected';
                    }
                    this.dropdownOptionsMenu.classList.add('hidden');
                    
                    if (this.onSelect) {
                        this.onSelect(itemData.value);
                    }
                };

                item.addEventListener('click', handleItemClick);
                item.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleItemClick(e);
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
        const defaultGemini = KAI_CONSTANTS.DEFAULT_GEMINI_MODELS;
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

        if (message.lmStudioCapabilities) {
            ThinkingStateFormatter.setLMStudioCapabilities(message.lmStudioCapabilities);
        }

        /* Skip rebuild if nothing changed to prevent LM Studio Offline/Connected flicker */
        const fingerprint = JSON.stringify({
            c: message.connected,
            lm: message.lmStudioModels,
            gm: message.geminiModels,
            ld: message.loadedModels,
            caps: Object.keys(message.lmStudioCapabilities || {}).length
        });
        if (this._lastFingerprint && this._lastFingerprint === fingerprint) {
            return;
        }
        this._lastFingerprint = fingerprint;

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
            ThinkingStateFormatter.renderTriggerLabel({
                modelId: this.selectedModelValue,
                container: this.selectedModelText,
                formatter: this.formatter
            });
            this.statusDot.className = isModelConnected(this.selectedModelValue) ? 'status-dot status-connected' : 'status-dot status-disconnected';
        } else if (combinedModels.length > 0) {
            this.selectedModelValue = combinedModels[0];
            ThinkingStateFormatter.renderTriggerLabel({
                modelId: this.selectedModelValue,
                container: this.selectedModelText,
                formatter: this.formatter
            });
            this.statusDot.className = isModelConnected(this.selectedModelValue) ? 'status-dot status-connected' : 'status-dot status-disconnected';
        } else {
            this.selectedModelValue = 'local-model';
            this.selectedModelText.textContent = 'local-model';
            this.statusDot.className = isModelConnected('local-model') ? 'status-dot status-connected' : 'status-dot status-disconnected';
        }

        this.dropdownOptionsMenu.innerHTML = '';

        const i18n = window.KAI_I18N || {};
        const isConnected = Boolean(message.connected && lmStudioModels.length > 0);
        const lmStudioStatus = isConnected 
            ? (i18n.connected || 'Connected') 
            : (i18n.offline || 'Offline');
        const headerTitle = i18n.lmStudioHeader || 'LM Studio';
        const lmTitle = `${headerTitle} (${lmStudioStatus})`;
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
        this.updateCapabilitiesToolbar();
    }

    /**
     * Determines provider requirements and key status for a given model ID.
     * @param {string} modelId Model identifier string.
     * @returns {object|null} Provider descriptor object or null if local.
     */
    getProviderInfo(modelId) {
        if (!modelId) return null;
        const bare = modelId.endsWith(' (thinking)') ? modelId.slice(0, -11) : modelId;
        const lower = bare.toLowerCase();
        if (lower.startsWith('gemini') || lower.includes('gemini')) {
            const key = (localStorage.getItem('kai.geminiApiKey') || localStorage.getItem('kai.apiKey') || '').trim();
            return {
                providerName: 'Google Gemini',
                configKey: 'geminiApiKey',
                keyHint: 'Get free key at aistudio.google.com/app/apikey',
                url: 'https://aistudio.google.com/app/apikey',
                hasKey: !!key,
                modelName: this.formatter ? this.formatter.formatModelName(bare) : bare
            };
        }
        const freeProviders = (typeof KAI_CONSTANTS !== 'undefined' && KAI_CONSTANTS.DEFAULT_FREE_PROVIDERS) || [];
        for (const p of freeProviders) {
            const pKey = p.name.toLowerCase().split(' ')[0];
            if (lower.startsWith(pKey) || lower.includes(pKey)) {
                const key = (localStorage.getItem(`kai.${p.configKey}`) || '').trim();
                let url = '';
                if (p.configKey === 'mistralApiKey') url = 'https://console.mistral.ai';
                else if (p.configKey === 'cohereApiKey') url = 'https://dashboard.cohere.com';
                else if (p.configKey === 'cerebrasApiKey') url = 'https://cloud.cerebras.ai';
                else if (p.configKey === 'zhipuApiKey') url = 'https://open.bigmodel.cn';
                return {
                    providerName: p.name,
                    configKey: p.configKey,
                    keyHint: p.keyHint,
                    url: url,
                    hasKey: !!key,
                    modelName: this.formatter ? this.formatter.formatModelName(bare) : bare
                };
            }
        }
        return null;
    }

    /**
     * Resolves currently selected model details including bare model ID, thinking toggle flag, and reasoning effort.
     * @param {string} [modelId] Optional target model ID to inspect.
     * @returns {object} Object containing model ID string, boolean thinking flag, and reasoning effort.
     */
    getSelectedModelDetails(modelId = null) {
        const targetModel = modelId || this.selectedModelValue || 'local-model';
        const raw = targetModel.endsWith(' (thinking)') ? targetModel.slice(0, -11) : targetModel;
        const caps = ThinkingStateFormatter.getCapabilitiesState(raw);

        return {
            model: raw,
            thinking: caps.isThinkingOn,
            isThinkingCapable: caps.hasThinkingToggle || caps.hasReasoningEffort,
            reasoningEffort: caps.hasReasoningEffort ? caps.reasoningLevel : (caps.isThinkingOn ? 'xhigh' : 'none')
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
     * Sets active model ID and updates UI elements and connection status indicators.
     * @param {string} modelId Model ID.
     */
    setSelectedModel(modelId) {
        this.selectedModelValue = modelId;
        ThinkingStateFormatter.renderTriggerLabel({
            modelId: modelId,
            container: this.selectedModelText,
            formatter: this.formatter
        });

        const info = this.getProviderInfo(modelId);
        let isConnected = true;
        if (info) {
            isConnected = info.hasKey;
        } else if (this.isModelConnectedFn) {
            isConnected = this.isModelConnectedFn(modelId);
        }

        if (this.statusDot) {
            this.statusDot.className = isConnected ? 'status-dot status-connected' : 'status-dot status-disconnected';
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
        this.updateCapabilitiesToolbar();
    }

    /**
     * Renders dedicated capability buttons (Think toggle, Reasoning Effort dropdown)
     * directly into the toolbar next to the model selector.
     */
    updateCapabilitiesToolbar() {
        const toolbar = document.getElementById('model-capabilities-toolbar');
        if (!toolbar) return;
        toolbar.innerHTML = '';

        const caps = ThinkingStateFormatter.getCapabilitiesState(this.selectedModelValue);
        const rawModel = caps.rawModel;

        // 1. Dedicated Thinking Toggle Button [Lightbulb Think]
        if (caps.hasThinkingToggle) {
            const thinkBtn = document.createElement('button');
            thinkBtn.type = 'button';
            thinkBtn.className = `cap-toggle-btn ${caps.isThinkingOn ? 'active' : ''}`;
            thinkBtn.title = caps.isThinkingOn ? 'Thinking is Enabled (Click to Disable)' : 'Thinking is Disabled (Click to Enable)';

            const lightbulbIcon = DOMUtils.createLightbulbIcon('cap-icon');
            thinkBtn.appendChild(lightbulbIcon);

            const labelSpan = document.createElement('span');
            labelSpan.textContent = 'Think';
            thinkBtn.appendChild(labelSpan);

            thinkBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const newState = !thinkBtn.classList.contains('active');
                if (newState) {
                    thinkBtn.classList.add('active');
                    thinkBtn.title = 'Thinking is Enabled (Click to Disable)';
                } else {
                    thinkBtn.classList.remove('active');
                    thinkBtn.title = 'Thinking is Disabled (Click to Enable)';
                }

                localStorage.setItem(`kai.lmStudioThinking.${rawModel}`, newState ? 'true' : 'false');
                localStorage.setItem(`kai.mistralThinking.${rawModel}`, newState ? 'true' : 'false');
                if (rawModel.includes('/')) {
                    const short = rawModel.split('/').pop();
                    localStorage.setItem(`kai.lmStudioThinking.${short}`, newState ? 'true' : 'false');
                }
            });

            toolbar.appendChild(thinkBtn);
        }

        // 2. Dedicated Reasoning Effort Dropdown [Gauge Effort: <level> ▾]
        if (caps.hasReasoningEffort && Array.isArray(caps.effortOptions) && caps.effortOptions.length > 0) {
            const dropdownContainer = document.createElement('div');
            dropdownContainer.className = 'cap-dropdown';

            const triggerBtn = document.createElement('button');
            triggerBtn.type = 'button';
            triggerBtn.className = 'cap-dropdown-trigger';
            triggerBtn.title = `${caps.effortDisplayName}: ${caps.reasoningLevel}`;

            const gaugeIcon = DOMUtils.createGaugeIcon('cap-icon');
            triggerBtn.appendChild(gaugeIcon);

            const labelSpan = document.createElement('span');
            labelSpan.className = 'cap-label';
            const matchedOpt = caps.effortOptions.find(o => o.value === caps.reasoningLevel);
            labelSpan.textContent = matchedOpt ? matchedOpt.label : caps.reasoningLevel;
            triggerBtn.appendChild(labelSpan);

            const chevronSvg = DOMUtils.createSvg('svg', {
                class: 'cap-chevron',
                width: '8',
                height: '8',
                viewBox: '0 0 24 24',
                fill: 'none',
                stroke: 'currentColor',
                'stroke-width': '3',
                'stroke-linecap': 'round',
                'stroke-linejoin': 'round'
            });
            const polyline = DOMUtils.createSvg('polyline', { points: '6 9 12 15 18 9' });
            chevronSvg.appendChild(polyline);
            triggerBtn.appendChild(chevronSvg);

            const menu = document.createElement('div');
            menu.className = 'cap-dropdown-menu hidden';

            caps.effortOptions.forEach(opt => {
                const itemBtn = document.createElement('button');
                itemBtn.type = 'button';
                const isSelected = opt.value === caps.reasoningLevel;
                itemBtn.className = `cap-dropdown-item ${isSelected ? 'selected' : ''}`;

                const optText = document.createElement('span');
                optText.textContent = opt.label;
                itemBtn.appendChild(optText);

                if (isSelected) {
                    const checkSvg = DOMUtils.createCheckIcon('check-icon');
                    itemBtn.appendChild(checkSvg);
                }

                itemBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    labelSpan.textContent = opt.label;
                    triggerBtn.title = `${caps.effortDisplayName}: ${opt.label}`;

                    menu.querySelectorAll('.cap-dropdown-item').forEach(el => {
                        el.classList.remove('selected');
                        const check = el.querySelector('.check-icon');
                        if (check) check.remove();
                    });
                    itemBtn.classList.add('selected');
                    const checkSvg = DOMUtils.createCheckIcon('check-icon');
                    itemBtn.appendChild(checkSvg);

                    menu.classList.add('hidden');

                    if (rawModel.toLowerCase().includes('gemini')) {
                        localStorage.setItem(`kai.geminiThinkingLevel.${this.selectedModelValue}`, opt.value);
                        localStorage.setItem(`kai.geminiThinkingLevel.${rawModel}`, opt.value);
                        localStorage.setItem('kai.geminiThinkingLevel', opt.value);
                    } else {
                        localStorage.setItem(`kai.lmStudioReasoningLevel.${rawModel}`, opt.value);
                        localStorage.setItem(`kai.lmStudioReasoningLevel.${this.selectedModelValue}`, opt.value);
                        if (rawModel.includes('/')) {
                            const short = rawModel.split('/').pop();
                            localStorage.setItem(`kai.lmStudioReasoningLevel.${short}`, opt.value);
                        }
                    }
                });

                menu.appendChild(itemBtn);
            });

            triggerBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                menu.classList.toggle('hidden');
            });

            dropdownContainer.appendChild(triggerBtn);
            dropdownContainer.appendChild(menu);
            toolbar.appendChild(dropdownContainer);

            document.addEventListener('click', (e) => {
                if (!e.target.closest('.cap-dropdown')) {
                    menu.classList.add('hidden');
                }
            });
        }
    }

    /**
     * Updates visibility of reasoning sub-settings.
     */
    updateGeminiThinkingVisibility() {
        const container = document.getElementById('gemini-thinking-level-container');
        if (container) {
            const isGemini = this.selectedModelValue && this.selectedModelValue.toLowerCase().startsWith('gemini');
            if (isGemini) {
                container.style.display = 'block';
            } else {
                container.style.display = 'none';
            }
        }
    }
}

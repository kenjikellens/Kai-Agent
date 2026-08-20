/**
 * ModelDropdownController manages model status dots, provider accordions,
 * active model selection state, and integrated flyout settings submenus in the dropdown menu.
 * 
 * ARCHITECTURAL DESIGN:
 * - MODEL SELECTOR DROPDOWN: The primary dropdown menu (#dropdown-options-menu) where users
 *   choose which AI Provider and Model to interact with (LM Studio, Gemini, Mistral, etc.).
 * - THINKING / REASONING FLYOUT MENU: The integrated sub-dropdown (.thinking-flyout-menu) attached
 *   directly to capable models for configuring thinking toggle and reasoning effort levels without icons.
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
            ThinkingStateFormatter.renderTriggerLabel({
                modelId: this.selectedModelValue,
                container: this.selectedModelText,
                formatter: this.formatter
            });
        }

        this.initEventListeners();
        this.initDefaultDropdown();

        window.addEventListener('resize', () => this.updateTextOverflowMetrics());
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
     * Manages mutual exclusion and dismissal of open menus and flyouts.
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
     * Each model option is rendered as an interactive button element.
     * Capable models render an integrated flyout submenu for thinking & reasoning settings without icons.
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
                const caps = ThinkingStateFormatter.getCapabilitiesState(itemData.rawModel);
                const hasFlyout = caps.hasThinkingToggle || (caps.hasReasoningEffort && Array.isArray(caps.effortOptions) && caps.effortOptions.length > 0);

                const item = document.createElement('div');
                item.className = 'dropdown-item';
                if (hasFlyout) {
                    item.classList.add('model-hover-item');
                }
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

                if (hasFlyout) {
                    const flyoutChevron = document.createElement('span');
                    flyoutChevron.className = 'model-flyout-chevron';
                    flyoutChevron.textContent = '›';
                    item.appendChild(flyoutChevron);

                    // Build integrated flyout submenu (no icons)
                    const flyoutMenu = document.createElement('div');
                    flyoutMenu.className = 'thinking-flyout-menu';

                    const flyoutInner = document.createElement('div');
                    flyoutInner.className = 'thinking-flyout-menu-inner';

                    const rawModel = itemData.rawModel;

                    // 1. Thinking Toggle Switch (Boolean soft-coded)
                    if (caps.hasThinkingToggle) {
                        const toggleRow = document.createElement('div');
                        toggleRow.className = 'toggle-switch-row';
                        toggleRow.setAttribute('role', 'button');
                        toggleRow.setAttribute('tabindex', '0');
                        toggleRow.setAttribute('aria-label', `Toggle thinking ${caps.isThinkingOn ? 'off' : 'on'}`);

                        const toggleLabel = document.createElement('span');
                        toggleLabel.className = 'toggle-label';
                        toggleLabel.textContent = 'Thinking';
                        toggleRow.appendChild(toggleLabel);

                        const switchPill = document.createElement('div');
                        switchPill.className = `switch-pill ${caps.isThinkingOn ? 'active' : ''}`;
                        const switchHandle = document.createElement('div');
                        switchHandle.className = 'switch-handle';
                        switchPill.appendChild(switchHandle);
                        toggleRow.appendChild(switchPill);

                        const handleToggleClick = (e) => {
                            e.stopPropagation();
                            const newState = !switchPill.classList.contains('active');
                            if (newState) {
                                switchPill.classList.add('active');
                            } else {
                                switchPill.classList.remove('active');
                            }

                            localStorage.setItem(`kai.lmStudioThinking.${rawModel}`, newState ? 'true' : 'false');
                            localStorage.setItem(`kai.mistralThinking.${rawModel}`, newState ? 'true' : 'false');
                            if (rawModel.includes('/')) {
                                const short = rawModel.split('/').pop();
                                localStorage.setItem(`kai.lmStudioThinking.${short}`, newState ? 'true' : 'false');
                            }
                            caps.isThinkingOn = newState;

                            this.selectedModelValue = itemData.value;
                            localStorage.setItem('kai.selectedModel', itemData.value);
                            this.setSelectedModel(itemData.value);

                            if (this.statusDot) {
                                this.statusDot.className = (isModelConnectedFn && isModelConnectedFn(itemData.rawModel)) ? 'status-dot status-connected' : 'status-dot status-disconnected';
                            }

                            if (this.onSelect) {
                                this.onSelect(itemData.value);
                            }
                        };

                        toggleRow.addEventListener('click', handleToggleClick);
                        toggleRow.addEventListener('keydown', (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                handleToggleClick(e);
                            }
                        });

                        flyoutInner.appendChild(toggleRow);

                        if (caps.hasReasoningEffort && caps.effortOptions.length > 0) {
                            const divider = document.createElement('div');
                            divider.className = 'flyout-divider';
                            flyoutInner.appendChild(divider);
                        }
                    }

                    // 2. Reasoning Effort Option Rows (if supported)
                    if (caps.hasReasoningEffort && Array.isArray(caps.effortOptions)) {
                        caps.effortOptions.forEach(opt => {
                            const optItem = document.createElement('div');
                            const isSelected = opt.value === caps.reasoningLevel;
                            optItem.className = `flyout-option ${isSelected ? 'selected' : ''}`;
                            optItem.setAttribute('role', 'button');
                            optItem.setAttribute('tabindex', '0');

                            ThinkingStateFormatter.renderFlyoutOptionContent(optItem, opt.label);

                            if (isSelected) {
                                optItem.appendChild(DOMUtils.createCheckIcon('check-icon'));
                            }

                            const handleEffortClick = (e) => {
                                e.stopPropagation();
                                if (rawModel.toLowerCase().includes('gemini')) {
                                    localStorage.setItem(`kai.geminiThinkingLevel.${itemData.value}`, opt.value);
                                    localStorage.setItem(`kai.geminiThinkingLevel.${rawModel}`, opt.value);
                                    localStorage.setItem('kai.geminiThinkingLevel', opt.value);
                                } else {
                                    localStorage.setItem(`kai.lmStudioReasoningLevel.${rawModel}`, opt.value);
                                    localStorage.setItem(`kai.lmStudioReasoningLevel.${itemData.value}`, opt.value);
                                    if (rawModel.includes('/')) {
                                        const short = rawModel.split('/').pop();
                                        localStorage.setItem(`kai.lmStudioReasoningLevel.${short}`, opt.value);
                                    }
                                }

                                caps.reasoningLevel = opt.value;
                                this.selectedModelValue = itemData.value;
                                localStorage.setItem('kai.selectedModel', itemData.value);
                                this.setSelectedModel(itemData.value);

                                if (this.statusDot) {
                                    this.statusDot.className = (isModelConnectedFn && isModelConnectedFn(itemData.rawModel)) ? 'status-dot status-connected' : 'status-dot status-disconnected';
                                }
                                this.closeActiveFlyoutImmediately();
                                this.dropdownOptionsMenu.classList.add('hidden');

                                if (this.onSelect) {
                                    this.onSelect(itemData.value);
                                }
                            };

                            optItem.addEventListener('click', handleEffortClick);
                            optItem.addEventListener('keydown', (e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    handleEffortClick(e);
                                }
                            });

                            flyoutInner.appendChild(optItem);
                        });
                    }

                    flyoutMenu.appendChild(flyoutInner);
                    item.appendChild(flyoutMenu);

                    // Dynamic positioning and hover handlers
                    const openFlyout = () => {
                        if (this.flyoutCloseTimer) {
                            clearTimeout(this.flyoutCloseTimer);
                            this.flyoutCloseTimer = null;
                        }
                        if (this.activeFlyoutItem && this.activeFlyoutItem !== item) {
                            this.activeFlyoutItem.classList.remove('flyout-open');
                        }
                        item.classList.add('flyout-open');
                        this.activeFlyoutItem = item;

                        const rect = item.getBoundingClientRect();
                        flyoutMenu.style.position = 'fixed';
                        flyoutMenu.style.top = `${rect.top}px`;

                        let leftPos = rect.right + 4;
                        const flyoutWidth = 160;
                        if (leftPos + flyoutWidth > window.innerWidth) {
                            leftPos = Math.max(10, rect.left - flyoutWidth - 4);
                        }
                        flyoutMenu.style.left = `${leftPos}px`;
                    };

                    const scheduleCloseFlyout = () => {
                        this.flyoutCloseTimer = setTimeout(() => {
                            if (this.activeFlyoutItem === item) {
                                item.classList.remove('flyout-open');
                                this.activeFlyoutItem = null;
                            }
                        }, 150);
                    };

                    item.addEventListener('mouseenter', openFlyout);
                    item.addEventListener('mouseleave', scheduleCloseFlyout);
                    flyoutMenu.addEventListener('mouseenter', () => {
                        if (this.flyoutCloseTimer) {
                            clearTimeout(this.flyoutCloseTimer);
                            this.flyoutCloseTimer = null;
                        }
                    });
                    flyoutMenu.addEventListener('mouseleave', scheduleCloseFlyout);
                }

                // Base Model Item Click
                const handleItemClick = (e) => {
                    if (e.target.closest('.thinking-flyout-menu')) return;
                    e.stopPropagation();
                    this.selectedModelValue = itemData.value;
                    localStorage.setItem('kai.selectedModel', itemData.value);

                    this.setSelectedModel(itemData.value);

                    if (this.statusDot) {
                        this.statusDot.className = (isModelConnectedFn && isModelConnectedFn(itemData.rawModel)) ? 'status-dot status-connected' : 'status-dot status-disconnected';
                    }
                    this.closeActiveFlyoutImmediately();
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
     * Populates initial connected cloud and free models so user only sees connected providers.
     */
    initDefaultDropdown() {
        if (!this.dropdownOptionsMenu) return;
        this.dropdownOptionsMenu.innerHTML = '';

        const defaultGemini = KAI_CONSTANTS.DEFAULT_GEMINI_MODELS;
        const defaultProviders = KAI_CONSTANTS.DEFAULT_FREE_PROVIDERS || [];

        let addedAny = false;

        const geminiKey = (localStorage.getItem('kai.geminiApiKey') || localStorage.getItem('kai.apiKey') || '').trim();
        if (geminiKey) {
            const showGeminiExpanded = this.selectedModelValue && this.selectedModelValue.toLowerCase().startsWith('gemini');
            this.createAccordionGroup('Gemini', defaultGemini, showGeminiExpanded);
            addedAny = true;
        }

        defaultProviders.forEach(p => {
            const key = (localStorage.getItem(`kai.${p.configKey}`) || '').trim();
            if (key) {
                const isExpanded = this.selectedModelValue && p.models.includes(this.selectedModelValue);
                const cleanName = p.name.replace(/\s*\([^)]*\)/g, '').trim();
                this.createAccordionGroup(cleanName, p.models, isExpanded);
                addedAny = true;
            }
        });

        if (!addedAny) {
            const placeholder = document.createElement('div');
            placeholder.className = 'dropdown-item-placeholder';
            placeholder.textContent = 'No connected models. Add API key in Settings.';
            this.dropdownOptionsMenu.appendChild(placeholder);
        }
    }

    /**
     * Updates model dropdown options and connection dots when extension connectionStatus event arrives.
     * Only renders providers and APIs that are active and connected.
     * @param {object} message Connection status payload from extension host.
     */
    updateConnectionStatus(message) {
        if (!this.dropdownOptionsMenu) return;

        if (message.lmStudioCapabilities) {
            ThinkingStateFormatter.setLMStudioCapabilities(message.lmStudioCapabilities);
        }

        const fingerprint = JSON.stringify({
            c: message.connected,
            lm: message.lmStudioModels,
            gm: message.geminiModels,
            ld: message.loadedModels,
            caps: Object.keys(message.lmStudioCapabilities || {}).length,
            ak: message.apiKey,
            fp: (message.freeProviders || []).map(p => ({ k: p.configKey, has: !!p.apiKey }))
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
                const key = (localStorage.getItem('kai.geminiApiKey') || localStorage.getItem('kai.apiKey') || '').trim();
                return !!(message.apiKey || key);
            }
            const freeProviders = message.freeProviders || [];
            for (const provider of freeProviders) {
                if (provider.models.includes(bare)) {
                    const key = (localStorage.getItem(`kai.${provider.configKey}`) || '').trim();
                    return !!(provider.apiKey || key);
                }
            }
            return Boolean(message.connected && message.loadedModels && message.loadedModels.includes(bare));
        };

        const lmStudioModels = message.lmStudioModels || [];
        this.lmStudioRawModels = lmStudioModels;
        const geminiModels = message.geminiModels || [];

        this.dropdownOptionsMenu.innerHTML = '';

        let addedCategories = 0;

        // 1. LM Studio local models - ONLY if connected with loaded models
        const isLMConnected = Boolean(message.connected && lmStudioModels.length > 0);
        if (isLMConnected) {
            const i18n = window.KAI_I18N || {};
            const lmStudioStatus = i18n.connected || 'Connected';
            const headerTitle = i18n.lmStudioHeader || 'LM Studio';
            const lmTitle = `${headerTitle} (${lmStudioStatus})`;
            const isExpanded = this.selectedModelValue && !this.selectedModelValue.toLowerCase().startsWith('gemini');
            this.createAccordionGroup(lmTitle, lmStudioModels, isExpanded, isModelConnected, true);
            addedCategories++;
        }

        // 2. Google Gemini - ONLY if API key is configured
        const hasGeminiKey = Boolean(message.apiKey || (localStorage.getItem('kai.geminiApiKey') || localStorage.getItem('kai.apiKey') || '').trim());
        if (hasGeminiKey) {
            const geminiTitle = 'Gemini';
            const showGeminiExpanded = this.selectedModelValue && this.selectedModelValue.toLowerCase().startsWith('gemini');
            this.createAccordionGroup(geminiTitle, geminiModels.length > 0 ? geminiModels : KAI_CONSTANTS.DEFAULT_GEMINI_MODELS, showGeminiExpanded, isModelConnected);
            addedCategories++;
        }

        // 3. Free Cloud Providers - ONLY if API key is configured
        const freeProviders = message.freeProviders || [];
        this.freeProvidersConfig = freeProviders;
        for (const provider of freeProviders) {
            const hasProviderKey = Boolean(provider.apiKey || (localStorage.getItem(`kai.${provider.configKey}`) || '').trim());
            if (hasProviderKey) {
                const isExpanded = this.selectedModelValue && provider.models.includes(this.selectedModelValue);
                const cleanName = provider.name.replace(/\s*\([^)]*\)/g, '').trim();
                this.createAccordionGroup(cleanName, provider.models, isExpanded, isModelConnected);
                addedCategories++;
            }
        }

        if (addedCategories === 0) {
            const placeholder = document.createElement('div');
            placeholder.className = 'dropdown-item-placeholder';
            placeholder.textContent = 'No connected models. Add API key in Settings.';
            this.dropdownOptionsMenu.appendChild(placeholder);
        }

        if (this.selectedModelValue && this.selectedModelValue !== 'local-model' && this.selectedModelValue !== 'No Models Loaded') {
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

        this.updateGeminiThinkingVisibility();
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
     * Sets active model ID and updates UI elements, dropdown list highlights, and connection status indicators.
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
    }

    /**
     * Cleans up any deprecated icon elements from dropdown list items.
     */
    updateModelDropdownItemBatteries() {
        if (!this.dropdownOptionsMenu) return;
        const oldIcons = this.dropdownOptionsMenu.querySelectorAll('.item-battery-icon, .thinking-lamp-icon, .flyout-battery-icon');
        oldIcons.forEach(el => el.remove());
    }

    /**
     * Updates visibility of reasoning sub-settings in settings panel if present.
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

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
                const lowerModel = itemData.rawModel.toLowerCase();
                const isGemini = lowerModel.includes('gemini');
                const isMistralReasoning = lowerModel.includes('magistral') || lowerModel.includes('codestral') || lowerModel.includes('mistral-small') || lowerModel.includes('mistral-medium');
                const isMuseGlimmer = lowerModel.includes('muse') || lowerModel.includes('glimmer');
                const thinkingState = ThinkingStateFormatter.getThinkingState(itemData.rawModel);
                const isLMStudio = isLMStudioCategory && !isMuseGlimmer && thinkingState.isThinkingCapable;
                const hasFlyout = isGemini || isMistralReasoning || isLMStudio;
                
                // Model Selector Dropdown Button Item (Interactive button element)
                const item = document.createElement('div');
                item.className = hasFlyout ? 'dropdown-item model-hover-item' : 'dropdown-item';
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

                // THINKING DROPDOWN / FLYOUT MENU (Attached sub-menu for thinking level / toggle)
                if (hasFlyout) {
                    const chevronSpan = document.createElement('span');
                    chevronSpan.className = 'model-flyout-chevron';
                    chevronSpan.textContent = '›';
                    item.appendChild(chevronSpan);

                    const flyoutMenu = document.createElement('div');
                    flyoutMenu.className = 'thinking-flyout-menu';

                    const flyoutInner = document.createElement('div');
                    flyoutInner.className = 'thinking-flyout-menu-inner';

                    if (isGemini) {
                        const currentGeminiLevel = localStorage.getItem(`kai.geminiThinkingLevel.${itemData.value}`) || localStorage.getItem('kai.geminiThinkingLevel') || 'high';
                        const levels = [
                            { level: 'high', label: 'High' },
                            { level: 'medium', label: 'Medium' },
                            { level: 'low', label: 'Low' },
                            { level: 'minimal', label: 'Minimal (Off)' }
                        ];

                        levels.forEach(lvl => {
                            const flyoutOpt = document.createElement('button');
                            flyoutOpt.type = 'button';
                            const isSelected = lvl.level === currentGeminiLevel;
                            flyoutOpt.className = `dropdown-item flyout-option ${isSelected ? 'selected' : ''}`;
                            flyoutOpt.setAttribute('role', 'button');
                            flyoutOpt.setAttribute('aria-label', `Set thinking level to ${lvl.label}`);
                            
                            ThinkingStateFormatter.renderFlyoutOptionContent(flyoutOpt, lvl.label, lvl.level);

                            if (isSelected) {
                                const checkSvg = DOMUtils.createCheckIcon('check-icon');
                                flyoutOpt.appendChild(checkSvg);
                            }
                            
                            const handleFlyoutSelect = (e) => {
                                e.stopPropagation();
                                localStorage.setItem(`kai.geminiThinkingLevel.${itemData.value}`, lvl.level);
                                localStorage.setItem('kai.geminiThinkingLevel', lvl.level);
                                this.selectedModelValue = itemData.value;
                                localStorage.setItem('kai.selectedModel', itemData.value);

                                flyoutInner.querySelectorAll('.flyout-option').forEach(opt => {
                                    opt.classList.remove('selected');
                                    const oldCheck = opt.querySelector('.check-icon');
                                    if (oldCheck) oldCheck.remove();
                                });
                                flyoutOpt.classList.add('selected');
                                const checkSvg = DOMUtils.createCheckIcon('check-icon');
                                flyoutOpt.appendChild(checkSvg);

                                this.setSelectedModel(itemData.value);

                                this.closeActiveFlyoutImmediately();
                                if (this.dropdownOptionsMenu) {
                                    this.dropdownOptionsMenu.classList.add('hidden');
                                }
                                if (this.onSelect) {
                                    this.onSelect(itemData.value);
                                }
                            };

                            flyoutOpt.addEventListener('click', handleFlyoutSelect);
                            flyoutInner.appendChild(flyoutOpt);
                        });
                      } else if (isMistralReasoning) {
                        const isMistralThinkingOn = localStorage.getItem(`kai.mistralThinking.${itemData.rawModel}`) !== 'false';
                        
                        const flyoutRow = document.createElement('div');
                        flyoutRow.className = 'dropdown-item flyout-option';
                        flyoutRow.style.width = 'calc(100% - 4px)';
                        flyoutRow.style.justifyContent = 'space-between';
                        flyoutRow.style.gap = '12px';

                        const leftWrapper = document.createElement('div');
                        leftWrapper.style.display = 'inline-flex';
                        leftWrapper.style.alignItems = 'center';
                        leftWrapper.style.gap = '6px';

                        ThinkingStateFormatter.renderFlyoutOptionContent(leftWrapper, 'Thinking', isMistralThinkingOn);

                        const toggleEl = ToggleComponent.create({
                            id: `mistral-thinking-toggle-${itemData.rawModel.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
                            checked: isMistralThinkingOn,
                            title: 'Enable reasoning/thinking for this Mistral model',
                            onChange: (checked) => {
                                localStorage.setItem(`kai.mistralThinking.${itemData.rawModel}`, checked ? 'true' : 'false');
                                this.setSelectedModel(this.selectedModelValue);
                                if (this.onSelect && this.selectedModelValue === itemData.value) {
                                    this.onSelect(itemData.value);
                                }
                            }
                        });

                        flyoutRow.appendChild(leftWrapper);
                        flyoutRow.appendChild(toggleEl);

                        flyoutRow.addEventListener('click', (e) => {
                            e.stopPropagation();
                            const checkbox = toggleEl.querySelector('input[type="checkbox"]');
                            if (checkbox && e.target !== checkbox) {
                                checkbox.checked = !checkbox.checked;
                                checkbox.dispatchEvent(new Event('change'));
                            }
                        });

                        flyoutInner.appendChild(flyoutRow);
                    } else if (isLMStudio) {
                        const isLmThinkingOn = localStorage.getItem(`kai.lmStudioThinking.${itemData.rawModel}`) !== 'false';
                        const currentLmReasoningLevel = localStorage.getItem(`kai.lmStudioReasoningLevel.${itemData.rawModel}`) ||
                                                        localStorage.getItem('kai.lmStudioReasoningLevel') || 'xhigh';

                        const cap = ThinkingStateFormatter.lmStudioCapabilities[itemData.rawModel] ||
                                    ThinkingStateFormatter.lmStudioCapabilities[lowerModel];
                        let fields = (cap && Array.isArray(cap.fields) && cap.fields.length > 0) ? cap.fields : [];

                        // Fallback fields strictly when no manifest exists
                        if (fields.length === 0) {
                            if (lowerModel.includes('qwen') || lowerModel.includes('qwq') || lowerModel.includes('glm')) {
                                fields = [
                                    {
                                        displayName: 'Thinking',
                                        type: 'boolean',
                                        variable: 'enable_thinking'
                                    },
                                    {
                                        displayName: 'Reasoning Effort',
                                        type: 'select',
                                        variable: 'reasoning_effort',
                                        options: [
                                            { label: 'xhigh', value: 'xhigh' },
                                            { label: 'Medium', value: 'medium' },
                                            { label: 'Low', value: 'low' }
                                        ]
                                    }
                                ];
                            } else if (lowerModel.includes('gemma') || lowerModel.includes('bonsai') || lowerModel.includes('deepseek') || lowerModel.includes('r1')) {
                                fields = [
                                    {
                                        displayName: 'Thinking',
                                        type: 'boolean',
                                        variable: 'enable_thinking'
                                    }
                                ];
                            }
                        }

                        // Separate boolean toggle and select fields
                        const selectField = fields.find(f => f.type === 'select' && Array.isArray(f.options) && f.options.length > 0);
                        const booleanField = fields.find(f => f.type === 'boolean') || (!selectField && thinkingState.isThinkingCapable);

                        // 1. Render Select options FIRST (xhigh, medium, low)
                        if (selectField) {
                            const cleanOptions = selectField.options.filter(o => o.value !== 'off' && o.value !== 'none');
                            cleanOptions.forEach(opt => {
                                const flyoutOpt = document.createElement('button');
                                flyoutOpt.type = 'button';
                                const optVal = typeof opt === 'string' ? opt : (opt.value || opt.label);
                                const isSelected = optVal === currentLmReasoningLevel;
                                flyoutOpt.className = `dropdown-item flyout-option ${isSelected ? 'selected' : ''}`;
                                flyoutOpt.setAttribute('role', 'button');
                                
                                const optLabel = optVal;
                                flyoutOpt.setAttribute('aria-label', `Set ${selectField.displayName || 'Reasoning Effort'} to ${optLabel}`);
                                
                                ThinkingStateFormatter.renderFlyoutOptionContent(flyoutOpt, optLabel, optVal);

                                if (isSelected) {
                                    const checkSvg = DOMUtils.createCheckIcon('check-icon');
                                    flyoutOpt.appendChild(checkSvg);
                                }
                                
                                const handleFlyoutSelect = (e) => {
                                    e.stopPropagation();
                                    const aliases = [
                                        itemData.rawModel,
                                        itemData.rawModel.toLowerCase(),
                                        itemData.value,
                                        itemData.value.toLowerCase(),
                                        itemData.rawModel.split('/').pop(),
                                        itemData.rawModel.split('/').pop().toLowerCase()
                                    ];
                                    aliases.filter(Boolean).forEach(a => {
                                        localStorage.setItem(`kai.lmStudioReasoningLevel.${a}`, opt.value);
                                        localStorage.setItem(`kai.lmStudioThinking.${a}`, 'true');
                                    });
                                    localStorage.setItem('kai.lmStudioReasoningLevel', opt.value);
                                    this.selectedModelValue = itemData.value;
                                    localStorage.setItem('kai.selectedModel', itemData.value);

                                    flyoutInner.querySelectorAll('.flyout-option').forEach(el => {
                                        el.classList.remove('selected');
                                        const oldCheck = el.querySelector('.check-icon');
                                        if (oldCheck) oldCheck.remove();
                                    });
                                    flyoutOpt.classList.add('selected');
                                    const checkSvg = DOMUtils.createCheckIcon('check-icon');
                                    flyoutOpt.appendChild(checkSvg);

                                    this.setSelectedModel(itemData.value);

                                    this.closeActiveFlyoutImmediately();
                                    if (this.dropdownOptionsMenu) {
                                        this.dropdownOptionsMenu.classList.add('hidden');
                                    }
                                    if (this.onSelect) {
                                        this.onSelect(itemData.value);
                                    }
                                };

                                flyoutOpt.addEventListener('click', handleFlyoutSelect);
                                flyoutInner.appendChild(flyoutOpt);
                            });
                        }

                        // 2. Render Boolean Toggle SECOND (Thinking Toggle switch)
                        if (booleanField) {
                            const isLmThinkingOn = localStorage.getItem(`kai.lmStudioThinking.${itemData.rawModel}`) !== 'false';

                            const toggleRow = document.createElement('div');
                            toggleRow.className = 'dropdown-item flyout-option';
                            toggleRow.style.width = 'calc(100% - 4px)';
                            toggleRow.style.justifyContent = 'space-between';
                            toggleRow.style.gap = '12px';

                            const leftWrapper = document.createElement('div');
                            leftWrapper.style.display = 'inline-flex';
                            leftWrapper.style.alignItems = 'center';
                            leftWrapper.style.gap = '6px';

                            ThinkingStateFormatter.renderFlyoutOptionContent(leftWrapper, 'Thinking', isLmThinkingOn);

                            const toggleEl = ToggleComponent.create({
                                id: `lm-thinking-toggle-${itemData.rawModel.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
                                checked: isLmThinkingOn,
                                title: 'Enable reasoning/thinking for this local model',
                                onChange: (checked) => {
                                    const valStr = checked ? 'true' : 'false';
                                    const aliases = [
                                        itemData.rawModel,
                                        itemData.rawModel.toLowerCase(),
                                        itemData.value,
                                        itemData.value.toLowerCase(),
                                        itemData.rawModel.split('/').pop(),
                                        itemData.rawModel.split('/').pop().toLowerCase(),
                                        this.selectedModelValue,
                                        (this.selectedModelValue || '').toLowerCase()
                                    ];
                                    aliases.filter(Boolean).forEach(a => localStorage.setItem(`kai.lmStudioThinking.${a}`, valStr));
                                    
                                    // Update battery icon in flyout
                                    leftWrapper.innerHTML = '';
                                    ThinkingStateFormatter.renderFlyoutOptionContent(leftWrapper, 'Thinking', checked);

                                    // Update trigger button
                                    this.setSelectedModel(this.selectedModelValue);

                                    if (this.onSelect && (this.selectedModelValue === itemData.value || this.selectedModelValue === itemData.rawModel)) {
                                        this.onSelect(this.selectedModelValue);
                                    }
                                }
                            });

                            toggleRow.appendChild(leftWrapper);
                            toggleRow.appendChild(toggleEl);

                            toggleRow.addEventListener('click', (e) => {
                                e.stopPropagation();
                                const checkbox = toggleEl.querySelector('input[type="checkbox"]');
                                if (checkbox && e.target !== checkbox) {
                                    checkbox.checked = !checkbox.checked;
                                    checkbox.dispatchEvent(new Event('change'));
                                }
                            });

                            flyoutInner.appendChild(toggleRow);
                        }
                    }

                    flyoutMenu.appendChild(flyoutInner);
                    item.appendChild(flyoutMenu);

                    /* Position thinking flyout dropdown & manage 0.5s timeout on container leave vs 0ms on model switch */
                    const positionFlyout = () => {
                        if (this.flyoutCloseTimer) {
                            clearTimeout(this.flyoutCloseTimer);
                            this.flyoutCloseTimer = null;
                        }
                        if (this.activeFlyoutItem && this.activeFlyoutItem !== item) {
                            this.closeActiveFlyoutImmediately();
                        }
                        this.activeFlyoutItem = item;
                        item.classList.add('flyout-open');

                        const itemRect = item.getBoundingClientRect();
                        let left = itemRect.right - 2;
                        flyoutMenu.style.left = left + 'px';
                        flyoutMenu.style.top  = itemRect.top + 'px';
                    };

                    const startCloseTimer = () => {
                        if (this.flyoutCloseTimer) {
                            clearTimeout(this.flyoutCloseTimer);
                        }
                        // 0.5s (500ms) timeout when hovering away from the container into empty space
                        this.flyoutCloseTimer = setTimeout(() => {
                            if (this.activeFlyoutItem === item) {
                                this.closeActiveFlyoutImmediately();
                            }
                        }, 500);
                    };

                    item.addEventListener('mouseenter', () => {
                        if (this.flyoutCloseTimer) {
                            clearTimeout(this.flyoutCloseTimer);
                            this.flyoutCloseTimer = null;
                        }
                        positionFlyout();
                    });

                    item.addEventListener('mouseleave', startCloseTimer);

                    flyoutMenu.addEventListener('mouseenter', () => {
                        if (this.flyoutCloseTimer) {
                            clearTimeout(this.flyoutCloseTimer);
                            this.flyoutCloseTimer = null;
                        }
                        this.activeFlyoutItem = item;
                        item.classList.add('flyout-open');
                    });

                    flyoutMenu.addEventListener('mouseleave', startCloseTimer);
                }

                // Immediately close any open flyout from another item when hovering over a non-flyout model item (0ms delay)
                item.addEventListener('mouseenter', () => {
                    if (this.activeFlyoutItem && this.activeFlyoutItem !== item) {
                        this.closeActiveFlyoutImmediately();
                    }
                });
                
                const handleItemClick = (e) => {
                    // Prevent trigger when clicking directly inside the sub-thinking flyout menu
                    if (e.target.closest('.thinking-flyout-menu')) {
                        return;
                    }
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
     * Resolves currently selected model details including bare model ID and thinking toggle flag.
     * @param {string} [modelId] Optional target model ID to inspect.
     * @returns {object} Object containing model ID string, boolean thinking flag, and reasoning effort.
     */
    getSelectedModelDetails(modelId = null) {
        const targetModel = modelId || this.selectedModelValue || 'local-model';
        const raw = targetModel.endsWith(' (thinking)') ? targetModel.slice(0, -11) : targetModel;
        const thinkingState = ThinkingStateFormatter.getThinkingState(raw);

        if (!thinkingState.isThinkingCapable) {
            return {
                model: raw,
                thinking: false,
                isThinkingCapable: false,
                reasoningEffort: 'none'
            };
        }

        // Map 'on'/'off' to valid LM Studio API values (none, low, medium, high, xhigh)
        let effort = thinkingState.level || 'xhigh';
        if (effort === 'on') effort = 'xhigh';
        if (effort === 'off') effort = 'none';

        return {
            model: raw,
            thinking: thinkingState.isOn,
            isThinkingCapable: true,
            reasoningEffort: thinkingState.isOn ? effort : 'none'
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

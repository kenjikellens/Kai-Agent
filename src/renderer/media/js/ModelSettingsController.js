/**
 * ModelSettingsController manages the dedicated model settings dropdown (Dropdown 2).
 * Handles the chevron trigger button, Thinking mode toggle switch, and Reasoning Effort pop-up submenu.
 */
class ModelSettingsController {
    /**
     * Initializes DOM elements and settings event listeners.
     * @param {object} [options] Configuration options.
     * @param {Function} [options.onSettingsChange] Callback triggered when thinking or reasoning settings change.
     */
    constructor(options = {}) {
        this.onSettingsChange = options.onSettingsChange || null;
        this.container = document.getElementById('model-settings-dropdown-container');
        this.triggerBtn = document.getElementById('model-settings-trigger-btn');
        this.menu = document.getElementById('model-settings-menu');
        this.isReasoningFlyoutOpen = false;
        this.activeModelId = '';

        this.initEventListeners();
    }

    /**
     * Registers trigger click and outside click listeners.
     * Manages opening, closing, and flyout state of the settings menu.
     */
    initEventListeners() {
        if (this.triggerBtn) {
            this.triggerBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const modelMenu = document.getElementById('dropdown-options-menu');
                if (modelMenu) modelMenu.classList.add('hidden');

                if (this.menu) {
                    this.menu.classList.toggle('hidden');
                    this.isReasoningFlyoutOpen = false;
                    if (!this.menu.classList.contains('hidden')) {
                        const caps = ThinkingStateFormatter.getCapabilitiesState(this.activeModelId);
                        this.renderMenu(caps);
                    }
                }
            });
        }

        document.addEventListener('click', (e) => {
            if (!e.target.closest('#model-settings-dropdown-container') && this.menu) {
                this.close();
            }
        });
    }

    /**
     * Updates visibility and content based on active model capabilities.
     * Hides the dropdown button if the model does not support thinking or reasoning.
     * @param {string} modelId Active model identifier.
     */
    update(modelId) {
        this.activeModelId = modelId;
        if (!this.container || !this.menu) {
            this.container = document.getElementById('model-settings-dropdown-container');
            this.triggerBtn = document.getElementById('model-settings-trigger-btn');
            this.menu = document.getElementById('model-settings-menu');
        }
        if (!this.container || !this.menu) return;

        const caps = ThinkingStateFormatter.getCapabilitiesState(modelId);
        const hasCapabilities = caps.hasThinkingToggle || (caps.hasReasoningEffort && caps.effortOptions.length > 0);

        if (!hasCapabilities) {
            this.container.classList.add('hidden');
            this.menu.classList.add('hidden');
            this.isReasoningFlyoutOpen = false;
            return;
        }

        this.container.classList.remove('hidden');
        this.renderMenu(caps);
    }

    /**
     * Closes the settings dropdown menu and resets flyout state.
     * Hides the menu element from view.
     */
    close() {
        if (this.menu) {
            this.menu.classList.add('hidden');
        }
        this.isReasoningFlyoutOpen = false;
    }

    /**
     * Renders thinking toggle switch and reasoning effort pop-up rows inside the menu.
     * Populates DOM items with SVG battery icons and labels directly from capabilities.
     * @param {object} caps Capabilities state object.
     */
    renderMenu(caps) {
        if (!this.menu) return;
        this.menu.innerHTML = '';
        const rawModel = caps.rawModel;

        // 1. Thinking Toggle Switch
        if (caps.hasThinkingToggle) {
            const header = document.createElement('div');
            header.className = 'settings-section-title';
            header.textContent = 'Thinking';
            this.menu.appendChild(header);

            const toggleRow = document.createElement('div');
            toggleRow.className = 'toggle-switch-row';
            toggleRow.setAttribute('role', 'button');
            toggleRow.setAttribute('tabindex', '0');
            toggleRow.setAttribute('aria-label', `Toggle thinking ${caps.isThinkingOn ? 'off' : 'on'}`);

            const toggleLabel = document.createElement('div');
            toggleLabel.className = 'toggle-label';
            const batterySvg = DOMUtils.createBatteryIcon(caps.isThinkingOn, 'thinking-battery-icon');
            const labelSpan = document.createElement('span');
            labelSpan.textContent = 'Thinking';
            toggleLabel.appendChild(batterySvg);
            toggleLabel.appendChild(labelSpan);
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

                const newBattery = DOMUtils.createBatteryIcon(newState, 'thinking-battery-icon');
                batterySvg.replaceWith(newBattery);

                localStorage.setItem(`kai.lmStudioThinking.${rawModel}`, newState ? 'true' : 'false');
                localStorage.setItem(`kai.mistralThinking.${rawModel}`, newState ? 'true' : 'false');
                if (rawModel.includes('/')) {
                    const short = rawModel.split('/').pop();
                    localStorage.setItem(`kai.lmStudioThinking.${short}`, newState ? 'true' : 'false');
                }

                if (this.onSettingsChange) {
                    this.onSettingsChange({ modelId: this.activeModelId, type: 'thinking', value: newState });
                }
            };

            toggleRow.addEventListener('click', handleToggleClick);
            toggleRow.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleToggleClick(e);
                }
            });

            this.menu.appendChild(toggleRow);
        }

        // 2. Reasoning Effort Floating Pop-up Submenu
        if (caps.hasReasoningEffort && Array.isArray(caps.effortOptions) && caps.effortOptions.length > 0) {
            const header = document.createElement('div');
            header.className = 'settings-section-title';
            header.textContent = caps.effortDisplayName || 'Reasoning Effort';
            this.menu.appendChild(header);

            const matchedOpt = caps.effortOptions.find(o => o.value === caps.reasoningLevel) || caps.effortOptions[0];

            const flyoutRow = document.createElement('div');
            flyoutRow.className = `flyout-trigger-row ${this.isReasoningFlyoutOpen ? 'active' : ''}`;
            flyoutRow.setAttribute('role', 'button');
            flyoutRow.setAttribute('tabindex', '0');

            const leftContent = document.createElement('div');
            leftContent.className = 'toggle-label';
            const rowBattery = DOMUtils.createBatteryIcon(matchedOpt.value, 'thinking-battery-icon');
            const rowLabel = document.createElement('span');
            rowLabel.textContent = matchedOpt.label;
            leftContent.appendChild(rowBattery);
            leftContent.appendChild(rowLabel);
            flyoutRow.appendChild(leftContent);

            const chevronSvg = DOMUtils.createChevronIcon('flyout-chevron');
            chevronSvg.style.transform = 'rotate(-90deg)';
            flyoutRow.appendChild(chevronSvg);

            // Floating popup submenu
            if (this.isReasoningFlyoutOpen) {
                const popupMenu = document.createElement('div');
                popupMenu.className = 'flyout-popup-menu';

                caps.effortOptions.forEach(opt => {
                    const item = document.createElement('div');
                    const isSelected = opt.value === caps.reasoningLevel;
                    item.className = `dropdown-item ${isSelected ? 'selected' : ''}`;
                    item.setAttribute('role', 'button');
                    item.setAttribute('tabindex', '0');

                    const itemLabel = document.createElement('span');
                    itemLabel.textContent = opt.label;
                    item.appendChild(itemLabel);

                    const itemBattery = DOMUtils.createBatteryIcon(opt.value, 'item-battery-icon');
                    item.appendChild(itemBattery);

                    if (isSelected) {
                        const checkSvg = DOMUtils.createCheckIcon('check-icon');
                        item.appendChild(checkSvg);
                    }

                    const handleOptionClick = (e) => {
                        e.stopPropagation();
                        if (rawModel.toLowerCase().includes('gemini')) {
                            localStorage.setItem(`kai.geminiThinkingLevel.${this.activeModelId}`, opt.value);
                            localStorage.setItem(`kai.geminiThinkingLevel.${rawModel}`, opt.value);
                            localStorage.setItem('kai.geminiThinkingLevel', opt.value);
                        } else {
                            localStorage.setItem(`kai.lmStudioReasoningLevel.${rawModel}`, opt.value);
                            localStorage.setItem(`kai.lmStudioReasoningLevel.${this.activeModelId}`, opt.value);
                            if (rawModel.includes('/')) {
                                const short = rawModel.split('/').pop();
                                localStorage.setItem(`kai.lmStudioReasoningLevel.${short}`, opt.value);
                            }
                        }

                        this.isReasoningFlyoutOpen = false;
                        this.close();

                        if (this.onSettingsChange) {
                            this.onSettingsChange({ modelId: this.activeModelId, type: 'effort', value: opt.value });
                        }
                    };

                    item.addEventListener('click', handleOptionClick);
                    item.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleOptionClick(e);
                        }
                    });

                    popupMenu.appendChild(item);
                });

                flyoutRow.appendChild(popupMenu);
            }

            const handleFlyoutClick = (e) => {
                e.stopPropagation();
                this.isReasoningFlyoutOpen = !this.isReasoningFlyoutOpen;
                this.renderMenu(caps);
            };

            flyoutRow.addEventListener('click', handleFlyoutClick);
            flyoutRow.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleFlyoutClick(e);
                }
            });

            this.menu.appendChild(flyoutRow);
        }
    }
}

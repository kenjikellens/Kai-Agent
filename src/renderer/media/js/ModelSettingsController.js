/**
 * ModelSettingsController manages the dedicated model settings dropdown (Dropdown 2).
 * Handles the chevron trigger button, standalone thinking lamp indicator, and settings menu.
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
        this.indicatorEl = document.getElementById('model-thinking-indicator');
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
     * Updates visibility, standalone lamp indicator, and content based on active model capabilities.
     * Hides the container if the model does not support thinking or reasoning.
     * @param {string} modelId Active model identifier.
     */
    update(modelId) {
        this.activeModelId = modelId;
        if (!this.container || !this.menu || !this.indicatorEl) {
            this.container = document.getElementById('model-settings-dropdown-container');
            this.triggerBtn = document.getElementById('model-settings-trigger-btn');
            this.indicatorEl = document.getElementById('model-thinking-indicator');
            this.menu = document.getElementById('model-settings-menu');
        }
        if (!this.container || !this.menu) return;

        const caps = ThinkingStateFormatter.getCapabilitiesState(modelId);
        const hasCapabilities = caps.hasThinkingToggle || (caps.hasReasoningEffort && caps.effortOptions.length > 0);

        if (!hasCapabilities) {
            this.container.classList.add('hidden');
            this.menu.classList.add('hidden');
            if (this.indicatorEl) this.indicatorEl.innerHTML = '';
            this.isReasoningFlyoutOpen = false;
            return;
        }

        this.container.classList.remove('hidden');
        this.updateIndicatorBadge(caps);
        this.renderMenu(caps);
    }

    /**
     * Updates the standalone lamp icon and reasoning level text placed to the right of the chevron.
     * Renders yellow active lamp, gray slashed inactive lamp, and level label when applicable.
     * @param {object} caps Capabilities state object.
     */
    updateIndicatorBadge(caps) {
        if (!this.indicatorEl) return;
        this.indicatorEl.innerHTML = '';

        const isThinkingOn = caps.hasThinkingToggle 
            ? caps.isThinkingOn 
            : (caps.reasoningLevel !== 'off' && caps.reasoningLevel !== 'none');

        const lampSvg = DOMUtils.createLightbulbIcon(isThinkingOn, 'thinking-lamp-icon');
        this.indicatorEl.appendChild(lampSvg);

        if (caps.hasReasoningEffort && isThinkingOn) {
            const matchedOpt = caps.effortOptions.find(o => o.value === caps.reasoningLevel) || caps.effortOptions[0];
            if (matchedOpt && matchedOpt.value !== 'off' && matchedOpt.value !== 'none') {
                const levelSpan = document.createElement('span');
                levelSpan.className = 'lamp-level-label';
                levelSpan.textContent = matchedOpt.label;
                this.indicatorEl.appendChild(levelSpan);
            }
        }
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
     * Populates DOM items with Lamp SVG icons and clean labels directly from capabilities.
     * @param {object} caps Capabilities state object.
     */
    renderMenu(caps) {
        if (!this.menu) return;
        this.menu.innerHTML = '';
        const rawModel = caps.rawModel;

        // 1. Thinking Toggle Switch
        if (caps.hasThinkingToggle) {
            const toggleRow = document.createElement('div');
            toggleRow.className = 'toggle-switch-row';
            toggleRow.setAttribute('role', 'button');
            toggleRow.setAttribute('tabindex', '0');
            toggleRow.setAttribute('aria-label', `Toggle thinking ${caps.isThinkingOn ? 'off' : 'on'}`);

            const toggleLabel = document.createElement('div');
            toggleLabel.className = 'toggle-label';
            const lampSvg = DOMUtils.createLightbulbIcon(caps.isThinkingOn, 'thinking-lamp-icon');
            const labelSpan = document.createElement('span');
            labelSpan.textContent = 'Thinking';
            toggleLabel.appendChild(lampSvg);
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

                const newLamp = DOMUtils.createLightbulbIcon(newState, 'thinking-lamp-icon');
                lampSvg.replaceWith(newLamp);

                localStorage.setItem(`kai.lmStudioThinking.${rawModel}`, newState ? 'true' : 'false');
                localStorage.setItem(`kai.mistralThinking.${rawModel}`, newState ? 'true' : 'false');
                if (rawModel.includes('/')) {
                    const short = rawModel.split('/').pop();
                    localStorage.setItem(`kai.lmStudioThinking.${short}`, newState ? 'true' : 'false');
                }

                caps.isThinkingOn = newState;
                this.updateIndicatorBadge(caps);

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
            const matchedOpt = caps.effortOptions.find(o => o.value === caps.reasoningLevel) || caps.effortOptions[0];
            const isEffortActive = matchedOpt.value !== 'off' && matchedOpt.value !== 'none';

            const flyoutRow = document.createElement('div');
            flyoutRow.className = `flyout-trigger-row ${this.isReasoningFlyoutOpen ? 'active' : ''}`;
            flyoutRow.setAttribute('role', 'button');
            flyoutRow.setAttribute('tabindex', '0');

            const leftContent = document.createElement('div');
            leftContent.className = 'toggle-label';
            const rowLamp = DOMUtils.createLightbulbIcon(isEffortActive, 'thinking-lamp-icon');
            const rowLabel = document.createElement('span');
            rowLabel.textContent = matchedOpt.label;
            leftContent.appendChild(rowLamp);
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

                        caps.reasoningLevel = opt.value;
                        this.updateIndicatorBadge(caps);

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

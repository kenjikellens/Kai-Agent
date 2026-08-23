/**
 * ModeManager manages context mode state ('chat', 'ask', 'agent', 'planning'),
 * input placeholders, mode badges, and UI item selections.
 */
class ModeManager {
    /**
     * Initializes mode manager with DOM references and initial active mode.
     * @param {object|AppState} appStateOrOptions Application state instance or options map.
     * @param {HTMLElement} [messageInput] Input textarea element.
     * @param {HTMLElement} [contextModeSelector] Mode selector container.
     * @param {HTMLElement} [atMentionTriggerBtn] At-mention mode trigger button.
     */
    constructor(appStateOrOptions, messageInput = null, contextModeSelector = null, atMentionTriggerBtn = null) {
        if (appStateOrOptions && appStateOrOptions.appState) {
            this.appState = appStateOrOptions.appState;
            this.messageInput = appStateOrOptions.messageInput || document.getElementById('message-input');
            this.contextModeSelector = appStateOrOptions.contextModeSelector || document.getElementById('context-mode-selector');
            this.atMentionTriggerBtn = appStateOrOptions.atMentionTriggerBtn || document.getElementById('at-mention-trigger-btn');
            this.contextOptionsMenu = appStateOrOptions.contextOptionsMenu || document.getElementById('context-options-menu');
            this.onModeChange = appStateOrOptions.onModeChange || null;
        } else {
            this.appState = appStateOrOptions;
            this.messageInput = messageInput || document.getElementById('message-input');
            this.contextModeSelector = contextModeSelector || document.getElementById('context-mode-selector');
            this.atMentionTriggerBtn = atMentionTriggerBtn || document.getElementById('at-mention-trigger-btn');
            this.contextOptionsMenu = document.getElementById('context-options-menu');
            this.onModeChange = null;
        }

        this.modeLabels = { chat: 'Chat', ask: 'Ask', agent: 'Agent', planning: 'Plan' };
        this.modeIcons = {
            chat: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>',
            ask: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>',
            agent: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>',
            planning: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>'
        };

        this.initEventListeners();
    }

    /**
     * Updates active mode, persists to localStorage, and updates UI placeholders and icons.
     * @param {'chat'|'ask'|'agent'|'planning'} mode Target mode.
     */
    setActiveMode(mode) {
        if (!this.appState.hasActiveWorkspace) {
            mode = 'chat';
        } else if (mode === 'chat') {
            mode = 'ask';
        }
        this.appState.activeMode = mode;
        this.appState.isPlanningModeEnabled = (mode === 'planning');
        try {
            localStorage.setItem('kai.activeMode', mode);
        } catch (e) {}

        if (this.contextModeSelector) {
            this.contextModeSelector.querySelectorAll('.context-mode-item').forEach(btn => {
                const itemMode = btn.dataset.mode;
                btn.classList.toggle('active', itemMode === mode || (itemMode === 'ask' && mode === 'ask'));
            });
        }

        if (this.atMentionTriggerBtn) {
            this.atMentionTriggerBtn.dataset.mode = mode;
            const iconEl = document.getElementById('active-mode-icon');
            if (iconEl && this.modeIcons[mode]) {
                iconEl.innerHTML = this.modeIcons[mode];
            }
            const textEl = document.getElementById('active-mode-text');
            if (textEl) {
                textEl.textContent = this.modeLabels[mode] || 'Ask';
            }
            this.atMentionTriggerBtn.title = `Mode: ${this.modeLabels[mode] || 'Ask'} (@)`;
            this.atMentionTriggerBtn.classList.toggle('active-mode', mode !== 'chat' && mode !== 'ask');
        }

        this.updatePlaceholder();

        if (this.onModeChange) {
            this.onModeChange(mode);
        }
    }

    /**
     * Dynamically updates the message textarea placeholder based on the active mode and current i18n dictionary.
     * @param {object} [customTranslations] Optional translation dictionary override.
     */
    updatePlaceholder(customTranslations = null) {
        if (!this.messageInput) return;
        const i18n = customTranslations || window.KAI_I18N || {};
        const mode = this.appState.activeMode || 'chat';

        if (mode === 'chat') {
            this.messageInput.placeholder = i18n.placeholderChat || 'Ask Kai anything, calculate, convert, or search the web...';
        } else if (mode === 'ask') {
            this.messageInput.placeholder = i18n.placeholderAsk || 'Ask questions about your workspace codebase...';
        } else if (mode === 'agent') {
            this.messageInput.placeholder = i18n.placeholderAgent || 'Ask Kai to edit code, execute tasks, or run commands...';
        } else if (mode === 'planning') {
            this.messageInput.placeholder = i18n.placeholderPlanning || 'Describe a project task to generate an implementation plan...';
        }
    }

    /**
     * Updates UI mode buttons based on whether an active workspace folder is open.
     * @param {boolean} hasWorkspace Whether a workspace is currently active.
     */
    setWorkspaceState(hasWorkspace) {
        const modeOptAgent = document.getElementById('mode-opt-agent');
        const modeOptPlanning = document.getElementById('mode-opt-planning');
        const modeContainer = document.getElementById('context-options-dropdown-container');

        if (modeContainer) {
            modeContainer.classList.toggle('hidden', !hasWorkspace);
        }

        if (modeOptAgent) {
            modeOptAgent.disabled = !hasWorkspace;
            modeOptAgent.classList.toggle('disabled', !hasWorkspace);
            modeOptAgent.title = hasWorkspace ? 'Autonomous code edits and terminal execution' : 'Select a workspace folder first to use Agent Mode';
        }
        if (modeOptPlanning) {
            modeOptPlanning.disabled = !hasWorkspace;
            modeOptPlanning.classList.toggle('disabled', !hasWorkspace);
            modeOptPlanning.title = hasWorkspace ? 'Structured plan-first protocol before code edits' : 'Select a workspace folder first to use Plan Mode';
        }

        if (!hasWorkspace) {
            this.setActiveMode('chat');
        } else if (this.appState.activeMode === 'chat') {
            this.setActiveMode('ask');
        }
    }

    /**
     * Registers context mode selector click events.
     * @private
     */
    initEventListeners() {
        if (this.contextModeSelector) {
            this.contextModeSelector.addEventListener('click', (e) => {
                const item = e.target.closest('.context-mode-item');
                if (!item || !item.dataset.mode) return;

                const targetMode = item.dataset.mode;
                if (item.disabled || item.classList.contains('disabled') || (!this.appState.hasActiveWorkspace && targetMode !== 'chat')) {
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }

                this.setActiveMode(targetMode);
                const menu = this.contextOptionsMenu || document.getElementById('context-options-menu');
                if (menu) menu.classList.add('hidden');
            });
        }

        if (this.atMentionTriggerBtn && this.contextOptionsMenu) {
            this.atMentionTriggerBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.appState && !this.appState.hasActiveWorkspace) {
                    this.contextOptionsMenu.classList.add('hidden');
                    return;
                }
                this.contextOptionsMenu.classList.toggle('hidden');
            });

            document.addEventListener('click', (e) => {
                if (!this.contextOptionsMenu.contains(e.target) && !this.atMentionTriggerBtn.contains(e.target)) {
                    this.contextOptionsMenu.classList.add('hidden');
                }
            });
        }
    }
}

/**
 * Client-side entry script for Kai Agent Chat Webview (Standalone App).
 * Instantiates and orchestrates ES6 OOP modules with collapsible Left Sidebar.
 */
(function () {
    // Global error diagnostic listener
    window.addEventListener('error', (event) => {
        console.error('[KAI Desktop Global Error]:', event.error || event.message, event);
    });
    window.addEventListener('unhandledrejection', (event) => {
        console.error('[KAI Desktop Unhandled Rejection]:', event.reason);
    });

    // 0. Apply Saved UI Theme and Hydrate Active Locale Dictionary before instantiating controllers
    if (typeof SettingsController !== 'undefined' && typeof SettingsController.applyTheme === 'function') {
        SettingsController.applyTheme();
    }
    try {
        const rawLang = localStorage.getItem('kai.language') || window.KAI_LANG || 'auto';
        const savedLang = rawLang === 'zh-tw' ? 'zh_tw' : rawLang;
        const allLocales = window.KAI_ALL_LOCALES || {};
        let initDict = allLocales[savedLang];
        if (!initDict && savedLang === 'auto') {
            const sys = (navigator.language || 'en').slice(0, 2).toLowerCase();
            initDict = allLocales[sys] || allLocales.en;
        }
        if (!initDict && allLocales) {
            initDict = allLocales.en;
        }
        if (initDict) {
            window.KAI_I18N = initDict;
        }
    } catch (e) {}

    // 1. Core State & Data Repositories
    const appState = new AppState();
    window.appState = appState;
    const formatter = new MarkdownFormatter();
    const mermaidRenderer = new MermaidRenderer();
    window.mermaidRenderer = mermaidRenderer;
    const ipcBridge = new WebviewIPCBridge();
    const fileSummaryWidget = new FileSummaryWidget();
    const sessionRepository = new SessionRepository(ipcBridge);

    // 2. Feature & Settings Controllers
    const settingsController = new SettingsController(ipcBridge);
    const fileUploadController = new FileUploadController(ipcBridge, appState);
    const helpModalController = new HelpModalController(ipcBridge);

    const modelDropdownController = new ModelDropdownController(formatter, (selectedModel) => {
        appState.selectedModelValue = selectedModel;
        saveCurrentChat();
    }, ipcBridge);

    const chatUIController = new ChatUIController(
        formatter,
        ipcBridge,
        fileSummaryWidget,
        settingsController,
        helpModalController,
        modelDropdownController,
        mermaidRenderer
    );
    window.chatUIController = chatUIController;

    const historyManager = new HistoryManager(
        ipcBridge,
        (viewName) => {
            if (chatUIController && typeof chatUIController.showView === 'function') {
                chatUIController.showView(viewName);
            }
        },
        (chatId) => { openSessionById(chatId); }
    );

    const workspacesController = new WorkspacesController({
        ipcBridge: ipcBridge,
        appState: appState,
        sessionRepository: sessionRepository,
        historyManager: historyManager,
        onOpenChat: (chatId) => { openSessionById(chatId); },
        onNewChatInWorkspace: (workspacePath) => { createNewChatInWorkspace(workspacePath); },
        onSelectWorkspace: (workspacePath) => {
            updateWorkspaceUi(workspacePath);
            saveCurrentChat();
            if (workspacesController.isOpen()) {
                workspacesController.render();
            }
        },
        onClose: () => {
            const activeId = appState.currentChatId || localStorage.getItem('kai.activeChatId');
            window.location.hash = activeId ? `session-${activeId}` : '';
        }
    });
    chatUIController.workspacesController = workspacesController;

    // 3. Mode Manager (Desktop App: ask, agent, planning)
    const modeManager = new ModeManager({
        appState: appState,
        contextModeSelector: document.getElementById('context-mode-selector'),
        atMentionTriggerBtn: document.getElementById('at-mention-trigger-btn'),
        contextOptionsMenu: document.getElementById('context-options-menu'),
        messageInput: document.getElementById('message-input'),
        onModeChange: (newMode) => {
            saveCurrentChat();
        }
    });
    modeManager.setWorkspaceState(appState.hasActiveWorkspace);

    // 4. Prompt Submission Orchestrator
    const promptOrchestrator = new PromptSubmissionOrchestrator({
        appState: appState,
        chatUIController: chatUIController,
        modelDropdownController: modelDropdownController,
        fileUploadController: fileUploadController,
        settingsController: settingsController,
        ipcBridge: ipcBridge,
        sessionRepository: sessionRepository
    });

    // Wire Command Approval Request dialog
    ipcBridge.onCommandApprovalRequest = async (command) => {
        return await chatUIController.requestCommandApproval(command);
    };

    // Wire Retry Callback (Rolls back filesystem changes and retries from clicked assistant message)
    chatUIController.onRetry = async (assistantMsgElement) => {
        if (appState.isWaitingForResponse) return;
        if (appState.currentChatId) {
            await ipcBridge.rollbackTurnChanges(appState.currentChatId);
        }
        await promptOrchestrator.retryLastTurn(assistantMsgElement);
    };

    // Wire Edit Prompt Callback (Rolls back filesystem changes and executes edited prompt)
    chatUIController.onEditPrompt = async (userMessageRowElement, editedText) => {
        if (appState.isWaitingForResponse) return;
        if (!editedText || !editedText.trim()) return;
        if (appState.currentChatId) {
            await ipcBridge.rollbackTurnChanges(appState.currentChatId);
        }
        await promptOrchestrator.editPrompt(userMessageRowElement, editedText);
    };

    // DOM Element References for Input Orchestration
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const newChatBtn = document.getElementById('new-chat-btn');
    const sidebar = document.getElementById('app-sidebar');
    const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
    const workspaceBadgeBtn = document.getElementById('workspace-badge-btn');
    const topWorkspaceBtn = document.getElementById('top-workspace-btn');

    // Sidebar Collapse / Expand Toggle
    if (sidebar && sidebarToggleBtn) {
        const isCollapsed = localStorage.getItem('kai.sidebarCollapsed') === 'true';
        if (isCollapsed) {
            sidebar.classList.add('collapsed');
        }
        sidebarToggleBtn.addEventListener('click', () => {
            const collapsed = sidebar.classList.toggle('collapsed');
            localStorage.setItem('kai.sidebarCollapsed', collapsed ? 'true' : 'false');
        });
    }

    if (topWorkspaceBtn) {
        topWorkspaceBtn.addEventListener('click', () => {
            ipcBridge.browseWorkspaceFolder();
        });
    }

    if (workspaceBadgeBtn) {
        workspaceBadgeBtn.addEventListener('click', () => {
            ipcBridge.browseWorkspaceFolder();
        });
    }

    /**
     * Updates all workspace UI elements across sidebar, top bar, mode selectors, and known-workspace history.
     * Mutates `appState.workspacePath`, `localStorage`, and `#workspaces-container` when open.
     * @param {string} workspacePath Absolute path to workspace folder or empty string.
     */
    function updateWorkspaceUi(workspacePath) {
        const hasWs = Boolean(workspacePath);
        appState.workspacePath = workspacePath || '';
        appState.hasActiveWorkspace = hasWs;

        const wsNameEl = document.getElementById('active-workspace-name');
        if (wsNameEl) {
            wsNameEl.textContent = hasWs ? workspacePath.split(/[\\/]/).pop() : 'Workspace...';
        }
        if (workspaceBadgeBtn) {
            workspaceBadgeBtn.title = hasWs ? `Active Workspace: ${workspacePath} (Click to change)` : 'Select Workspace Folder';
        }

        const topWsText = document.getElementById('top-workspace-path');
        if (topWsText) {
            const i18n = window.KAI_I18N || {};
            topWsText.textContent = hasWs ? workspacePath : (i18n.noWorkspaceSelected || 'No Workspace Selected');
        }
        if (topWorkspaceBtn) {
            topWorkspaceBtn.title = hasWs ? `Active Workspace: ${workspacePath} (Click to change)` : 'Click to Select Workspace Folder';
        }

        modeManager.setWorkspaceState(hasWs);
        if (hasWs && workspacesController) {
            workspacesController.recordKnownWorkspace(appState.workspacePath);
        } else if (!hasWs) {
            try {
                localStorage.removeItem('kai.workspacePath');
            } catch (e) {}
            if (workspacesController && workspacesController.isOpen()) {
                workspacesController.render();
            }
        }
        if (ipcBridge && typeof ipcBridge.setWorkspace === 'function') {
            ipcBridge.setWorkspace(appState.workspacePath);
        }
    }

    /**
     * Resets active session and UI for a brand new chat, optionally binding an initial workspace folder.
     * Updates URL hash, clears stream state, shows `#chat-view`, and refreshes sidebar history.
     * @param {string} [newSessionId] Optional explicit session ID to initialize.
     * @param {string} [initialWorkspace] Optional workspace directory path to pre-bind.
     */
    function createNewChat(newSessionId, initialWorkspace = '') {
        if (appState.isWaitingForResponse) {
            ipcBridge.abort();
        }
        appState.resetChat();
        if (newSessionId) {
            appState.currentChatId = newSessionId;
        }
        localStorage.setItem('kai.activeChatId', appState.currentChatId);
        window.location.hash = `session-${appState.currentChatId}`;
        updateWorkspaceUi(initialWorkspace || '');
        historyManager.setActiveChatId(appState.currentChatId);
        chatUIController.clearChatContainer();
        chatUIController.resetAssistantStream();
        chatUIController.setUiLoading(false, appState);
        chatUIController.showView('chat');
        if (helpModalController && typeof helpModalController.close === 'function') {
            helpModalController.close(false);
        }
        ipcBridge.loadChatHistory();
        if (messageInput) {
            messageInput.focus();
        }
    }

    /**
     * Saves any active conversation and starts a new chat session bound directly to `workspacePath`.
     * Transitions the main pane to `#chat-view` with the selected workspace folder active.
     * @param {string} workspacePath Workspace directory path to pre-select for the new session.
     */
    function createNewChatInWorkspace(workspacePath) {
        if ((appState.messages && appState.messages.length > 0) || (appState.uiEvents && appState.uiEvents.length > 0)) {
            saveCurrentChat();
        }
        const newId = appState.generateChatId();
        createNewChat(newId, workspacePath || '');
    }

    // New Chat Click Handlers
    const handleNewChatClick = () => {
        if ((appState.messages && appState.messages.length > 0) || (appState.uiEvents && appState.uiEvents.length > 0)) {
            saveCurrentChat();
        }
        const newId = appState.generateChatId();
        createNewChat(newId);
    };

    if (newChatBtn) {
        newChatBtn.addEventListener('click', handleNewChatClick);
    }

    // When user deletes the currently open chat from sidebar, reset to a clean new chat
    historyManager.onDeleteActiveChat = (deletedChatId) => {
        if (appState.currentChatId === deletedChatId) {
            const newId = appState.generateChatId();
            createNewChat(newId);
        }
    };
    historyManager.onActiveChatDeleted = () => {
        const newId = appState.generateChatId();
        createNewChat(newId);
    };

    /**
     * Auto-resizes the input textarea as user types, up to MAX_HEIGHT.
     */
    function autoResizeInput() {
        if (!messageInput) return;
        messageInput.style.height = 'auto';
        const MAX_HEIGHT = 200;
        const newHeight = Math.min(messageInput.scrollHeight, MAX_HEIGHT);
        messageInput.style.height = `${newHeight}px`;
        messageInput.style.overflowY = messageInput.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
    }

    /**
     * Persists current active chat session to storage via SessionRepository.
     */
    function saveCurrentChat() {
        if ((!appState.messages || appState.messages.length === 0) && (!appState.uiEvents || appState.uiEvents.length === 0)) {
            return;
        }
        const details = modelDropdownController.getSelectedModelDetails();
        const payload = appState.toChatPayload(details.thinking);
        sessionRepository.saveSession(payload);
        historyManager.setActiveChatId(appState.currentChatId);
    }
    window.saveCurrentChat = saveCurrentChat;
    chatUIController.saveCurrentChat = saveCurrentChat;
    chatUIController.appState = appState;

    /**
     * Sends user prompt input to extension host or aborts ongoing generation.
     */
    function sendMessage() {
        if (appState.isWaitingForResponse) {
            ipcBridge.abort();
            chatUIController.setUiLoading(false, appState);
            return;
        }

        const userPrompt = messageInput.value.trim();
        if (!userPrompt && !appState.hasStagedAttachments()) {
            return;
        }

        messageInput.value = '';
        autoResizeInput();

        // Clear inline selected code context after sending
        appState.selectedCodeContext = '';

        promptOrchestrator.submitPrompt(userPrompt);
    }

    /**
     * Opens and displays a specific chat session by its unique ID.
     * Checks localStorage cache first and falls back to IPC loadChat.
     * @param {string} targetSessionId The target chat session ID to open.
     */
    function openSessionById(targetSessionId) {
        if (!targetSessionId) return;

        if (helpModalController && typeof helpModalController.close === 'function') {
            helpModalController.close(false);
        }

        // If clicking the currently active chat session, simply reveal the chat view
        if (targetSessionId === appState.currentChatId) {
            chatUIController.showView('chat');
            historyManager.setActiveChatId(targetSessionId);
            return;
        }

        if (appState.messages.length > 0 && appState.currentChatId) {
            saveCurrentChat();
        }

        const cached = sessionRepository.getSession(targetSessionId);
        if (cached) {
            loadChatSession(cached);
            window.location.hash = `session-${targetSessionId}`;
            return;
        }

        const isExistingChat = historyManager.cachedChats && historyManager.cachedChats.some(c => c.id === targetSessionId);
        if (isExistingChat) {
            window.location.hash = `session-${targetSessionId}`;
            ipcBridge.loadChat(targetSessionId);
        } else {
            createNewChat(targetSessionId);
        }
    }

    /**
     * Loads a saved chat session into state and updates UI views.
     * @param {object} chat Saved chat session object.
     */
    function loadChatSession(chat) {
        if (!chat) return;
        chatUIController.resetAssistantStream();
        appState.loadSession(chat);

        updateWorkspaceUi(appState.workspacePath || '');
        modeManager.setActiveMode(appState.activeMode || 'chat');
        chatUIController.renderUiEvents(appState.uiEvents, appState.messages);
        modelDropdownController.setSelectedModel(appState.selectedModelValue);
        historyManager.setActiveChatId(chat.id);

        chatUIController.setUiLoading(false, appState);
        chatUIController.showView('chat');
        ipcBridge.checkConnection();
    }

    // Bind Primary UI Buttons & Input Handlers
    if (sendBtn) {
        sendBtn.addEventListener('click', sendMessage);
    }

    // Handle Proceed with Plan clicks inside implementation plan cards
    document.addEventListener('click', (e) => {
        const proceedBtn = e.target.closest('.plan-proceed-btn');
        if (proceedBtn && !proceedBtn.disabled) {
            proceedBtn.disabled = true;
            proceedBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"></path></svg><span>Plan Approved</span>`;
            modeManager.setActiveMode('agent');

            if (messageInput) {
                messageInput.value = 'Please proceed with executing the approved implementation plan.';
                sendMessage();
            }
        }
    });

    if (messageInput) {
        messageInput.addEventListener('input', autoResizeInput);
        messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
    }

    /**
     * Globally translates all DOM text, titles, placeholders, and controller widgets.
     * @param {object} translations Translation key-value map.
     */
    window.applyAllTranslations = function (translations) {
        if (!translations) return;
        window.KAI_I18N = translations;

        document.querySelectorAll('[data-i18n]').forEach(el => {
            if (el.id === 'top-workspace-path' && appState.hasActiveWorkspace) {
                return;
            }
            const key = el.getAttribute('data-i18n');
            if (translations[key]) {
                el.textContent = translations[key];
            }
        });

        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            const key = el.getAttribute('data-i18n-title');
            if (translations[key]) {
                el.setAttribute('title', translations[key]);
            }
        });

        const msgInput = document.getElementById('message-input');
        if (msgInput) {
            if (modeManager && typeof modeManager.updatePlaceholder === 'function') {
                modeManager.updatePlaceholder(translations);
            } else if (translations.messagePlaceholder) {
                msgInput.placeholder = translations.messagePlaceholder;
            }
        }

        const topWsText = document.getElementById('top-workspace-path');
        if (topWsText && !appState.hasActiveWorkspace && translations.noWorkspaceSelected) {
            topWsText.textContent = translations.noWorkspaceSelected;
        }

        const thinkingLabel = document.getElementById('thinking-toggle-label');
        if (thinkingLabel && translations.thinkingToggle) {
            thinkingLabel.textContent = translations.thinkingToggle;
        }

        const heroTitle = document.querySelector('.welcome-hero-title');
        if (heroTitle && translations.welcomeTitle) {
            heroTitle.textContent = translations.welcomeTitle;
        }
        const heroSubtitle = document.querySelector('.welcome-hero-subtitle');
        if (heroSubtitle && translations.welcomeSubtitleApp) {
            heroSubtitle.textContent = translations.welcomeSubtitleApp;
        }
        const emptyHistory = document.querySelector('#history-list .history-empty-state');
        if (emptyHistory && translations.noPreviousChats) {
            emptyHistory.textContent = translations.noPreviousChats;
        }

        if (chatUIController && (!appState.messages || appState.messages.length === 0) && typeof chatUIController.renderWelcomeHero === 'function') {
            chatUIController.renderWelcomeHero();
        }

        if (settingsController && typeof settingsController.applyTranslations === 'function') {
            settingsController.applyTranslations(translations);
        }
        if (workspacesController && workspacesController.isOpen()) {
            workspacesController.render();
        }
    };

    // Apply startup translation immediately across static DOM nodes
    if (window.KAI_I18N && Object.keys(window.KAI_I18N).length > 0) {
        window.applyAllTranslations(window.KAI_I18N);
    }

    // Register Incoming IPC Message Handlers
    ipcBridge.on('initialState', (message) => {
        if (message.isRunning) {
            chatUIController.setUiLoading(true, appState);
            if (message.messages && message.messages.length > 0) {
                appState.messages = message.messages;
                chatUIController.clearChatContainer();
                appState.messages.forEach(msg => {
                    if (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'file-summary') {
                        chatUIController.appendMessage(msg.role, msg.content);
                    }
                });
            }
            if (message.streamingText) {
                chatUIController.currentAssistantText = message.streamingText;
                chatUIController.appendMessage('assistant', message.streamingText);
            }
        }
    });

    ipcBridge.on('connectionStatus', (message) => {
        if (message.svgs) {
            window.KAI_SVGS = { ...(window.KAI_SVGS || {}), ...message.svgs };
        }
        if (message.translations) {
            window.applyAllTranslations(message.translations);
        }

        if (message.isFolderPicked && message.workspacePath) {
            updateWorkspaceUi(message.workspacePath);
            saveCurrentChat();
        } else if (message.workspacePath !== undefined) {
            updateWorkspaceUi(message.workspacePath);
        } else {
            updateWorkspaceUi(appState.workspacePath || '');
        }

        settingsController.updateConnectionStatus(message);
        modelDropdownController.updateConnectionStatus(message);
    });

    ipcBridge.on('providerTestResult', (message) => {
        settingsController.handleHostMessage(message);
    });

    ipcBridge.on('settings', (message) => {
        settingsController.handleHostMessage(message);
    });

    ipcBridge.on('addCodeSelection', (message) => {
        appState.selectedCodeContext = message.text;
        if (messageInput) {
            messageInput.focus();
        }
    });

    const handleAgentProgress = (message) => {
        const payload = message.event || message;
        if (payload.type && !payload.progressType) {
            payload.progressType = payload.type;
        }
        chatUIController.handleAgentProgress(payload, appState);
        const session = appState.toChatPayload(modelDropdownController.getSelectedModelDetails().thinking);
        if (payload.progressType === 'tool_start' || payload.progressType === 'tool_end') {
            // Tool cards are meaningful history records; commit them immediately
            // instead of relying on the token-save debounce.
            sessionRepository.saveSession(session);
        } else {
            sessionRepository.markDirty(session);
        }
    };

    ipcBridge.on('agentProgress', handleAgentProgress);
    ipcBridge.on('toolActivity', handleAgentProgress);

    ipcBridge.on('chatTitleUpdated', (message) => {
        if (message && message.title) {
            appState.currentChatTitle = message.title;
        }
    });

    ipcBridge.on('typing', () => {
        chatUIController.setUiLoading(true, appState);
        chatUIController.resetAssistantStream();
    });

    /**
     * Handles final assistant completion replies, updates UI bubble and persists chat history.
     * @param {object} message Reply payload from host.
     */
    const handleReply = (message) => {
        chatUIController.setUiLoading(false, appState);

        let forceThinkingCollapsed = null;
        let forcePlanExpanded = null;
        if (chatUIController.currentAssistantMsgElement) {
            const existingThinking = chatUIController.currentAssistantMsgElement.querySelector('.thinking-block');
            if (existingThinking) {
                forceThinkingCollapsed = existingThinking.classList.contains('collapsed');
            }
            const existingPlan = chatUIController.currentAssistantMsgElement.querySelector('.kai-plan-card');
            if (existingPlan) {
                forcePlanExpanded = existingPlan.classList.contains('expanded');
            }
        }

        const replyContent = message.content !== undefined ? message.content : (message.text || '');
        const isThinkingChecked = (settingsController && settingsController.showThinkingToggle)
            ? settingsController.showThinkingToggle.checked
            : (localStorage.getItem('kai.showThinking') !== 'false');
        const formatted = formatter.formatMarkdown(replyContent, forceThinkingCollapsed, isThinkingChecked, forcePlanExpanded);

        const currentMode = message.mode || appState.activeMode || 'chat';
        const modelDetails = modelDropdownController.getSelectedModelDetails();
        const meta = {
            model: modelDetails.displayName || modelDetails.model || appState.selectedModelValue,
            mode: currentMode,
            thinking: modelDetails.thinking,
            isThinkingCapable: modelDetails.isThinkingCapable,
            reasoningEffort: modelDetails.reasoningEffort,
            tokensPerSecond: message.tokensPerSecond || null
        };

        if (chatUIController.currentAssistantMsgElement && chatUIController.chatContainer && chatUIController.chatContainer.contains(chatUIController.currentAssistantMsgElement)) {
            if (formatted.trim()) {
                chatUIController.currentAssistantMsgElement.dataset.rawContent = replyContent;
                chatUIController.currentAssistantMsgElement.dataset.mode = currentMode;
                const existingActions = chatUIController.currentAssistantMsgElement.querySelector('.message-actions');
                if (existingActions) {
                    existingActions.remove();
                }
                chatUIController.currentAssistantMsgElement.appendChild(chatUIController.createAssistantActionBar(currentMode, meta));
            } else {
                chatUIController.currentAssistantMsgElement.remove();
            }
        } else if (formatted.trim()) {
            chatUIController.appendMessage('assistant', replyContent, currentMode, meta);
        }

        if (message.fullHistory && Array.isArray(message.fullHistory)) {
            appState.messages = message.fullHistory;
        } else {
            const lastMsg = appState.messages[appState.messages.length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
                lastMsg.content = replyContent;
            } else {
                appState.addMessage({ role: 'assistant', content: replyContent });
            }
        }

        appState.finalizeAssistantUiEvent(replyContent, currentMode, meta);

        if (message.modifiedFiles && message.modifiedFiles.length > 0) {
            appState.addUiEvent({ type: 'file-summary', files: message.modifiedFiles });
            chatUIController.appendMessage('file-summary', JSON.stringify(message.modifiedFiles));
        }

        if (mermaidRenderer && chatUIController.chatContainer) {
            mermaidRenderer.renderDiagrams(chatUIController.chatContainer);
        }

        saveCurrentChat();
        chatUIController.resetAssistantStream();
    };

    
        ipcBridge.on('ask_user_request', (message) => {
            chatUIController.renderAskUserDock(message, (answer) => {
                ipcBridge.postMessage({
                    type: 'ask_user_response',
                    requestId: message.requestId,
                    answer: answer
                });
            });
        });

        ipcBridge.on('command_approval_request', async (message) => {
            const allowed = await chatUIController.requestCommandApproval(message.command || '');
            ipcBridge.postMessage({
                type: 'command_approval_response',
                requestId: message.requestId,
                allowed: allowed
            });
        });

        ipcBridge.on('reply', handleReply);
    ipcBridge.on('replyComplete', handleReply);

    ipcBridge.on('replyError', (message) => {
        chatUIController.setUiLoading(false, appState);
        chatUIController.removeActivityStatus();
        const errText = `Error: ${message.message || message.error || 'Request failed'}`;
        appState.addUiEvent({ type: 'system', content: errText });
        chatUIController.appendMessage('system', errText);
        saveCurrentChat();
        chatUIController.resetAssistantStream();
    });

    ipcBridge.on('loadChat', (message) => {
        if (message && message.chat) {
            // Cache host-loaded records as complete sessions; this is distinct
            // from the metadata-only chatHistory event.
            sessionRepository.saveSession(message.chat);
            loadChatSession(message.chat);
        }
    });

    ipcBridge.on('chatHistory', (message) => {
        if (message && Array.isArray(message.chats)) {
            try {
                // The host deliberately sends sidebar metadata here. Store it
                // independently so it can never overwrite full chat payloads.
                localStorage.setItem('kai.savedChatsSummary', JSON.stringify(message.chats));
            } catch (e) { }
        }
        historyManager.renderHistoryList((message && message.chats) || [], appState.isWaitingForResponse, true);
        if (workspacesController && workspacesController.isOpen()) {
            workspacesController.render();
        }
    });

    // Request initial chat history load after listeners are registered
    ipcBridge.loadChatHistory();

    // Start periodic server connection health checks
    ipcBridge.checkConnection();
    setInterval(() => ipcBridge.checkConnection(), 15000);

    // 5. Hash Router Initialization
    const hashRouter = new HashRouter({
        onSettingsRoute: () => {
            chatUIController.showView('settings');
            if (helpModalController && typeof helpModalController.close === 'function') {
                helpModalController.close(false);
            }
        },
        onWorkspacesRoute: () => {
            chatUIController.showView('workspaces');
            if (helpModalController && typeof helpModalController.close === 'function') {
                helpModalController.close(false);
            }
        },
        onHelpRoute: () => {
            if (helpModalController && typeof helpModalController.open === 'function') {
                helpModalController.open(false);
            }
        },
        onSessionRoute: (sessionId) => {
            if (sessionId && sessionId === appState.currentChatId) {
                chatUIController.showView('chat');
                return;
            }
            openSessionById(sessionId);
        },
        onDefaultRoute: () => {
            const activeId = appState.currentChatId || appState.generateChatId();
            window.location.hash = `session-${activeId}`;
        }
    });

    // Help modal hash sync hooks
    if (helpModalController) {
        helpModalController.onOpen = () => {
            if (window.location.hash !== '#help') {
                window.location.hash = 'help';
            }
        };
        helpModalController.onClose = () => {
            if (window.location.hash === '#help') {
                const activeId = appState.currentChatId || localStorage.getItem('kai.activeChatId');
                window.location.hash = activeId ? `session-${activeId}` : '';
            }
        };
    }

    hashRouter.handleRoute();
})();

/**
 * Client-side entry script for Kai Agent Chat Webview (Standalone App).
 * Instantiates and orchestrates ES6 OOP modules with collapsible Left Sidebar.
 */
(function () {
    // 1. Core State & Data Repositories
    const appState = new AppState();
    const formatter = new MarkdownFormatter();
    const mermaidRenderer = new MermaidRenderer();
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

    const historyManager = new HistoryManager(
        ipcBridge,
        (viewName) => { chatUIController.showView(viewName); },
        (chatId) => { openSessionById(chatId); }
    );

    const chatUIController = new ChatUIController(
        formatter,
        ipcBridge,
        fileSummaryWidget,
        settingsController,
        helpModalController,
        modelDropdownController,
        mermaidRenderer
    );

    // 3. Mode Manager (4 modes in Desktop App: chat, ask, agent, planning)
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
     * Updates all workspace UI elements across sidebar, top bar, and mode selectors.
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
            topWsText.textContent = hasWs ? workspacePath : 'No Workspace Selected';
        }
        if (topWorkspaceBtn) {
            topWorkspaceBtn.title = hasWs ? `Active Workspace: ${workspacePath} (Click to change)` : 'Click to Select Workspace Folder';
        }

        modeManager.setWorkspaceState(hasWs);
    }

    /**
     * Resets active session and UI for a brand new chat.
     * @param {string} [newSessionId] Optional explicit session ID to initialize.
     */
    function createNewChat(newSessionId) {
        if (appState.isWaitingForResponse) {
            ipcBridge.abort();
        }
        appState.resetChat();
        if (newSessionId) {
            appState.currentChatId = newSessionId;
        }
        localStorage.setItem('kai.activeChatId', appState.currentChatId);
        updateWorkspaceUi('');
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

    // New Chat Click Handlers
    const handleNewChatClick = () => {
        if (appState.messages.length > 0) {
            saveCurrentChat();
        }
        const newId = appState.generateChatId();
        window.location.hash = `session-${newId}`;
    };

    if (newChatBtn) {
        newChatBtn.addEventListener('click', handleNewChatClick);
    }

    // When user deletes the currently open chat from sidebar, reset to a clean new chat
    historyManager.onDeleteActiveChat = (deletedChatId) => {
        if (appState.currentChatId === deletedChatId) {
            const newId = appState.generateChatId();
            window.location.hash = `session-${newId}`;
            createNewChat(newId);
        }
    };
    historyManager.onActiveChatDeleted = () => {
        const newId = appState.generateChatId();
        window.location.hash = `session-${newId}`;
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
        if (!appState.messages || appState.messages.length === 0) {
            return;
        }
        const details = modelDropdownController.getSelectedModelDetails();
        const payload = appState.toChatPayload(details.thinking);
        sessionRepository.saveSession(payload);
        historyManager.setActiveChatId(appState.currentChatId);
    }

    /**
     * Sends user prompt input to extension host or aborts ongoing generation.
     */
    function sendMessage() {
        if (appState.isWaitingForResponse) {
            ipcBridge.abort();
            chatUIController.setUiLoading(false, appState);
            chatUIController.resetAssistantStream();
            chatUIController.appendMessage('system', 'Generation stopped.');
            return;
        }

        const text = messageInput ? messageInput.value.trim() : '';
        if (!text && !appState.selectedCodeContext) {
            return;
        }

        let userPrompt = '';
        if (appState.selectedCodeContext) {
            userPrompt += `Here is the selected code context from the editor:\n\`\`\`\n${appState.selectedCodeContext}\n\`\`\`\n\n`;
        }
        userPrompt += text;

        if (messageInput) {
            messageInput.value = '';
            autoResizeInput();
        }
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

        if (appState.messages.length > 0 && appState.currentChatId && appState.currentChatId !== targetSessionId) {
            saveCurrentChat();
        }

        const cached = sessionRepository.getSession(targetSessionId);
        if (cached) {
            loadChatSession(cached);
            return;
        }

        const isExistingChat = historyManager.cachedChats && historyManager.cachedChats.some(c => c.id === targetSessionId);
        if (isExistingChat) {
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
    window.applyAllTranslations = function(translations) {
        if (!translations) return;
        window.KAI_I18N = translations;

        document.querySelectorAll('[data-i18n]').forEach(el => {
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
        if (msgInput && translations.messagePlaceholder) {
            msgInput.placeholder = translations.messagePlaceholder;
        }

        const thinkingLabel = document.getElementById('thinking-toggle-label');
        if (thinkingLabel && translations.thinkingToggle) {
            thinkingLabel.textContent = translations.thinkingToggle;
        }

        if (settingsController && typeof settingsController.applyTranslations === 'function') {
            settingsController.applyTranslations(translations);
        }
    };

    // Apply startup translation immediately
    try {
        const savedLang = localStorage.getItem('kai.language') || window.KAI_LANG || 'auto';
        const allLocales = window.KAI_ALL_LOCALES || {};
        let startupDict = allLocales[savedLang];
        if (!startupDict && savedLang === 'auto') {
            const sys = (navigator.language || 'en').slice(0, 2).toLowerCase();
            startupDict = allLocales[sys] || allLocales.en;
        }
        if (!startupDict && allLocales) {
            startupDict = allLocales.en;
        }
        if (startupDict) {
            window.applyAllTranslations(startupDict);
        }
    } catch (e) {}

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
        if (message.translations) {
            window.applyAllTranslations(message.translations);
        }
        
        if (message.isFolderPicked && message.workspacePath) {
            updateWorkspaceUi(message.workspacePath);
            saveCurrentChat();
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
        sessionRepository.markDirty(appState.toChatPayload(modelDropdownController.getSelectedModelDetails().thinking));
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
        appState.finalizeAssistantUiEvent();

        let forceThinkingCollapsed = null;
        let forcePlanExpanded = null;
        if (chatUIController.currentAssistantMsgElement) {
            const existingThinking = chatUIController.currentAssistantMsgElement.querySelector('.thinking-content');
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
            reasoningEffort: modelDetails.reasoningEffort
        };

        if (chatUIController.currentAssistantMsgElement) {
            if (formatted.trim()) {
                chatUIController.currentAssistantMsgElement.dataset.rawContent = replyContent;
                chatUIController.currentAssistantMsgElement.dataset.mode = currentMode;
                chatUIController.currentAssistantMsgElement.querySelector('.message-content').innerHTML = formatted;
                if (!chatUIController.currentAssistantMsgElement.querySelector('.message-actions')) {
                    chatUIController.currentAssistantMsgElement.appendChild(chatUIController.createAssistantActionBar(currentMode, meta));
                }
            } else {
                chatUIController.currentAssistantMsgElement.remove();
            }
        } else if (formatted.trim()) {
            chatUIController.appendMessage('assistant', replyContent, currentMode, meta);
        }

        if (message.fullHistory) {
            appState.messages = message.fullHistory;
        } else {
            appState.addMessage({ role: 'assistant', content: replyContent });
        }

        const lastEvt = appState.uiEvents[appState.uiEvents.length - 1];
        if (replyContent && (!lastEvt || lastEvt.type !== 'assistant')) {
            appState.addUiEvent({ 
                type: 'assistant', 
                content: replyContent, 
                mode: currentMode,
                model: meta.model,
                thinking: meta.thinking,
                isThinkingCapable: meta.isThinkingCapable,
                reasoningEffort: meta.reasoningEffort
            });
        }

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

    ipcBridge.on('reply', handleReply);
    ipcBridge.on('replyComplete', handleReply);

    ipcBridge.on('replyError', (message) => {
        chatUIController.setUiLoading(false, appState);
        chatUIController.removeActivityStatus();
        chatUIController.appendMessage('system', `Error: ${message.message}`);
        saveCurrentChat();
        chatUIController.resetAssistantStream();
    });

    ipcBridge.on('loadChat', (message) => {
        loadChatSession(message.chat);
    });

    ipcBridge.on('chatHistory', (message) => {
        if (message && message.chats) {
            try {
                localStorage.setItem('kai.savedChats', JSON.stringify(message.chats));
            } catch (e) {}
        }
        historyManager.renderHistoryList(message.chats, appState.isWaitingForResponse);
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
        onHelpRoute: () => {
            if (helpModalController && typeof helpModalController.open === 'function') {
                helpModalController.open(false);
            }
        },
        onSessionRoute: (sessionId) => {
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

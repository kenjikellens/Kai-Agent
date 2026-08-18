/**
 * Client-side entry script for Kai Agent Chat Webview (Standalone App).
 * Instantiates and orchestrates ES6 OOP modules with collapsible Left Sidebar.
 */
(function () {
    // 1. Instantiate Core State and Utility Modules
    const appState = new AppState();
    const formatter = new MarkdownFormatter();
    const ipcBridge = new WebviewIPCBridge();
    const fileSummaryWidget = new FileSummaryWidget();

    // 2. Instantiate Feature and View Controllers
    const settingsController = new SettingsController(ipcBridge);
    const fileUploadController = new FileUploadController(ipcBridge, appState);
    const helpModalController = new HelpModalController(ipcBridge);

    const modelDropdownController = new ModelDropdownController(formatter, (selectedModel) => {
        appState.selectedModelValue = selectedModel;
        saveCurrentChat();
    });

    const historyManager = new HistoryManager(ipcBridge, (viewName) => {
        chatUIController.showView(viewName);
    });

    const chatUIController = new ChatUIController(
        formatter,
        ipcBridge,
        fileSummaryWidget,
        settingsController,
        helpModalController
    );

    // Wire Retry Callback (Retries from clicked assistant message)
    chatUIController.onRetry = (assistantMsgElement) => {
        if (appState.isWaitingForResponse) return;

        // Truncate messages and uiEvents: remove the assistant reply and re-send the prompt
        // Find all message elements in chat container to determine position
        const allMessageNodes = Array.from(chatUIController.chatContainer.children).filter(el => 
            el.classList.contains('user-message-row') || 
            el.classList.contains('message') || 
            el.classList.contains('tool-status-row') ||
            el.classList.contains('file-summary-card')
        );
        const targetIndex = allMessageNodes.indexOf(assistantMsgElement);

        if (targetIndex !== -1) {
            // Remove DOM nodes from targetIndex onward
            const nodesToRemove = allMessageNodes.slice(targetIndex);
            nodesToRemove.forEach(node => node.remove());
        } else {
            assistantMsgElement.remove();
        }

        // If the last message in appState is an assistant message, remove it
        while (appState.messages.length > 0 && appState.messages[appState.messages.length - 1].role !== 'user') {
            appState.messages.pop();
        }
        while (appState.uiEvents.length > 0 && appState.uiEvents[appState.uiEvents.length - 1].type !== 'user') {
            appState.uiEvents.pop();
        }

        // If we have messages left and the last is user, re-send it
        if (appState.messages.length > 0) {
            chatUIController.resetAssistantStream();
            chatUIController.setUiLoading(true, appState);
            saveCurrentChat();

            const modelDetails = modelDropdownController.getSelectedModelDetails();
            const geminiThinkingLevel = modelDetails.reasoningEffort || settingsController.getGeminiThinkingLevel(modelDetails.model);
            const attachedFilesCopy = fileUploadController.getAttachedFiles();

            ipcBridge.sendUserPrompt(
                appState.messages,
                modelDetails.model,
                modelDetails.thinking,
                geminiThinkingLevel,
                appState.activeMode === 'planning',
                attachedFilesCopy,
                appState.currentChatId,
                appState.activeMode,
                appState.workspacePath || ''
            );
        }
    };

    // Wire Edit Prompt Callback (Executes edited prompt from inline chat bubble)
    chatUIController.onEditPrompt = (userMessageRowElement, editedText) => {
        if (appState.isWaitingForResponse) return;
        if (!editedText || !editedText.trim()) return;

        const textToSend = editedText.trim();

        // Find index of this user message among rows
        const allMessageNodes = Array.from(chatUIController.chatContainer.children).filter(el => 
            el.classList.contains('user-message-row') || 
            el.classList.contains('message') || 
            el.classList.contains('tool-status-row') ||
            el.classList.contains('file-summary-card')
        );
        const targetIndex = allMessageNodes.indexOf(userMessageRowElement);

        if (targetIndex !== -1) {
            // Count how many user messages came before this one
            const precedingUserNodes = allMessageNodes.slice(0, targetIndex).filter(el => el.classList.contains('user-message-row'));
            const userIndex = precedingUserNodes.length;

            // Find the userIndex-th user message in appState.messages
            let userMsgCount = 0;
            let msgCutoffIndex = -1;
            for (let i = 0; i < appState.messages.length; i++) {
                if (appState.messages[i].role === 'user') {
                    if (userMsgCount === userIndex) {
                        msgCutoffIndex = i;
                        break;
                    }
                    userMsgCount++;
                }
            }

            if (msgCutoffIndex !== -1) {
                appState.messages = appState.messages.slice(0, msgCutoffIndex);
            }

            // Find matching cutoff in appState.uiEvents
            let uiUserCount = 0;
            let uiCutoffIndex = -1;
            for (let i = 0; i < appState.uiEvents.length; i++) {
                if (appState.uiEvents[i].type === 'user') {
                    if (uiUserCount === userIndex) {
                        uiCutoffIndex = i;
                        break;
                    }
                    uiUserCount++;
                }
            }

            if (uiCutoffIndex !== -1) {
                appState.uiEvents = appState.uiEvents.slice(0, uiCutoffIndex);
            }

            // Remove DOM nodes from targetIndex onward
            const nodesToRemove = allMessageNodes.slice(targetIndex);
            nodesToRemove.forEach(node => node.remove());
        }

        // Add the new edited prompt to state & UI
        appState.addMessage({ role: 'user', content: textToSend });
        appState.addUiEvent({ type: 'user', text: textToSend });
        chatUIController.appendMessage('user', textToSend);

        chatUIController.resetAssistantStream();
        chatUIController.setUiLoading(true, appState);
        saveCurrentChat();

        const modelDetails = modelDropdownController.getSelectedModelDetails();
        const geminiThinkingLevel = modelDetails.reasoningEffort || settingsController.getGeminiThinkingLevel(modelDetails.model);
        const attachedFilesCopy = fileUploadController.getAttachedFiles();
        fileUploadController.clear();

        ipcBridge.sendUserPrompt(
            appState.messages,
            modelDetails.model,
            modelDetails.thinking,
            geminiThinkingLevel,
            appState.activeMode === 'planning',
            attachedFilesCopy,
            appState.currentChatId,
            appState.activeMode,
            appState.workspacePath || ''
        );
    };

    // DOM Element References for Input Orchestration
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const newChatBtn = document.getElementById('new-chat-btn');
    const atMentionTriggerBtn = document.getElementById('at-mention-trigger-btn');
    const contextOptionsMenu = document.getElementById('context-options-menu');
    const contextModeSelector = document.getElementById('context-mode-selector');
    const modeOptChat = document.getElementById('mode-opt-chat');
    const modeOptAgent = document.getElementById('mode-opt-agent');
    const modeOptPlanning = document.getElementById('mode-opt-planning');
    const sidebar = document.getElementById('app-sidebar');
    const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
    const workspaceBadgeBtn = document.getElementById('workspace-badge-btn');

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

    const topWorkspaceBtn = document.getElementById('top-workspace-btn');
    if (topWorkspaceBtn) {
        topWorkspaceBtn.addEventListener('click', () => {
            ipcBridge.browseWorkspaceFolder();
        });
    }

    // Workspace Selector Click Handler
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
        const topWsBtn = document.getElementById('top-workspace-btn');
        if (topWsBtn) {
            topWsBtn.title = hasWs ? `Active Workspace: ${workspacePath} (Click to change)` : 'Click to Select Workspace Folder';
        }

        // Without a folder attached, only 1 mode (Chat) exists -> hide mode selector button entirely
        const modeContainer = document.getElementById('context-options-dropdown-container');
        if (modeContainer) {
            modeContainer.classList.toggle('hidden', !hasWs);
        }

        if (modeOptAgent) {
            modeOptAgent.disabled = !hasWs;
            modeOptAgent.classList.toggle('disabled', !hasWs);
            modeOptAgent.title = hasWs ? 'Autonomous code edits and terminal execution' : 'Select a workspace folder first to use Agent Mode';
        }
        if (modeOptPlanning) {
            modeOptPlanning.disabled = !hasWs;
            modeOptPlanning.classList.toggle('disabled', !hasWs);
            modeOptPlanning.title = hasWs ? 'Structured plan-first protocol before code edits' : 'Select a workspace folder first to use Plan Mode';
        }

        if (!hasWs) {
            setActiveMode('chat');
        } else if (appState.activeMode === 'chat') {
            setActiveMode('ask');
        }
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
    const newChatIconBtn = document.getElementById('new-chat-icon-btn');
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
    if (newChatIconBtn) {
        newChatIconBtn.addEventListener('click', handleNewChatClick);
    }

    // When user deletes the currently open chat from sidebar, reset to a clean new chat
    historyManager.onActiveChatDeleted = () => {
        const newId = appState.generateChatId();
        window.location.hash = `session-${newId}`;
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
     * Updates active mode UI selection and input placeholder accordingly.
     * @param {'chat'|'ask'|'agent'|'planning'} mode New active mode.
     */
    function setActiveMode(mode) {
        if (!appState.hasActiveWorkspace) {
            mode = 'chat';
        } else if (mode === 'chat') {
            mode = 'ask';
        }
        appState.activeMode = mode;
        localStorage.setItem('kai.activeMode', mode);

        if (contextModeSelector) {
            contextModeSelector.querySelectorAll('.context-mode-item').forEach(btn => {
                const itemMode = btn.dataset.mode;
                btn.classList.toggle('active', itemMode === mode || (itemMode === 'ask' && mode === 'ask'));
            });
        }

        if (atMentionTriggerBtn) {
            atMentionTriggerBtn.dataset.mode = mode;
            const modeLabels = { chat: 'Chat', ask: 'Ask', agent: 'Agent', planning: 'Plan' };
            const modeIcons = {
                chat: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>',
                ask: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>',
                agent: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>',
                planning: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>'
            };
            
            const iconEl = document.getElementById('active-mode-icon');
            if (iconEl && modeIcons[mode]) {
                iconEl.innerHTML = modeIcons[mode];
            }
            const textEl = document.getElementById('active-mode-text');
            if (textEl) {
                textEl.textContent = modeLabels[mode] || 'Ask';
            }
            atMentionTriggerBtn.title = `Mode: ${modeLabels[mode] || 'Ask'} (@)`;
        }

        if (messageInput) {
            if (mode === 'chat') {
                messageInput.placeholder = 'Ask Kai anything, calculate, convert, or search the web...';
            } else if (mode === 'ask') {
                messageInput.placeholder = 'Ask questions about your workspace codebase...';
            } else if (mode === 'agent') {
                messageInput.placeholder = 'Ask Kai to edit code, execute tasks, or run commands...';
            } else if (mode === 'planning') {
                messageInput.placeholder = 'Describe a project task to generate an implementation plan...';
            }
        }
    }

    // Set initial active mode on startup
    setActiveMode(appState.activeMode || 'chat');

    // Context Mode Selector Items Click Handlers
    if (contextModeSelector) {
        contextModeSelector.addEventListener('click', (e) => {
            const item = e.target.closest('.context-mode-item');
            if (!item || !item.dataset.mode) return;

            const targetMode = item.dataset.mode;
            // Block selection completely if item is disabled or no active workspace is open
            if (item.disabled || item.classList.contains('disabled') || (!appState.hasActiveWorkspace && targetMode !== 'chat')) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }

            setActiveMode(targetMode);
            if (contextOptionsMenu) contextOptionsMenu.classList.add('hidden');
            saveCurrentChat();
        });
    }

    let isDirty = false;

    /**
     * Marks state as changed so the 500ms debounced timer will persist it.
     */
    function markDirty() {
        isDirty = true;
    }

    /**
     * Persists current active chat session to storage.
     */
    function saveCurrentChat() {
        const details = modelDropdownController.getSelectedModelDetails();
        ipcBridge.saveChat(appState.toChatPayload(details.thinking));
        historyManager.setActiveChatId(appState.currentChatId);
        isDirty = false;
    }

    // Auto-save interval checking every 500ms if there are unsaved state changes
    setInterval(() => {
        if (isDirty && appState.currentChatId) {
            saveCurrentChat();
        }
    }, 500);

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

        chatUIController.resetAssistantStream();

        let userPrompt = '';
        if (appState.selectedCodeContext) {
            userPrompt += `Here is the selected code context from the editor:\n\`\`\`\n${appState.selectedCodeContext}\n\`\`\`\n\n`;
        }
        userPrompt += text;

        appState.addMessage({ role: 'user', content: userPrompt });
        const userDisplayText = text || 'Sent selected code context';
        appState.addUiEvent({ type: 'user', text: userDisplayText });

        chatUIController.appendMessage('user', userDisplayText);

        if (messageInput) {
            messageInput.value = '';
            autoResizeInput();
        }
        appState.selectedCodeContext = '';

        chatUIController.setUiLoading(true, appState);
        saveCurrentChat();

        const modelDetails = modelDropdownController.getSelectedModelDetails();
        const geminiThinkingLevel = modelDetails.reasoningEffort || settingsController.getGeminiThinkingLevel(modelDetails.model);

        const attachedFilesCopy = fileUploadController.getAttachedFiles();
        fileUploadController.clear();

        ipcBridge.sendUserPrompt(
            appState.messages,
            modelDetails.model,
            modelDetails.thinking,
            geminiThinkingLevel,
            appState.activeMode === 'planning',
            attachedFilesCopy,
            appState.currentChatId,
            appState.activeMode,
            appState.workspacePath || ''
        );
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
        setActiveMode(appState.activeMode || 'chat');
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

    if (atMentionTriggerBtn && contextOptionsMenu) {
        atMentionTriggerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!appState.hasActiveWorkspace) {
                contextOptionsMenu.classList.add('hidden');
                return;
            }
            contextOptionsMenu.classList.toggle('hidden');
        });

        document.addEventListener('click', (e) => {
            if (!contextOptionsMenu.contains(e.target) && !atMentionTriggerBtn.contains(e.target)) {
                contextOptionsMenu.classList.add('hidden');
            }
        });
    }



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

        // 1. All data-i18n text nodes
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (translations[key]) {
                el.textContent = translations[key];
            }
        });

        // 2. All data-i18n-title attributes
        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            const key = el.getAttribute('data-i18n-title');
            if (translations[key]) {
                el.setAttribute('title', translations[key]);
            }
        });

        // 3. Message input placeholder
        const msgInput = document.getElementById('message-input');
        if (msgInput && translations.messagePlaceholder) {
            msgInput.placeholder = translations.messagePlaceholder;
        }

        // 4. Thinking toggle label
        const thinkingLabel = document.getElementById('thinking-toggle-label');
        if (thinkingLabel && translations.thinkingToggle) {
            thinkingLabel.textContent = translations.thinkingToggle;
        }

        // 5. Settings controller
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
        
        // If the user selected a new workspace folder via the picker, message.workspacePath has it
        if (message.workspacePath && message.workspacePath !== appState.workspacePath) {
            updateWorkspaceUi(message.workspacePath);
            saveCurrentChat();
        } else {
            updateWorkspaceUi(appState.workspacePath || '');
        }

        settingsController.updateConnectionStatus(message);
        modelDropdownController.updateConnectionStatus(message);
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
        markDirty();
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
        if (chatUIController.currentAssistantMsgElement) {
            const existingThinking = chatUIController.currentAssistantMsgElement.querySelector('.thinking-content');
            if (existingThinking) {
                forceThinkingCollapsed = existingThinking.classList.contains('collapsed');
            }
        }

        const replyContent = message.content !== undefined ? message.content : (message.text || '');
        const isThinkingChecked = (settingsController && settingsController.showThinkingToggle) 
            ? settingsController.showThinkingToggle.checked 
            : (localStorage.getItem('kai.showThinking') !== 'false');
        const formatted = formatter.formatMarkdown(replyContent, forceThinkingCollapsed, isThinkingChecked);

        const currentMode = message.mode || appState.activeMode || 'chat';

        if (chatUIController.currentAssistantMsgElement) {
            if (formatted.trim()) {
                chatUIController.currentAssistantMsgElement.dataset.rawContent = replyContent;
                chatUIController.currentAssistantMsgElement.dataset.mode = currentMode;
                chatUIController.currentAssistantMsgElement.querySelector('.message-content').innerHTML = formatted;
                if (!chatUIController.currentAssistantMsgElement.querySelector('.message-actions')) {
                    chatUIController.currentAssistantMsgElement.appendChild(chatUIController.createAssistantActionBar(currentMode));
                }
            } else {
                chatUIController.currentAssistantMsgElement.remove();
            }
        } else if (formatted.trim()) {
            chatUIController.appendMessage('assistant', replyContent, currentMode);
        }

        if (message.fullHistory) {
            appState.messages = message.fullHistory;
        } else {
            appState.addMessage({ role: 'assistant', content: replyContent });
        }

        const lastEvt = appState.uiEvents[appState.uiEvents.length - 1];
        if (replyContent && (!lastEvt || lastEvt.type !== 'assistant')) {
            appState.addUiEvent({ type: 'assistant', content: replyContent });
        }

        if (message.modifiedFiles && message.modifiedFiles.length > 0) {
            appState.addMessage({ role: 'file-summary', content: JSON.stringify(message.modifiedFiles) });
            appState.addUiEvent({ type: 'file-summary', files: message.modifiedFiles });
            chatUIController.appendMessage('file-summary', JSON.stringify(message.modifiedFiles));
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
        historyManager.renderHistoryList(message.chats, appState.isWaitingForResponse);
    });

    // Request initial chat history load after listeners are registered
    ipcBridge.loadChatHistory();

    // Start periodic server connection health checks
    ipcBridge.checkConnection();
    setInterval(() => ipcBridge.checkConnection(), 15000);

    /**
     * Central Hash Router for Client-Side SPA Navigation.
     * Routes:
     * - #settings -> Opens Settings view
     * - #help -> Opens Help modal view
     * - #session-<chatId> -> Loads the specified chat session or initializes a new one
     */
    function handleHashRouting() {
        const rawHash = (window.location.hash || '').replace(/^#/, '').trim();

        if (rawHash === 'settings') {
            chatUIController.showView('settings');
            if (helpModalController && typeof helpModalController.close === 'function') {
                helpModalController.close(false);
            }
            return;
        }

        if (rawHash === 'help') {
            if (helpModalController && typeof helpModalController.open === 'function') {
                helpModalController.open(false);
            }
            return;
        }

        if (rawHash.startsWith('session-')) {
            const targetSessionId = rawHash.substring(8);
            if (helpModalController && typeof helpModalController.close === 'function') {
                helpModalController.close(false);
            }

            if (appState.currentChatId === targetSessionId && appState.messages.length > 0) {
                chatUIController.showView('chat');
                return;
            }

            // Check localStorage cache for session
            try {
                const saved = JSON.parse(localStorage.getItem('kai.savedChats') || '[]');
                const found = saved.find(c => c.id === targetSessionId);
                if (found) {
                    loadChatSession(found);
                    return;
                }
            } catch (e) {}

            // If not found in cache, initialize as a clean session with targetSessionId
            createNewChat(targetSessionId);
            return;
        }

        // Default: If hash is empty, assign current active chat session hash
        const activeId = appState.currentChatId || appState.generateChatId();
        window.location.hash = `session-${activeId}`;
    }

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

    // Listen for hash navigation (back/forward, history click, link navigation)
    window.addEventListener('hashchange', handleHashRouting);

    // Run router on initial startup
    handleHashRouting();
})();

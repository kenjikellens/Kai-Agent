/**
 * Client-side entry script for Kai Agent Chat Webview.
 * Instantiates and orchestrates ES6 OOP modules.
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

    // DOM Element References for Input Orchestration
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const newChatBtn = document.getElementById('new-chat-btn');
    const attachFileBtn = document.getElementById('attach-file-btn');
    const atMentionTriggerBtn = document.getElementById('at-mention-trigger-btn');
    const contextOptionsMenu = document.getElementById('context-options-menu');
    const planningModeOptionRow = document.getElementById('planning-mode-option-row');

    /**
     * Dynamically resizes the message input textarea based on content scrollHeight.
     */
    function adjustInputHeight() {
        if (!messageInput) return;
        messageInput.style.height = 'auto';
        const MAX_HEIGHT = 180;
        const newHeight = Math.min(messageInput.scrollHeight, MAX_HEIGHT);
        messageInput.style.height = `${newHeight}px`;
        messageInput.style.overflowY = messageInput.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
    }

    /**
     * Initializes the Planning Mode switch toggle inside the @ options menu using ToggleComponent.
     */
    if (planningModeOptionRow) {
        const planningToggleEl = ToggleComponent.create({
            id: 'planning-mode-toggle-switch',
            label: window.KAI_I18N?.planningMode || 'Planning Mode',
            checked: appState.isPlanningModeEnabled,
            title: window.KAI_I18N?.planningModeDesc || 'Enforce step-by-step planning before execution',
            onChange: (checked) => {
                appState.isPlanningModeEnabled = checked;
                localStorage.setItem('kai.planningMode', checked ? 'true' : 'false');
                if (atMentionTriggerBtn) {
                    atMentionTriggerBtn.classList.toggle('active-mode', checked);
                }
            }
        });
        planningModeOptionRow.appendChild(planningToggleEl);
        if (atMentionTriggerBtn && appState.isPlanningModeEnabled) {
            atMentionTriggerBtn.classList.add('active-mode');
        }
    }

    let isDirty = false;

    /**
     * Marks state as changed so the 500ms debounced timer will persist it.
     */
    function markDirty() {
        isDirty = true;
    }

    /**
     * Persists current active chat session to workspace state.
     */
    function saveCurrentChat() {
        const details = modelDropdownController.getSelectedModelDetails();
        ipcBridge.saveChat(appState.toChatPayload(details.thinking));
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
            adjustInputHeight();
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
            appState.isPlanningModeEnabled,
            attachedFilesCopy
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

        chatUIController.renderUiEvents(appState.uiEvents, appState.messages);
        modelDropdownController.setSelectedModel(appState.selectedModelValue);

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
            contextOptionsMenu.classList.toggle('hidden');
        });

        document.addEventListener('click', (e) => {
            if (!contextOptionsMenu.contains(e.target) && !atMentionTriggerBtn.contains(e.target)) {
                contextOptionsMenu.classList.add('hidden');
            }
        });
    }

    if (newChatBtn) {
        newChatBtn.addEventListener('click', () => {
            if (appState.isWaitingForResponse) {
                ipcBridge.abort();
            }
            appState.resetChat();
            chatUIController.clearChatContainer();
            chatUIController.resetAssistantStream();
            chatUIController.setUiLoading(false, appState);
            chatUIController.showView('chat');
        });
    }

    if (messageInput) {
        messageInput.addEventListener('input', adjustInputHeight);
        messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
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
        if (message.translations) {
            window.KAI_I18N = message.translations;
            if (messageInput && message.translations.messagePlaceholder) {
                messageInput.placeholder = message.translations.messagePlaceholder;
            }
            const thinkingLabel = document.getElementById('thinking-toggle-label');
            if (thinkingLabel && message.translations.thinkingToggle) {
                thinkingLabel.textContent = message.translations.thinkingToggle;
            }
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

    ipcBridge.on('typing', () => {
        chatUIController.setUiLoading(true, appState);
        chatUIController.resetAssistantStream();
    });

    /**
     * Handles final assistant completion replies, updates UI bubble and persists chat history.
     * @param {object} message Reply payload from extension host.
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

        if (chatUIController.currentAssistantMsgElement) {
            if (formatted.trim()) {
                chatUIController.currentAssistantMsgElement.querySelector('.message-content').innerHTML = formatted;
            } else {
                chatUIController.currentAssistantMsgElement.remove();
            }
        } else if (formatted.trim()) {
            chatUIController.appendMessage('assistant', replyContent);
        }

        if (message.fullHistory) {
            appState.messages = message.fullHistory;
        } else {
            appState.addMessage({ role: 'assistant', content: replyContent });
        }

        // If assistant content was not already streamed into uiEvents, add it now
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

    ipcBridge.on('chatHistory', (message) => {
        historyManager.renderHistoryList(message.chats, appState.isWaitingForResponse);
    });

    ipcBridge.on('loadChat', (message) => {
        loadChatSession(message.chat);
    });

    // Start periodic server connection health checks
    ipcBridge.checkConnection();
    setInterval(() => ipcBridge.checkConnection(), 15000);
})();

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
        settingsController
    );

    // DOM Element References for Input Orchestration
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const newChatBtn = document.getElementById('new-chat-btn');
    const thinkingToggle = document.getElementById('thinking-toggle');

    /**
     * Persists current active chat session to workspace state.
     */
    function saveCurrentChat() {
        const isThinkingChecked = thinkingToggle ? thinkingToggle.checked : true;
        ipcBridge.saveChat(appState.toChatPayload(isThinkingChecked));
    }

    /**
     * Sends user prompt input to extension host or aborts ongoing generation.
     */
    function sendMessage() {
        if (appState.isWaitingForResponse) {
            ipcBridge.abort();
            chatUIController.setUiLoading(false, appState);
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

        appState.addMessage({ role: 'user', content: userPrompt });
        const userDisplayText = text || 'Sent selected code context';
        appState.addUiEvent({ type: 'user', text: userDisplayText });

        chatUIController.appendMessage('user', userDisplayText);

        if (messageInput) messageInput.value = '';
        appState.selectedCodeContext = '';

        chatUIController.setUiLoading(true, appState);
        saveCurrentChat();

        const isThinkingChecked = thinkingToggle ? thinkingToggle.checked : true;
        ipcBridge.sendUserPrompt(appState.messages, appState.selectedModelValue, isThinkingChecked);
    }

    /**
     * Loads a saved chat session into state and updates UI views.
     * @param {object} chat Saved chat session object.
     */
    function loadChatSession(chat) {
        if (!chat) return;
        appState.loadSession(chat);

        chatUIController.renderUiEvents(appState.uiEvents, appState.messages);
        modelDropdownController.setSelectedModel(appState.selectedModelValue);

        if (chat.thinking !== undefined && thinkingToggle) {
            thinkingToggle.checked = chat.thinking;
        }

        chatUIController.setUiLoading(false, appState);
        chatUIController.showView('chat');
        ipcBridge.checkConnection();
    }

    // Bind Primary UI Buttons
    if (sendBtn) {
        sendBtn.addEventListener('click', sendMessage);
    }

    if (newChatBtn) {
        newChatBtn.addEventListener('click', () => {
            if (appState.isWaitingForResponse) {
                ipcBridge.abort();
            }
            appState.resetChat();
            chatUIController.clearChatContainer();
            chatUIController.setUiLoading(false, appState);
            chatUIController.showView('chat');
        });
    }

    if (messageInput) {
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
        if (settingsController.apiKeyInput && message.apiKey !== undefined) {
            settingsController.apiKeyInput.value = message.apiKey;
        }

        modelDropdownController.updateConnectionStatus(message);
    });

    ipcBridge.on('addCodeSelection', (message) => {
        appState.selectedCodeContext = message.text;
        if (messageInput) {
            messageInput.focus();
        }
    });

    ipcBridge.on('agentProgress', (message) => {
        chatUIController.handleAgentProgress(message, appState);
    });

    ipcBridge.on('typing', () => {
        chatUIController.setUiLoading(true, appState);
        chatUIController.currentAssistantMsgElement = null;
        chatUIController.currentAssistantText = '';
    });

    ipcBridge.on('reply', (message) => {
        chatUIController.setUiLoading(false, appState);

        let forceThinkingCollapsed = null;
        if (chatUIController.currentAssistantMsgElement) {
            const existingThinking = chatUIController.currentAssistantMsgElement.querySelector('.thinking-content');
            if (existingThinking) {
                forceThinkingCollapsed = existingThinking.classList.contains('collapsed');
            }
        }

        const isThinkingChecked = thinkingToggle ? thinkingToggle.checked : true;
        const formatted = formatter.formatMarkdown(message.content, forceThinkingCollapsed, isThinkingChecked);

        if (chatUIController.currentAssistantMsgElement) {
            if (formatted.trim()) {
                chatUIController.currentAssistantMsgElement.querySelector('.message-content').innerHTML = formatted;
            } else {
                chatUIController.currentAssistantMsgElement.remove();
            }
        } else if (formatted.trim()) {
            chatUIController.appendMessage('assistant', message.content);
        }

        if (message.fullHistory) {
            appState.messages = message.fullHistory;
        } else {
            appState.addMessage({ role: 'assistant', content: message.content });
        }

        if (message.content) {
            appState.addUiEvent({ type: 'assistant', content: message.content });
        }

        if (message.modifiedFiles && message.modifiedFiles.length > 0) {
            appState.addMessage({ role: 'file-summary', content: JSON.stringify(message.modifiedFiles) });
            appState.addUiEvent({ type: 'file-summary', files: message.modifiedFiles });
            chatUIController.appendMessage('file-summary', JSON.stringify(message.modifiedFiles));
        }

        saveCurrentChat();
        chatUIController.currentAssistantMsgElement = null;
        chatUIController.currentAssistantText = '';
    });

    ipcBridge.on('replyError', (message) => {
        chatUIController.setUiLoading(false, appState);
        chatUIController.appendMessage('system', `Error: ${message.message}`);
        saveCurrentChat();
        chatUIController.currentAssistantMsgElement = null;
        chatUIController.currentAssistantText = '';
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

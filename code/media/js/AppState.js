/**
 * AppState manages active chat and session state.
 */
class AppState {
    /**
     * Initializes state containers and defaults.
     */
    constructor() {
        this.currentChatId = this.generateChatId();
        this.messages = [];
        this.uiEvents = [];
        this.attachedFiles = [];
        this.selectedCodeContext = '';
        this.isWaitingForResponse = false;
        this.selectedModelValue = localStorage.getItem('kai.selectedModel') || 'local-model';
        this.isPlanningModeEnabled = localStorage.getItem('kai.planningMode') === 'true';
        this.accordionStates = {};
    }

    /**
     * Generates a unique chat session identifier.
     * @returns {string} Unique chat ID.
     */
    generateChatId() {
        return 'chat_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now();
    }

    /**
     * Resets the active session for a new chat.
     */
    resetChat() {
        this.currentChatId = this.generateChatId();
        this.messages = [];
        this.uiEvents = [];
        this.attachedFiles = [];
        this.selectedCodeContext = '';
        this.isWaitingForResponse = false;
    }

    /**
     * Appends a message object to the message state stack.
     * @param {object} msg Message object with role and content.
     */
    addMessage(msg) {
        this.messages.push(msg);
    }

    /**
     * Updates or appends the current assistant response UI event payload.
     * @param {string} text Live assistant response text.
     */
    updateOrAddAssistantUiEvent(text) {
        if (!text) return;
        const lastEvt = this.uiEvents[this.uiEvents.length - 1];
        if (lastEvt && lastEvt.type === 'assistant' && lastEvt.isStreaming) {
            lastEvt.content = text;
        } else {
            this.uiEvents.push({ type: 'assistant', content: text, isStreaming: true });
        }
    }

    /**
     * Finalizes streaming on the active assistant UI event.
     */
    finalizeAssistantUiEvent() {
        const lastEvt = this.uiEvents[this.uiEvents.length - 1];
        if (lastEvt && lastEvt.type === 'assistant') {
            delete lastEvt.isStreaming;
        }
    }

    /**
     * Appends a UI event record to the uiEvents stack.
     * @param {object} evt UI event payload.
     */
    addUiEvent(evt) {
        this.uiEvents.push(evt);
    }

    /**
     * Loads session state from a saved chat object.
     * @param {object} chat Saved chat object.
     */
    loadSession(chat) {
        if (!chat) return;
        this.currentChatId = chat.id;
        this.messages = chat.messages || [];
        this.uiEvents = chat.uiEvents || [];
        if (chat.model) {
            this.selectedModelValue = chat.model;
        }
        this.selectedCodeContext = '';
        this.isWaitingForResponse = false;
    }

    /**
     * Computes the chat title based on the first user prompt.
     * @returns {string} Session title.
     */
    getChatTitle() {
        const firstUserMsg = this.messages.find(m => m.role === 'user');
        let title = 'New Chat';
        if (firstUserMsg) {
            title = firstUserMsg.content;
            if (title.startsWith('Here is the selected code context')) {
                const parts = title.split('\n\n');
                title = parts[parts.length - 1] || 'New Chat';
            }
            if (title.length > 30) {
                title = title.substring(0, 27) + '...';
            }
        }
        return title;
    }

    /**
     * Prepares a serializable payload for saving the current chat.
     * @param {boolean} isThinkingChecked Whether thinking toggle is active.
     * @returns {object} Chat payload object.
     */
    toChatPayload(isThinkingChecked) {
        return {
            id: this.currentChatId,
            title: this.getChatTitle(),
            messages: this.messages,
            uiEvents: this.uiEvents,
            model: this.selectedModelValue,
            thinking: isThinkingChecked,
            timestamp: Date.now()
        };
    }
}

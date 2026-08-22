/**
 * AppState manages active chat and session state.
 */
class AppState {
    /**
     * Initializes state containers and defaults.
     */
    constructor() {
        this.currentChatId = this.generateChatId();
        this.currentChatTitle = '';
        this.messages = [];
        this.uiEvents = [];
        this.attachedFiles = [];
        this.selectedCodeContext = '';
        this.isWaitingForResponse = false;
        this.selectedModelValue = localStorage.getItem('kai.selectedModel') || 'local-model';
        this.activeMode = localStorage.getItem('kai.activeMode') || 'chat';
        this.workspacePath = '';
        this.hasActiveWorkspace = false;
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
        this.currentChatTitle = '';
        this.messages = [];
        this.uiEvents = [];
        this.attachedFiles = [];
        this.selectedCodeContext = '';
        this.workspacePath = '';
        this.hasActiveWorkspace = false;
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
     * @param {string} [mode] Current operational mode.
     * @param {object} [meta] Metadata for model, thinking, and reasoning.
     */
    updateOrAddAssistantUiEvent(text, mode, meta = {}) {
        if (!text) return;
        const lastEvt = this.uiEvents[this.uiEvents.length - 1];
        if (lastEvt && lastEvt.type === 'assistant') {
            lastEvt.content = text;
            if (mode) lastEvt.mode = mode;
            if (meta.model) lastEvt.model = meta.model;
            if (meta.thinking !== undefined) lastEvt.thinking = meta.thinking;
            if (meta.isThinkingCapable !== undefined) lastEvt.isThinkingCapable = meta.isThinkingCapable;
            if (meta.reasoningEffort) lastEvt.reasoningEffort = meta.reasoningEffort;
        } else {
            this.uiEvents.push({
                type: 'assistant',
                content: text,
                isStreaming: true,
                mode: mode || this.activeMode,
                model: meta.model || this.selectedModelValue,
                thinking: meta.thinking,
                isThinkingCapable: meta.isThinkingCapable,
                reasoningEffort: meta.reasoningEffort
            });
        }
    }

    /**
     * Finalizes streaming on the active assistant UI event.
     * @param {string} [finalText] Optional final response text.
     * @param {string} [mode] Current operational mode.
     * @param {object} [meta] Metadata for model, thinking, and reasoning.
     */
    finalizeAssistantUiEvent(finalText, mode, meta = {}) {
        const lastEvt = this.uiEvents[this.uiEvents.length - 1];
        if (lastEvt && lastEvt.type === 'assistant') {
            delete lastEvt.isStreaming;
            if (finalText !== undefined && finalText !== null) lastEvt.content = finalText;
            if (mode) lastEvt.mode = mode;
            if (meta.model) lastEvt.model = meta.model;
            if (meta.thinking !== undefined) lastEvt.thinking = meta.thinking;
            if (meta.isThinkingCapable !== undefined) lastEvt.isThinkingCapable = meta.isThinkingCapable;
            if (meta.reasoningEffort) lastEvt.reasoningEffort = meta.reasoningEffort;
        } else if (finalText) {
            this.uiEvents.push({
                type: 'assistant',
                content: finalText,
                mode: mode || this.activeMode,
                model: meta.model || this.selectedModelValue,
                thinking: meta.thinking,
                isThinkingCapable: meta.isThinkingCapable,
                reasoningEffort: meta.reasoningEffort
            });
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
        this.currentChatTitle = chat.title || '';
        this.messages = Array.isArray(chat.messages) ? JSON.parse(JSON.stringify(chat.messages)) : [];
        this.uiEvents = Array.isArray(chat.uiEvents) ? JSON.parse(JSON.stringify(chat.uiEvents)) : [];
        if (chat.model) {
            this.selectedModelValue = chat.model;
        }
        if (chat.mode) {
            this.activeMode = chat.mode;
        }
        this.workspacePath = chat.workspacePath || '';
        this.hasActiveWorkspace = !!this.workspacePath;
        this.selectedCodeContext = '';
        this.isWaitingForResponse = false;
    }

    /**
     * Computes the chat title based on the first user prompt.
     * @returns {string} Session title.
     */
    getChatTitle() {
        if (this.currentChatTitle) {
            return this.currentChatTitle;
        }
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
            title: this.currentChatTitle || this.getChatTitle(),
            messages: JSON.parse(JSON.stringify(this.messages || [])),
            uiEvents: JSON.parse(JSON.stringify(this.uiEvents || [])),
            model: this.selectedModelValue,
            mode: this.activeMode,
            workspacePath: this.workspacePath,
            thinking: isThinkingChecked,
            timestamp: Date.now()
        };
    }
}

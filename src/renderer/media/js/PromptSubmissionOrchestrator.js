/**
 * PromptSubmissionOrchestrator coordinates prompt preparation, attached files,
 * retry rollbacks, edit prompt dispatches, and IPC communication.
 */
class PromptSubmissionOrchestrator {
    /**
     * Initializes orchestrator with references to core controllers and state.
     * @param {object} options Controller instances map.
     * @param {AppState} options.appState Application state instance.
     * @param {ChatUIController} options.chatUIController Chat UI controller instance.
     * @param {ModelDropdownController} options.modelDropdownController Model dropdown controller.
     * @param {FileUploadController} options.fileUploadController File upload controller.
     * @param {SettingsController} options.settingsController Settings controller.
     * @param {WebviewIPCBridge} options.ipcBridge Webview IPC bridge instance.
     * @param {SessionRepository} [options.sessionRepository] Session repository instance.
     */
    constructor(options) {
        this.appState = options.appState;
        this.chatUIController = options.chatUIController;
        this.modelDropdownController = options.modelDropdownController;
        this.fileUploadController = options.fileUploadController;
        this.settingsController = options.settingsController;
        this.ipcBridge = options.ipcBridge;
        this.sessionRepository = options.sessionRepository;
    }

    /**
     * Sends a new user prompt to the agent pipeline.
     * @param {string} promptText The user's input text.
     */
    async submitPrompt(promptText) {
        if (!promptText || !promptText.trim()) return;
        if (this.appState.isWaitingForResponse) return;

        const textToSend = promptText.trim();
        const attachedFiles = this.fileUploadController ? this.fileUploadController.getAttachedFiles() : [];
        if (this.fileUploadController) this.fileUploadController.clear();

        // Add user message to state and UI
        this.appState.addMessage({ role: 'user', content: textToSend });
        this.appState.addUiEvent({ type: 'user', text: textToSend });
        this.chatUIController.appendMessage('user', textToSend);

        this.chatUIController.resetAssistantStream();
        this.chatUIController.setUiLoading(true, this.appState);

        if (this.sessionRepository) {
            this.sessionRepository.saveSession({
                id: this.appState.currentChatId,
                title: this.appState.currentChatTitle || textToSend.substring(0, 30),
                timestamp: Date.now(),
                messages: this.appState.messages,
                uiEvents: this.appState.uiEvents,
                model: this.appState.selectedModelValue,
                mode: this.appState.activeMode,
                workspacePath: this.appState.workspacePath || ''
            });
        }

        const modelDetails = this.modelDropdownController.getSelectedModelDetails();
        const reasoningLevel = modelDetails.reasoningEffort || (this.settingsController ? this.settingsController.getGeminiThinkingLevel(modelDetails.model) : 'high');

        this.ipcBridge.sendUserPrompt(
            this.appState.messages,
            modelDetails.model,
            modelDetails.thinking,
            reasoningLevel,
            this.appState.activeMode === 'planning',
            attachedFiles,
            this.appState.currentChatId,
            this.appState.activeMode,
            this.appState.workspacePath || ''
        );
    }

    /**
     * Retries the last assistant turn by popping previous assistant message and re-running.
     * @param {HTMLElement} assistantMessageElement Target DOM element to remove.
     */
    async retryLastTurn(assistantMessageElement) {
        if (this.appState.isWaitingForResponse) return;

        const lastUserMsg = [...this.appState.messages].reverse().find(m => m.role === 'user');
        if (!lastUserMsg) return;

        if (assistantMessageElement) {
            assistantMessageElement.remove();
        }

        if (this.appState.messages.length > 0 && this.appState.messages[this.appState.messages.length - 1].role === 'assistant') {
            this.appState.messages.pop();
        }
        if (this.appState.uiEvents.length > 0 && this.appState.uiEvents[this.appState.uiEvents.length - 1].type === 'assistant') {
            this.appState.uiEvents.pop();
        }

        this.chatUIController.resetAssistantStream();
        this.chatUIController.setUiLoading(true, this.appState);

        const modelDetails = this.modelDropdownController.getSelectedModelDetails();
        const reasoningLevel = modelDetails.reasoningEffort || (this.settingsController ? this.settingsController.getGeminiThinkingLevel(modelDetails.model) : 'high');

        this.ipcBridge.sendUserPrompt(
            this.appState.messages,
            modelDetails.model,
            modelDetails.thinking,
            reasoningLevel,
            this.appState.activeMode === 'planning',
            [],
            this.appState.currentChatId,
            this.appState.activeMode,
            this.appState.workspacePath || ''
        );
    }

    /**
     * Edits a previously submitted user prompt and triggers a fresh generation.
     * @param {HTMLElement} userRowElement Target row element.
     * @param {string} newText Edited prompt string.
     */
    async editPrompt(userRowElement, newText) {
        if (this.appState.isWaitingForResponse) return;
        if (!newText || !newText.trim()) return;

        await this.submitPrompt(newText);
    }
}

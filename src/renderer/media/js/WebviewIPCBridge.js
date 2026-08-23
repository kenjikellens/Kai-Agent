/**
 * WebviewIPCBridge: Lightweight IPC communication gateway.
 * Forwards calls to Electron / VS Code host or delegates to BrowserPreviewEngine in browser mode.
 */
class WebviewIPCBridge {
    constructor() {
        this.listeners = new Map();
        this._isElectron = typeof window !== 'undefined' && Boolean(window.electronAPI);
        this.vscode = (typeof acquireVsCodeApi === 'function') ? acquireVsCodeApi() : null;
        this._activeTurnId = null;
        this.onCommandApprovalRequest = null;

        // Initialize Browser Preview Engine if running standalone in browser
        if (!this._isElectron && !this.vscode && typeof BrowserToolsExecutor !== 'undefined' && typeof BrowserPreviewEngine !== 'undefined') {
            this.toolsExecutor = new BrowserToolsExecutor(
                () => this._activeTurnId,
                (cmd) => this.onCommandApprovalRequest ? this.onCommandApprovalRequest(cmd) : Promise.resolve(true)
            );
            this.previewEngine = new BrowserPreviewEngine(this.toolsExecutor);
        }

        this._initMessageListener();
    }

    /**
     * Registers message event listener to dispatch events to handlers.
     * @private
     */
    _initMessageListener() {
        const dispatch = (message) => {
            if (message && message.type && this.listeners.has(message.type)) {
                const callbacks = this.listeners.get(message.type);
                callbacks.forEach(cb => cb(message));
            }
        };

        if (this._isElectron && window.electronAPI) {
            window.electronAPI.onMessage(dispatch);
        } else {
            window.addEventListener('message', (event) => {
                dispatch(event.data);
            });
        }
    }

    /**
     * Subscribes a callback to an incoming message type.
     * @param {string} type Incoming message key.
     * @param {Function} callback Event handler.
     */
    on(type, callback) {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, []);
        }
        this.listeners.get(type).push(callback);
    }

    /**
     * Dispatches an event directly to local listeners.
     * @param {object} message Event payload.
     */
    _emit(message) {
        if (message && message.type && this.listeners.has(message.type)) {
            this.listeners.get(message.type).forEach(cb => cb(message));
        }
    }

    /**
     * Posts a message to Electron, VS Code Extension Host, or BrowserPreviewEngine.
     * @param {object} message Message payload.
     */
    postMessage(message) {
        if (this._isElectron && window.electronAPI) {
            window.electronAPI.sendMessage(message);
        } else if (this.vscode) {
            this.vscode.postMessage(message);
        } else if (this.previewEngine) {
            this.previewEngine.handleMessage(message, (msg) => this._emit(msg));
        }
    }

    // Public API Methods

    sendUserPrompt(messages, model, thinking, geminiThinkingLevel = 'high', planningMode = false, attachedFiles = [], chatId = null, mode = 'agent', workspacePath = '') {
        this._activeTurnId = chatId;
        this.postMessage({
            type: 'sendMessage',
            messages,
            model,
            thinking,
            geminiThinkingLevel,
            planningMode,
            attachedFiles,
            chatId,
            mode,
            workspacePath
        });
    }

    openFilePicker() {
        this.postMessage({ type: 'openFilePicker' });
    }

    browseWorkspaceFolder() {
        this.postMessage({ type: 'browseWorkspaceFolder' });
    }

    browseLMStudioFolder() {
        this.postMessage({ type: 'browseLMStudioFolder' });
    }

    switchLMStudioModel(modelId) {
        this.postMessage({ type: 'switchLMStudioModel', model: modelId });
    }

    saveChat(chat) {
        this.postMessage({ type: 'saveChat', chat });
    }

    loadChatHistory() {
        this.postMessage({ type: 'loadChatHistory' });
    }

    loadChat(chatId) {
        this.postMessage({ type: 'loadChat', chatId });
    }

    deleteChat(chatId) {
        this.postMessage({ type: 'deleteChat', chatId });
    }

    checkConnection() {
        this.postMessage({ type: 'checkConnection' });
    }

    updateSettings(settings) {
        this.postMessage({ type: 'updateSettings', ...settings });
    }

    openFile(filePath) {
        this.postMessage({ type: 'openFile', filePath });
    }

    rollbackTurn(turnIds) {
        const ids = Array.isArray(turnIds) ? turnIds : [turnIds];
        this.postMessage({ type: 'rollbackTurn', turnIds: ids });
    }

    abort() {
        this.postMessage({ type: 'abort' });
    }

    openExternalUrl(url) {
        if (!url) return;
        this.postMessage({ type: 'openExternal', url });
    }
}

if (typeof window !== 'undefined') {
    window.WebviewIPCBridge = WebviewIPCBridge;
}

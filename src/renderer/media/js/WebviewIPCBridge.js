/**
 * WebviewIPCBridge manages bidirectional IPC communication
 * between the Webview UI and the Electron Main process / VS Code Extension Host / Live HTTP Bridge.
 */
class WebviewIPCBridge {
    /**
     * Initializes IPC reference and message dispatchers.
     */
    constructor() {
        this.listeners = new Map();
        this._isElectron = typeof window.electronAPI !== 'undefined';
        this._isVsCode = typeof acquireVsCodeApi === 'function';
        if (!this._isElectron && this._isVsCode) {
            this.vscode = acquireVsCodeApi();
        }
        this._initGlobalErrorHandling();
        this._initMessageListener();
    }

    /**
     * Posts a message object to the host process or live HTTP server.
     * @param {object} message Message payload.
     */
    postMessage(message) {
        if (this._isElectron && window.electronAPI) {
            window.electronAPI.postMessage(message);
        } else if (this.vscode) {
            this.vscode.postMessage(message);
        } else {
            fetch('/api/ipc', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(message)
            })
            .then(res => res.json())
            .then(data => {
                if (data && data.type && this.listeners.has(data.type)) {
                    this.listeners.get(data.type).forEach(cb => cb(data));
                }
            })
            .catch(() => {});
        }
    }

    /**
     * Subscribes a listener function to incoming message types.
     * @param {string} type Incoming message type key.
     * @param {Function} callback Handler function.
     */
    on(type, callback) {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, []);
        }
        this.listeners.get(type).push(callback);
    }

    /**
     * Attaches window.onerror handler to catch unhandled client errors.
     * @private
     */
    _initGlobalErrorHandling() {
        window.onerror = (message, source, lineno, colno, error) => {
            this.postMessage({
                type: 'replyError',
                message: `Webview JS Error: ${message} at line ${lineno}:${colno}`
            });
        };
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
     * Sends message payload to Host to start agent generation.
     * @param {Array} messages Conversation messages array.
     * @param {string} model Selected model ID.
     * @param {boolean} thinking Thinking toggle active status for local models.
     * @param {string} geminiThinkingLevel Selected reasoning level for Gemini models.
     * @param {boolean} planningMode Whether planning mode is toggled on.
     * @param {Array} attachedFiles Array of attached file objects.
     */
    sendUserPrompt(messages, model, thinking, geminiThinkingLevel = 'high', planningMode = false, attachedFiles = []) {
        this.postMessage({
            type: 'sendMessage',
            messages,
            model,
            thinking,
            geminiThinkingLevel,
            planningMode,
            attachedFiles
        });
    }

    /**
     * Requests Host to open native file picker.
     */
    openFilePicker() {
        this.postMessage({ type: 'openFilePicker' });
    }

    /**
     * Requests Host to open native folder picker for active workspace directory.
     */
    browseWorkspaceFolder() {
        this.postMessage({ type: 'browseWorkspaceFolder' });
    }

    /**
     * Sends chat object to Host for persistence.
     * @param {object} chat Chat data object.
     */
    saveChat(chat) {
        this.postMessage({ type: 'saveChat', chat });
    }

    /**
     * Requests history list from Host.
     */
    loadChatHistory() {
        this.postMessage({ type: 'loadChatHistory' });
    }

    /**
     * Requests loading a specific chat session by ID.
     * @param {string} chatId Unique chat identifier.
     */
    loadChat(chatId) {
        this.postMessage({ type: 'loadChat', chatId });
    }

    /**
     * Requests deleting a specific chat session by ID.
     */
    deleteChat(chatId) {
        this.postMessage({ type: 'deleteChat', chatId });
    }

    /**
     * Triggers server connection verification check.
     */
    checkConnection() {
        this.postMessage({ type: 'checkConnection' });
    }

    /**
     * Posts setting updates to Host.
     * @param {object} settings Settings key-value pairs.
     */
    updateSettings(settings) {
        this.postMessage({ type: 'updateSettings', ...settings });
    }

    /**
     * Requests opening a workspace file.
     * @param {string} filePath File path string.
     */
    openFile(filePath) {
        this.postMessage({ type: 'openFile', filePath });
    }

    /**
     * Triggers abort signal to stop active generation loop.
     */
    abort() {
        this.postMessage({ type: 'abort' });
    }

    /**
     * Requests Host to open native folder picker for LM Studio directory.
     */
    browseLMStudioFolder() {
        this.postMessage({ type: 'browseLMStudioFolder' });
    }

    /**
     * Requests Host to open an external URL in default browser.
     * @param {string} url External URL string.
     */
    openExternalUrl(url) {
        this.postMessage({ type: 'openExternal', url });
    }
}

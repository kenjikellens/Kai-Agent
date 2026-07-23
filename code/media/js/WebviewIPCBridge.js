/**
 * WebviewIPCBridge manages bidirectional IPC communication
 * between the Webview UI and the VS Code Extension Host.
 */
class WebviewIPCBridge {
    /**
     * Initializes VS Code API reference and message dispatchers.
     */
    constructor() {
        this.vscode = acquireVsCodeApi();
        this.listeners = new Map();
        this._initGlobalErrorHandling();
        this._initMessageListener();
    }

    /**
     * Posts a message object to the extension host.
     * @param {object} message Message payload.
     */
    postMessage(message) {
        this.vscode.postMessage(message);
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
     * Registers window message event listener to dispatch events to handlers.
     * @private
     */
    _initMessageListener() {
        window.addEventListener('message', (event) => {
            const message = event.data;
            if (message && message.type && this.listeners.has(message.type)) {
                const callbacks = this.listeners.get(message.type);
                callbacks.forEach(cb => cb(message));
            }
        });
    }

    /**
     * Sends message payload to Extension Host to start agent generation.
     * @param {Array} messages Conversation messages array.
     * @param {string} model Selected model ID.
     * @param {boolean} thinking Thinking toggle active status.
     */
    sendUserPrompt(messages, model, thinking) {
        this.postMessage({
            type: 'sendMessage',
            messages,
            model,
            thinking
        });
    }

    /**
     * Sends chat object to Extension Host for workspace state storage.
     * @param {object} chat Chat data object.
     */
    saveChat(chat) {
        this.postMessage({
            type: 'saveChat',
            chat
        });
    }

    /**
     * Requests history list from Extension Host.
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
     * @param {string} chatId Unique chat identifier.
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
     * Posts setting updates to Extension Host.
     * @param {object} settings Settings key-value pairs.
     */
    updateSettings(settings) {
        this.postMessage({
            type: 'updateSettings',
            ...settings
        });
    }

    /**
     * Requests opening a workspace file in VS Code editor.
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
}

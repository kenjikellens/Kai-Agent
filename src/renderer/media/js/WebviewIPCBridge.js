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
     * Posts a message object to the host process or handles client-side preview.
     * @param {object} message Message payload.
     */
    postMessage(message) {
        if (this._isElectron && window.electronAPI) {
            window.electronAPI.postMessage(message);
        } else if (this.vscode) {
            this.vscode.postMessage(message);
        } else {
            this._handleClientSideIPC(message);
        }
    }

    /**
     * Handles IPC messages locally in pure JavaScript when running in browser preview.
     * @param {object} message Message payload.
     * @private
     */
    async _handleClientSideIPC(message) {
        if (!message || !message.type) return;

        const emit = (data) => {
            if (data && data.type && this.listeners.has(data.type)) {
                this.listeners.get(data.type).forEach(cb => cb(data));
            }
        };

        switch (message.type) {
            case 'checkConnection': {
                const apiKey = localStorage.getItem('kai.geminiApiKey') || localStorage.getItem('kai.apiKey') || '';
                const serverUrl = localStorage.getItem('kai.serverUrl') || 'http://localhost:1234/v1';

                let lmConnected = false;
                let lmModels = [];
                const rawUrl = (serverUrl || 'http://localhost:1234/v1').trim().replace(/\/$/, '');
                const urlCandidates = [
                    `${rawUrl}/models`,
                    `${rawUrl}/v1/models`,
                    `${rawUrl.replace('localhost', '127.0.0.1')}/models`,
                    `${rawUrl.replace('localhost', '127.0.0.1')}/v1/models`,
                    'http://127.0.0.1:1234/v1/models',
                    'http://localhost:1234/v1/models'
                ];
                const uniqueCandidates = Array.from(new Set(urlCandidates));

                for (const testUrl of uniqueCandidates) {
                    try {
                        const controller = new AbortController();
                        const timer = setTimeout(() => controller.abort(), 1500);
                        const res = await fetch(testUrl, { method: 'GET', signal: controller.signal });
                        clearTimeout(timer);
                        if (res.ok) {
                            const json = await res.json();
                            if (json && Array.isArray(json.data) && json.data.length > 0) {
                                lmModels = json.data.map(m => m.id || m.name).filter(Boolean);
                                lmConnected = lmModels.length > 0;
                                if (lmConnected) break;
                            }
                        }
                    } catch (e) {}
                }

                const defaultGemini = (typeof KAI_CONSTANTS !== 'undefined' && KAI_CONSTANTS.DEFAULT_GEMINI_MODELS) || [
                    'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite',
                    'gemini-3-flash-preview', 'gemini-3.1-pro-preview', 'gemini-3.1-flash-lite'
                ];

                const defaultProviders = (typeof KAI_CONSTANTS !== 'undefined' && KAI_CONSTANTS.DEFAULT_PROVIDERS_WITH_MODELS) || [];
                const freeProviders = (typeof KAI_CONSTANTS !== 'undefined' && KAI_CONSTANTS.DEFAULT_FREE_PROVIDERS) || [];

                const freeProvidersConfig = freeProviders.map(p => {
                    const savedKey = localStorage.getItem(`kai.${p.configKey}`) || '';
                    const matchedGroup = defaultProviders.find(dp => dp.name.includes(p.name));
                    const models = matchedGroup ? matchedGroup.models : [];
                    return {
                        name: p.name,
                        configKey: p.configKey,
                        keyHint: p.keyHint,
                        models: models,
                        apiKey: savedKey,
                        connected: !!savedKey.trim()
                    };
                });

                const isGeminiConnected = !!apiKey.trim();
                const loadedModels = lmConnected ? lmModels : (isGeminiConnected ? defaultGemini : []);
                const activeModel = lmConnected && lmModels.length > 0
                    ? lmModels[0]
                    : (isGeminiConnected ? defaultGemini[0] : 'local-model');

                emit({
                    type: 'connectionStatus',
                    connected: lmConnected,
                    geminiConnected: isGeminiConnected,
                    model: activeModel,
                    lmStudioModels: lmModels,
                    geminiModels: defaultGemini,
                    loadedModels: loadedModels,
                    freeProviders: freeProvidersConfig,
                    serverUrl: serverUrl,
                    apiKey: apiKey,
                    lmStudioCacheDir: localStorage.getItem('kai.lmStudioCacheDir') || '',
                    lmStudioCacheStatus: { valid: false, error: 'Browser Preview Mode' },
                    lmStudioCapabilities: {},
                    workspacePath: 'Browser Preview',
                    workspaceName: 'Browser Preview'
                });
                break;
            }
            case 'updateSettings': {
                if (message.serverUrl !== undefined) localStorage.setItem('kai.serverUrl', message.serverUrl);
                if (message.apiKey !== undefined) {
                    localStorage.setItem('kai.apiKey', message.apiKey);
                    localStorage.setItem('kai.geminiApiKey', message.apiKey);
                }
                if (message.lmStudioCacheDir !== undefined) localStorage.setItem('kai.lmStudioCacheDir', message.lmStudioCacheDir);
                if (Array.isArray(message.freeProviders)) {
                    message.freeProviders.forEach(p => {
                        if (p.configKey && p.apiKey !== undefined) {
                            localStorage.setItem(`kai.${p.configKey}`, p.apiKey);
                        }
                    });
                }
                await this._handleClientSideIPC({ type: 'checkConnection' });
                break;
            }
            case 'saveChat': {
                try {
                    const saved = JSON.parse(localStorage.getItem('kai.savedChats') || '[]');
                    const idx = saved.findIndex(c => c.id === message.chat.id);
                    if (idx !== -1) {
                        saved[idx] = message.chat;
                    } else {
                        saved.unshift(message.chat);
                    }
                    localStorage.setItem('kai.savedChats', JSON.stringify(saved));
                } catch (e) {}
                break;
            }
            case 'loadChatHistory': {
                try {
                    const saved = JSON.parse(localStorage.getItem('kai.savedChats') || '[]');
                    emit({
                        type: 'chatHistory',
                        chats: saved.map(c => ({ id: c.id, title: c.title || 'New Chat', timestamp: c.timestamp || Date.now() }))
                    });
                } catch (e) {
                    emit({ type: 'chatHistory', chats: [] });
                }
                break;
            }
            case 'loadChat': {
                try {
                    const saved = JSON.parse(localStorage.getItem('kai.savedChats') || '[]');
                    const found = saved.find(c => c.id === message.chatId);
                    if (found) emit({ type: 'loadChat', chat: found });
                } catch (e) {}
                break;
            }
            case 'deleteChat': {
                try {
                    let saved = JSON.parse(localStorage.getItem('kai.savedChats') || '[]');
                    saved = saved.filter(c => c.id !== message.chatId);
                    localStorage.setItem('kai.savedChats', JSON.stringify(saved));
                    emit({
                        type: 'chatHistory',
                        chats: saved.map(c => ({ id: c.id, title: c.title || 'New Chat', timestamp: c.timestamp || Date.now() }))
                    });
                } catch (e) {}
                break;
            }
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

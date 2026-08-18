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
                const serverUrl = localStorage.getItem('kai.serverUrl') || 'http://127.0.0.1:1234/v1';

                const defaultGemini = (typeof KAI_CONSTANTS !== 'undefined' && KAI_CONSTANTS.DEFAULT_GEMINI_MODELS) || [
                    'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite',
                    'gemini-3-flash-preview', 'gemini-3.1-pro-preview', 'gemini-3.1-flash-lite'
                ];

                const defaultProviders = (typeof KAI_CONSTANTS !== 'undefined' && KAI_CONSTANTS.DEFAULT_PROVIDERS_WITH_MODELS) || [];
                const freeProviders = (typeof KAI_CONSTANTS !== 'undefined' && KAI_CONSTANTS.DEFAULT_FREE_PROVIDERS) || [];

                const buildFreeProviders = () => freeProviders.map(p => {
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

                const v0Urls = [
                    'http://127.0.0.1:1234/api/v0/models',
                    'http://localhost:1234/api/v0/models'
                ];
                const v1Urls = [
                    'http://127.0.0.1:1234/v1/models',
                    'http://localhost:1234/v1/models'
                ];

                let lmConnected = false;
                let lmModels = [];
                let loadedModels = [];

                // Fast probe for raw model data
                const probeCandidate = async (url) => {
                    const controller = new AbortController();
                    const timer = setTimeout(() => controller.abort(), 2000);
                    try {
                        const res = await fetch(url, { method: 'GET', signal: controller.signal });
                        clearTimeout(timer);
                        if (res.ok) {
                            const json = await res.json();
                            if (json && Array.isArray(json.data) && json.data.length > 0) {
                                return json.data;
                            }
                        }
                    } catch (e) {
                        clearTimeout(timer);
                    }
                    return [];
                };

                const v0Results = await Promise.allSettled(v0Urls.map(probeCandidate));
                let rawData = null;
                for (const r of v0Results) {
                    if (r.status === 'fulfilled' && r.value && r.value.length > 0) {
                        rawData = r.value;
                        break;
                    }
                }

                if (!rawData) {
                    const v1Results = await Promise.allSettled(v1Urls.map(probeCandidate));
                    for (const r of v1Results) {
                        if (r.status === 'fulfilled' && r.value && r.value.length > 0) {
                            rawData = r.value;
                            break;
                        }
                    }
                }

                if (rawData && Array.isArray(rawData)) {
                    lmConnected = true;
                    // Filter chat models (exclude embeddings)
                    lmModels = rawData
                        .filter(m => {
                            const id = (m.id || m.name || '').toLowerCase();
                            const type = (m.type || '').toLowerCase();
                            return type !== 'embeddings' && !id.includes('embed') && !id.includes('nomic') && !id.includes('bge-') && !id.includes('minilm');
                        })
                        .map(m => m.id || m.name)
                        .filter(Boolean);

                    // ONLY models with state === 'loaded' are considered loaded in memory
                    loadedModels = rawData
                        .filter(m => m.state === 'loaded')
                        .map(m => m.id || m.name)
                        .filter(Boolean);
                }

                const freeProvidersConfig = buildFreeProviders();
                const isGeminiConnected = !!apiKey.trim();
                const activeModel = lmModels.length > 0
                    ? (loadedModels.length > 0 ? loadedModels[0] : lmModels[0])
                    : (isGeminiConnected ? defaultGemini[0] : 'local-model');

                let lmStudioCapabilities = {};
                try {
                    const capRes = await fetch('/api/capabilities');
                    if (capRes.ok) {
                        lmStudioCapabilities = await capRes.json();
                    }
                } catch (e) {}

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
                    lmStudioCacheStatus: {
                        valid: lmConnected,
                        modelCount: lmModels.length,
                        error: lmConnected ? '' : 'LM Studio server offline'
                    },
                    lmStudioCapabilities: lmStudioCapabilities,
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
                    const chat = message.chat;
                    if (chat && (chat.messages?.length > 0 || chat.uiEvents?.length > 0)) {
                        const saved = JSON.parse(localStorage.getItem('kai.savedChats') || '[]');
                        const idx = saved.findIndex(c => c.id === chat.id);
                        if (idx !== -1) {
                            saved[idx] = chat;
                        } else {
                            saved.unshift(chat);
                        }
                        localStorage.setItem('kai.savedChats', JSON.stringify(saved));
                        emit({
                            type: 'chatHistory',
                            chats: saved.map(c => ({ id: c.id, title: c.title || 'New Chat', timestamp: c.timestamp || Date.now() }))
                        });
                    }
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
            case 'sendMessage': {
                const messages = message.messages || [];
                const model = message.model || 'local-model';
                const serverUrl = localStorage.getItem('kai.serverUrl') || 'http://127.0.0.1:1234/v1';

                emit({
                    type: 'agentProgress',
                    progressType: 'start',
                    text: 'Contacting model...'
                });

                try {
                    const cleanUrl = serverUrl.replace(/\/$/, '') + '/chat/completions';
                    const payload = {
                        model: model,
                        messages: messages.map(m => ({ role: m.role, content: m.content })),
                        stream: true
                    };

                    const effortVal = message.geminiThinkingLevel || 'xhigh';
                    const caps = (typeof ThinkingStateFormatter !== 'undefined' && ThinkingStateFormatter._capabilities)
                        ? (ThinkingStateFormatter._capabilities[model] || ThinkingStateFormatter._capabilities[model.toLowerCase()])
                        : null;

                    if (message.thinking) {
                        payload.thinking = true;
                        payload.enable_thinking = true;
                        payload.reasoning_effort = effortVal;
                        payload.chat_template_kwargs = { enable_thinking: true };

                        if (caps && Array.isArray(caps.fields)) {
                            for (const field of caps.fields) {
                                if (field.type === 'boolean') {
                                    payload[field.variable] = true;
                                    payload.chat_template_kwargs[field.variable] = true;
                                } else if (field.type === 'select') {
                                    payload[field.variable] = effortVal;
                                    payload.chat_template_kwargs[field.variable] = effortVal;
                                }
                            }
                        }
                    } else {
                        payload.thinking = false;
                        payload.enable_thinking = false;
                        payload.reasoning_effort = 'none';
                        payload.chat_template_kwargs = { enable_thinking: false };

                        if (caps && Array.isArray(caps.fields)) {
                            for (const field of caps.fields) {
                                if (field.type === 'boolean') {
                                    payload[field.variable] = false;
                                    payload.chat_template_kwargs[field.variable] = false;
                                } else if (field.type === 'select') {
                                    payload[field.variable] = 'none';
                                    payload.chat_template_kwargs[field.variable] = 'none';
                                }
                            }
                        }
                    }

                    const response = await fetch(cleanUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });

                    if (!response.ok) {
                        throw new Error(`LM Studio returned ${response.status}: ${response.statusText}`);
                    }

                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();
                    let fullText = '';
                    let buffer = '';
                    let isThinking = false;
                    const allowThinkingUI = !!message.thinking;

                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');
                        buffer = lines.pop() || '';

                        for (const line of lines) {
                            const trimmed = line.trim();
                            if (!trimmed || trimmed.startsWith(':')) continue;
                            if (trimmed === 'data: [DONE]') break;
                            if (trimmed.startsWith('data: ')) {
                                try {
                                    const json = JSON.parse(trimmed.slice(6));
                                    const delta = json.choices?.[0]?.delta;
                                    if (!delta) continue;

                                    const reasoningChunk = delta.reasoning_content || delta.reasoning;
                                    const contentChunk = delta.content || delta.text;

                                    if (reasoningChunk && allowThinkingUI) {
                                        if (!isThinking) {
                                            isThinking = true;
                                            fullText += '<think>';
                                            emit({
                                                type: 'agentProgress',
                                                progressType: 'token',
                                                output: '<think>'
                                            });
                                        }
                                        fullText += reasoningChunk;
                                        emit({
                                            type: 'agentProgress',
                                            progressType: 'token',
                                            output: reasoningChunk
                                        });
                                    } else {
                                        const textToAdd = contentChunk || (!allowThinkingUI ? reasoningChunk : '');
                                        if (textToAdd) {
                                            if (isThinking) {
                                                isThinking = false;
                                                fullText += '</think>';
                                                emit({
                                                    type: 'agentProgress',
                                                    progressType: 'token',
                                                    output: '</think>'
                                                });
                                            }
                                            fullText += textToAdd;
                                            emit({
                                                type: 'agentProgress',
                                                progressType: 'token',
                                                output: textToAdd
                                            });
                                        }
                                    }
                                } catch (e) {}
                            }
                        }
                    }

                    if (isThinking) {
                        isThinking = false;
                        fullText += '</think>';
                        emit({
                            type: 'agentProgress',
                            progressType: 'token',
                            output: '</think>'
                        });
                    }

                    emit({
                        type: 'reply',
                        content: fullText,
                        modifiedFiles: []
                    });

                    // Trigger Background AI Chat Title Generation ONLY on the very first user message
                    const targetChatId = message.chatId;
                    const userMessages = messages.filter(m => m.role === 'user');
                    const firstUserMsg = userMessages[0];
                    if (userMessages.length === 1 && firstUserMsg && firstUserMsg.content) {
                        (async () => {
                            try {
                                const titlePrompt = `Summarize the following user request into a concise 3 to 5 word topic title for a chat sidebar. Answer with ONLY the title words, no quotes, no formatting, no thinking:\n\n${firstUserMsg.content.slice(0, 300)}`;
                                const titlePayload = {
                                    model: model,
                                    messages: [{ role: 'user', content: titlePrompt }],
                                    stream: false,
                                    max_tokens: 300,
                                    temperature: 0.2,
                                    thinking: false,
                                    enable_thinking: false,
                                    reasoning_effort: 'none',
                                    chat_template_kwargs: { enable_thinking: false }
                                };

                                if (caps && Array.isArray(caps.fields)) {
                                    for (const field of caps.fields) {
                                        if (field.type === 'boolean') {
                                            titlePayload[field.variable] = false;
                                            titlePayload.chat_template_kwargs[field.variable] = false;
                                        } else if (field.type === 'select') {
                                            titlePayload[field.variable] = 'none';
                                            titlePayload.chat_template_kwargs[field.variable] = 'none';
                                        }
                                    }
                                }

                                const titleRes = await fetch(cleanUrl, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify(titlePayload)
                                });
                                if (titleRes.ok) {
                                    const titleData = await titleRes.json();
                                    const choice = titleData.choices?.[0]?.message;
                                    let raw = (choice?.content || choice?.reasoning_content || '').trim();
                                    // Strip any <think>...</think> blocks
                                    raw = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
                                    // Extract the final line if multiple lines exist
                                    const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
                                    let rawTitle = lines.length > 0 ? lines[lines.length - 1] : raw;
                                    // Remove "Title:" prefixes, quotes, markdown characters
                                    rawTitle = rawTitle.replace(/^(title|topic)\s*:\s*/i, '')
                                                       .replace(/["'`*_#]/g, ' ')
                                                       .replace(/\s+/g, ' ')
                                                       .trim();
                                    if (rawTitle && rawTitle.length > 0 && rawTitle.length < 60) {
                                        const savedChats = JSON.parse(localStorage.getItem('kai.savedChats') || '[]');
                                        const foundChat = (targetChatId ? savedChats.find(c => c.id === targetChatId) : null) || savedChats[0];
                                        if (foundChat) {
                                            foundChat.title = rawTitle;
                                            localStorage.setItem('kai.savedChats', JSON.stringify(savedChats));
                                            emit({
                                                type: 'chatHistory',
                                                chats: savedChats.map(c => ({ id: c.id, title: c.title || 'New Chat', timestamp: c.timestamp || Date.now() }))
                                            });
                                            emit({
                                                type: 'chatTitleUpdated',
                                                chatId: foundChat.id,
                                                title: rawTitle
                                            });
                                        }
                                    }
                                }
                            } catch (e) {}
                        })();
                    }
                } catch (err) {
                    emit({
                        type: 'replyError',
                        message: `Fout bij verzenden: ${err.message}`
                    });
                }
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
    sendUserPrompt(messages, model, thinking, geminiThinkingLevel = 'high', planningMode = false, attachedFiles = [], chatId = null) {
        this.postMessage({
            type: 'sendMessage',
            messages,
            model,
            thinking,
            geminiThinkingLevel,
            planningMode,
            attachedFiles,
            chatId
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

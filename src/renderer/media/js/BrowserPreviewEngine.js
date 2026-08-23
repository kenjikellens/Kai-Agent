/**
 * BrowserPreviewEngine: Lifecycle coordinator for standalone browser preview mode (run_pc.py).
 * Handles connection checks, sessions, settings persistence, and delegates completions to BrowserCompletionEngine.
 */
class BrowserPreviewEngine {
    constructor(toolsExecutor) {
        this.toolsExecutor = toolsExecutor;
        this.completionEngine = new BrowserCompletionEngine(toolsExecutor);
    }

    /**
     * Routes incoming IPC messages from WebviewIPCBridge in browser mode.
     * @param {object} message Event message payload.
     * @param {Function} emit Callback to dispatch response messages to UI.
     */
    async handleMessage(message, emit) {
        if (!message || !message.type) return;

        switch (message.type) {
            case 'sendMessage':
                return this.completionEngine.executeTurn(message, emit);

            case 'abort':
                return this.completionEngine.abort();

            case 'checkConnection':
                return this.handleCheckConnection(message, emit);

            case 'saveChat':
                return this.handleSaveChat(message.chat);

            case 'loadChatHistory':
                return this.handleLoadChatHistory(emit);

            case 'loadChat':
                return this.handleLoadChat(message.chatId, emit);

            case 'deleteChat':
                return this.handleDeleteChat(message.chatId, emit);

            case 'rollbackTurn':
                return this.handleRollback(message.turnIds, emit);

            case 'openFilePicker': {
                const files = await BrowserNativeDialogs.openFilePicker();
                if (files && files.length > 0) {
                    emit({ type: 'filesSelected', files });
                }
                break;
            }

            case 'browseWorkspaceFolder': {
                const wsPath = await BrowserNativeDialogs.openWorkspaceFolderPicker();
                if (wsPath) {
                    localStorage.setItem('kai.workspacePath', wsPath);
                    await this.handleCheckConnection({ isFolderPicked: true, workspacePath: wsPath }, emit);
                }
                break;
            }

            case 'browseLMStudioFolder': {
                const lmsPath = await BrowserNativeDialogs.openLMStudioFolderPicker();
                if (lmsPath) {
                    localStorage.setItem('kai.lmStudioCacheDir', lmsPath);
                    const inputEl = document.getElementById('settings-lmstudio-path');
                    if (inputEl) inputEl.value = lmsPath;
                    await this.handleCheckConnection({}, emit);
                }
                break;
            }

            case 'switchLMStudioModel': {
                try {
                    await fetch('/api/lmstudio/switch', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ model: message.model })
                    });
                } catch (e) {}
                await this.handleCheckConnection({}, emit);
                break;
            }

            case 'openFile': {
                const filePath = message.filePath;
                if (filePath) {
                    window.open(`/api/workspace/open?path=${encodeURIComponent(filePath)}`, '_blank');
                }
                break;
            }

            case 'openExternal': {
                if (message.url) {
                    window.open(message.url, '_blank', 'noopener,noreferrer');
                }
                break;
            }

            case 'updateSettings': {
                if (message.serverUrl !== undefined) localStorage.setItem('kai.serverUrl', message.serverUrl);
                if (message.apiKey !== undefined) localStorage.setItem('kai.geminiApiKey', message.apiKey);
                if (message.lmStudioCacheDir !== undefined) localStorage.setItem('kai.lmStudioCacheDir', message.lmStudioCacheDir);
                if (message.language !== undefined) localStorage.setItem('kai.language', message.language);
                break;
            }
        }
    }

    /** Verifies provider connections and model manifests. */
    async handleCheckConnection(message, emit) {
        let connected = false;
        let lmStudioModels = [];
        let loadedModels = [];
        let serverUrl = localStorage.getItem('kai.serverUrl') || 'http://localhost:1234/v1';

        try {
            const res = await fetch('/api/lmstudio/models');
            if (res.ok) {
                const json = await res.json();
                lmStudioModels = (json.data || []).map(m => m.id || m.name);
                loadedModels = (json.data || []).filter(m => m.state === 'loaded').map(m => m.id || m.name);
                connected = json.connected !== undefined ? Boolean(json.connected) : (lmStudioModels.length > 0);
            }
        } catch (e) {
            connected = false;
        }

        // Direct probe fallback if running in standalone browser preview
        if (!connected) {
            try {
                const directRes = await fetch(serverUrl.replace(/\/$/, '') + '/models');
                if (directRes.ok) {
                    const directJson = await directRes.json();
                    const directModels = (directJson.data || []).map(m => m.id || m.name);
                    if (directModels.length > 0) {
                        connected = true;
                        if (lmStudioModels.length === 0) {
                            lmStudioModels = directModels;
                        }
                    }
                }
            } catch (e) {}
        }

        const geminiKey = localStorage.getItem('kai.geminiApiKey') || '';
        let geminiConnected = false;
        if (geminiKey) {
            try {
                const gRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}`);
                if (gRes.ok) geminiConnected = true;
            } catch (e) {}
        }

        const freeProviders = (window.KAI_CONSTANTS ? window.KAI_CONSTANTS.FREE_PROVIDERS : []).map(p => {
            const key = (localStorage.getItem(`kai.${p.configKey}`) || '').trim();
            return {
                ...p,
                apiKey: key,
                connected: Boolean(key)
            };
        });

        const activeLang = localStorage.getItem('kai.language') || 'auto';
        const allLocales = window.KAI_ALL_LOCALES || {};
        let translations = allLocales[activeLang];
        if (!translations && activeLang === 'auto') {
            const sys = (navigator.language || 'en').slice(0, 2).toLowerCase();
            translations = allLocales[sys] || allLocales.en;
        }
        if (!translations && allLocales) {
            translations = allLocales.en || {};
        }

        let activeWorkspace = localStorage.getItem('kai.workspacePath') || '';
        if (message && message.isFolderPicked && message.workspacePath) {
            activeWorkspace = message.workspacePath;
        }

        emit({
            type: 'connectionStatus',
            connected,
            geminiConnected,
            model: lmStudioModels[0] || 'local-model',
            lmStudioModels,
            geminiModels: window.KAI_CONSTANTS ? window.KAI_CONSTANTS.GEMINI_MODELS : [],
            loadedModels,
            freeProviders,
            serverUrl,
            apiKey: geminiKey,
            lmStudioCacheDir: localStorage.getItem('kai.lmStudioCacheDir') || '',
            lmStudioCacheStatus: { valid: true, message: 'Detected' },
            lmStudioCapabilities: {},
            workspacePath: activeWorkspace,
            translations,
            language: activeLang
        });
    }

    handleSaveChat(chat) {
        if (!chat || !chat.id) return;
        const chats = JSON.parse(localStorage.getItem('kai.savedChats') || '[]');
        const idx = chats.findIndex(c => c.id === chat.id);
        if (idx >= 0) chats[idx] = chat;
        else chats.unshift(chat);
        localStorage.setItem('kai.savedChats', JSON.stringify(chats));
    }

    handleLoadChatHistory(emit) {
        const chats = JSON.parse(localStorage.getItem('kai.savedChats') || '[]');
        emit({
            type: 'chatHistory',
            chats: chats.map(c => ({ id: c.id, title: c.title || 'New Chat', timestamp: c.timestamp || Date.now() }))
        });
    }

    handleLoadChat(chatId, emit) {
        const chats = JSON.parse(localStorage.getItem('kai.savedChats') || '[]');
        const found = chats.find(c => c.id === chatId);
        if (found) emit({ type: 'loadChat', chat: found });
    }

    handleDeleteChat(chatId, emit) {
        let chats = JSON.parse(localStorage.getItem('kai.savedChats') || '[]');
        chats = chats.filter(c => c.id !== chatId);
        localStorage.setItem('kai.savedChats', JSON.stringify(chats));
        emit({
            type: 'chatHistory',
            chats: chats.map(c => ({ id: c.id, title: c.title || 'New Chat', timestamp: c.timestamp || Date.now() }))
        });
    }

    async handleRollback(turnIds, emit) {
        const res = await this.toolsExecutor.rollbackTurnChanges(turnIds);
        emit({ type: 'rollbackCompleted', result: res });
    }
}

if (typeof window !== 'undefined') {
    window.BrowserPreviewEngine = BrowserPreviewEngine;
}

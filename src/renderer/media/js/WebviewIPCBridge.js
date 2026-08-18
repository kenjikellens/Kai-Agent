/**
 * WebviewIPCBridge manages bidirectional IPC communication
 * between the Webview UI and the Electron Main process (or VS Code Extension Host),
 * and provides simulated mock responses when running in standard browser test mode.
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
     * Posts a message object to the host process or simulates browser response in standalone web mode.
     * @param {object} message Message payload.
     */
    postMessage(message) {
        if (this._isElectron && window.electronAPI) {
            window.electronAPI.postMessage(message);
        } else if (this.vscode) {
            this.vscode.postMessage(message);
        } else {
            // Browser Test Mode Simulation
            this._handleBrowserTestMode(message);
        }
    }

    /**
     * Simulates backend responses for interactive browser testing.
     * @private
     * @param {object} message Sent payload.
     */
    _handleBrowserTestMode(message) {
        setTimeout(() => {
            switch (message.type) {
                case 'checkConnection': {
                    this._dispatchMock({
                        type: 'connectionStatus',
                        connected: true,
                        model: 'qwen2.5-coder-7b-instruct',
                        lmStudioModels: ['qwen2.5-coder-7b-instruct', 'deepseek-r1-distill-qwen-7b', 'phi-4'],
                        geminiModels: ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.1-pro-preview'],
                        loadedModels: ['qwen2.5-coder-7b-instruct'],
                        freeProviders: [
                            { name: 'Mistral AI', configKey: 'mistralApiKey', keyHint: 'Console Mistral', models: ['mistral-small-latest', 'codestral-latest'], apiKey: '' },
                            { name: 'Cerebras', configKey: 'cerebrasApiKey', keyHint: 'Cloud Cerebras', models: ['cerebras/llama-3.3-70b'], apiKey: '' }
                        ],
                        serverUrl: 'http://localhost:1234/v1',
                        apiKey: '',
                        lmStudioCacheDir: 'C:\\Users\\User\\.cache\\lm-studio',
                        lmStudioCacheStatus: { valid: true, path: 'C:\\Users\\User\\.cache\\lm-studio' },
                        workspacePath: 'C:\\Projects\\DemoApp',
                        workspaceName: 'DemoApp',
                        translations: window.KAI_I18N,
                        language: 'en'
                    });
                    break;
                }
                case 'sendMessage': {
                    this._simulateAgentStream(message.messages);
                    break;
                }
                case 'loadChatHistory': {
                    const raw = localStorage.getItem('kai_browser_chats') || '[]';
                    this._dispatchMock({
                        type: 'chatHistory',
                        chats: JSON.parse(raw)
                    });
                    break;
                }
                case 'saveChat': {
                    const raw = localStorage.getItem('kai_browser_chats') || '[]';
                    const list = JSON.parse(raw);
                    const idx = list.findIndex(c => c.id === message.chat.id);
                    if (idx !== -1) list[idx] = message.chat;
                    else list.unshift(message.chat);
                    localStorage.setItem('kai_browser_chats', JSON.stringify(list));
                    break;
                }
                case 'deleteChat': {
                    const raw = localStorage.getItem('kai_browser_chats') || '[]';
                    const list = JSON.parse(raw).filter(c => c.id !== message.chatId);
                    localStorage.setItem('kai_browser_chats', JSON.stringify(list));
                    this._dispatchMock({ type: 'chatHistory', chats: list });
                    break;
                }
                case 'loadChat': {
                    const raw = localStorage.getItem('kai_browser_chats') || '[]';
                    const found = JSON.parse(raw).find(c => c.id === message.chatId);
                    if (found) this._dispatchMock({ type: 'loadChat', chat: found });
                    break;
                }
                case 'browseWorkspaceFolder': {
                    const name = prompt('Enter a demo workspace folder name:', 'MyProject');
                    if (name) {
                        this._dispatchMock({
                            type: 'connectionStatus',
                            workspaceName: name,
                            workspacePath: `C:\\Projects\\${name}`
                        });
                    }
                    break;
                }
            }
        }, 100);
    }

    /**
     * Dispatches mock payload to registered listeners.
     * @private
     */
    _dispatchMock(payload) {
        if (payload && payload.type && this.listeners.has(payload.type)) {
            this.listeners.get(payload.type).forEach(cb => cb(payload));
        }
    }

    /**
     * Simulates agent thinking and streaming response for browser test mode.
     * @private
     */
    _simulateAgentStream(messages) {
        const userMsg = messages[messages.length - 1]?.content || 'Hello';
        const toolId = `tool-demo-${Date.now()}`;

        // 1. Tool start
        setTimeout(() => {
            this._dispatchMock({
                type: 'agentProgress',
                progressType: 'tool_start',
                tool: 'list_dir',
                query: 'list_dir: src',
                toolId: toolId,
                fileName: 'src'
            });
        }, 300);

        // 2. Tool end
        setTimeout(() => {
            this._dispatchMock({
                type: 'agentProgress',
                progressType: 'tool_end',
                tool: 'list_dir',
                output: '["index.ts", "components/", "utils.ts"]',
                toolId: toolId,
                fileName: 'src'
            });
        }, 900);

        // 3. Assistant final reply with thinking
        setTimeout(() => {
            const demoReply = `<think>\nAnalyzing the requested question: "${userMsg}"\nChecked workspace structure via list_dir tool.\nReady to answer.\n</think>\n\nHello! I am **KAI Agent** running in browser preview mode.\n\nHere is a quick code preview:\n\`\`\`typescript\nexport function greeting(name: string): string {\n    return \`Hello, \${name}!\`;\n}\n\`\`\`\n\nYou can interact with all dropdowns, the settings modal, history, and test the responsive dark theme!`;
            this._dispatchMock({
                type: 'reply',
                content: demoReply,
                modifiedFiles: ['src/index.ts']
            });
        }, 1500);
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
     */
    updateSettings(settings) {
        this.postMessage({ type: 'updateSettings', ...settings });
    }

    /**
     * Requests opening a workspace file.
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
     */
    openExternalUrl(url) {
        this.postMessage({ type: 'openExternal', url });
    }
}

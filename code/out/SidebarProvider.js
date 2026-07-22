"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SidebarProvider = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const AgentExecutor_1 = require("./AgentExecutor");
const LMStudioClient_1 = require("./LMStudioClient");
const i18n_1 = require("./i18n");
/**
 * SidebarProvider implements the vscode.WebviewViewProvider to govern the behavior,
 * HTML rendering, and message passing of the LM Studio Agent sidebar panel.
 */
class SidebarProvider {
    /**
     * Initializes a new instance of the SidebarProvider.
     * @param _context The extension context for persistent state and resource URI.
     */
    constructor(_context) {
        this._context = _context;
        this._currentStreamingText = '';
        this._currentStreamingMessages = [];
        this._extensionUri = _context.extensionUri;
    }
    /**
     * Called by VS Code when the webview sidebar is resolved/initialized.
     * Sets up the webview HTML content, registers event listeners, and establishes connection status.
     * @param webviewView The webview view to resolve.
     * @param context Additional contextual information.
     * @param token Cancellation token.
     */
    resolveWebviewView(webviewView, _context, _token) {
        this._view = webviewView;
        // Configure options to allow scripts and specify local file access roots
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };
        // Inject the HTML template
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        // Handle webview disposal/close
        webviewView.onDidDispose(() => {
            if (this._activeAbortController) {
                this._activeAbortController.abort();
                this._activeAbortController = undefined;
            }
            this._view = undefined;
        });
        // Listen for messages received from the webview client
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'sendMessage': {
                    await this._handleSendMessage(data.messages, data.model, data.thinking);
                    break;
                }
                case 'abort': {
                    if (this._activeAbortController) {
                        this._activeAbortController.abort();
                        this._activeAbortController = undefined;
                    }
                    break;
                }
                case 'checkConnection': {
                    await this._handleCheckConnection();
                    break;
                }
                case 'updateSettings': {
                    const config = vscode.workspace.getConfiguration('kai');
                    if (data.apiKey !== undefined) {
                        await config.update('apiKey', data.apiKey, vscode.ConfigurationTarget.Global);
                    }
                    if (data.language !== undefined) {
                        await config.update('language', data.language, vscode.ConfigurationTarget.Global);
                    }
                    // Persist per-provider API keys sent from the settings panel
                    if (data.providerKeys && typeof data.providerKeys === 'object') {
                        for (const [configKey, keyValue] of Object.entries(data.providerKeys)) {
                            await config.update(configKey, keyValue, vscode.ConfigurationTarget.Global);
                        }
                    }
                    await this._handleCheckConnection();
                    break;
                }
                case 'showError': {
                    vscode.window.showErrorMessage(data.message);
                    break;
                }
                case 'saveChat': {
                    await this._handleSaveChat(data.chat);
                    break;
                }
                case 'loadChatHistory': {
                    await this._handleLoadChatHistory();
                    break;
                }
                case 'deleteChat': {
                    await this._handleDeleteChat(data.chatId);
                    break;
                }
                case 'loadChat': {
                    await this._handleLoadChat(data.chatId);
                    break;
                }
            }
        });
        // Notify the webview if the agent is currently running
        webviewView.webview.postMessage({
            type: 'initialState',
            isRunning: this._activeAbortController !== undefined,
            streamingText: this._currentStreamingText,
            messages: this._currentStreamingMessages
        });
        // Trigger an initial connection status check
        this._handleCheckConnection();
    }
    /**
     * Handles the 'sendMessage' event from the webview, forwards it to LM Studio,
     * and sends the response back to the webview UI.
     * @param messages The chat history payload array.
     */
    async _handleSendMessage(messages, model, thinking = true) {
        if (!this._view) {
            return;
        }
        // Retrieve the active workspace root folder path
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            this._view.webview.postMessage({
                type: 'replyError',
                message: 'No active workspace directory found. Please open a folder first.'
            });
            return;
        }
        const workspacePath = workspaceFolders[0].uri.fsPath;
        // Fetch settings from vscode configuration
        const config = vscode.workspace.getConfiguration('kai');
        const serverUrl = config.get('serverUrl') || 'http://localhost:1234/v1';
        const temperature = config.get('temperature') || 0.7;
        // Extract the user prompt (it is the content of the last user message)
        const lastUserMsg = messages[messages.length - 1];
        const userPrompt = lastUserMsg ? lastUserMsg.content : '';
        try {
            fs.appendFileSync(path.join(workspacePath, 'kai_debug.log'), `[DEBUG] _handleSendMessage payload: model="${model}", prompt="${userPrompt}", totalMessages=${messages.length}\n`);
        }
        catch { }
        // Remove last user message from conversation history and filter out UI-only messages
        const chatHistoryWithoutLast = messages.slice(0, -1).filter((m) => m.role !== 'file-summary');
        this._currentStreamingMessages = messages;
        this._currentStreamingText = '';
        // Instantiate the AgentExecutor with workspace path and settings
        const executor = new AgentExecutor_1.AgentExecutor(workspacePath, this._extensionUri.fsPath, serverUrl, temperature, (progress) => {
            if (progress.type === 'token') {
                this._currentStreamingText += progress.output || '';
            }
            // Relay progress updates back to the webview
            this._view?.webview.postMessage({
                type: 'agentProgress',
                progressType: progress.type,
                tool: progress.tool,
                query: progress.query,
                output: progress.output,
                toolId: progress.toolId,
                fileName: progress.fileName
            });
        });
        this._activeAbortController = new AbortController();
        try {
            // Retrieve active editor file context if available
            const activeEditor = vscode.window.activeTextEditor;
            let activeFile = undefined;
            if (activeEditor) {
                const doc = activeEditor.document;
                if (doc.uri.scheme === 'file' && doc.getText().length < 50000) {
                    let relPath = doc.uri.fsPath;
                    if (workspaceFolders && workspaceFolders.length > 0) {
                        relPath = path.relative(workspaceFolders[0].uri.fsPath, relPath);
                    }
                    activeFile = {
                        fileName: path.basename(doc.uri.fsPath),
                        filePath: relPath,
                        content: doc.getText()
                    };
                }
            }
            // Signal the webview that the agent loop has started
            this._view.webview.postMessage({ type: 'typing' });
            // Execute the agent loop with the cancellation signal
            const runResult = await executor.run(userPrompt, chatHistoryWithoutLast, model || 'local-model', this._activeAbortController.signal, activeFile, thinking);
            // Send final completion message to the webview
            this._view.webview.postMessage({
                type: 'reply',
                content: runResult.reply,
                fullHistory: runResult.messages,
                modifiedFiles: runResult.modifiedFiles
            });
        }
        catch (error) {
            try {
                fs.appendFileSync(path.join(workspacePath, 'kai_debug.log'), `[ERROR] _handleSendMessage error: ${error.message || error}\n${error.stack || ''}\n`);
            }
            catch { }
            // Re-throw if error was generated from manual abort cancellation
            if (error.name === 'AbortError') {
                return;
            }
            this._view.webview.postMessage({
                type: 'replyError',
                message: error.message || 'Error occurred during execution.'
            });
        }
        finally {
            this._activeAbortController = undefined;
            this._currentStreamingText = '';
        }
    }
    /**
     * Connects to LM Studio to verify server status and retrieve the active loaded model.
     * Reports the model status back to the webview.
     */
    async _handleCheckConnection() {
        if (!this._view) {
            return;
        }
        const config = vscode.workspace.getConfiguration('kai');
        const serverUrl = config.get('serverUrl') || 'http://localhost:1234/v1';
        const apiKey = config.get('apiKey') || '';
        const client = new LMStudioClient_1.LMStudioClient(serverUrl);
        const [lmResult, geminiResult, loadedResult, omniResult] = await Promise.allSettled([
            client.getLMStudioModels(),
            client.getGeminiModels(apiKey),
            client.getLoadedModels(),
            client.getOmniRouteModels()
        ]);
        const lmModels = lmResult.status === 'fulfilled' ? lmResult.value : [];
        const lmStudioConnected = lmResult.status === 'fulfilled';
        const geminiModels = geminiResult.status === 'fulfilled' ? geminiResult.value : [];
        const loadedModels = loadedResult.status === 'fulfilled' ? loadedResult.value : [];
        const omniModels = omniResult.status === 'fulfilled' ? omniResult.value : [];
        const activeModel = lmModels.length > 0 ? lmModels[0] : (geminiModels.length > 0 ? geminiModels[0] : 'local-model');
        // Build per-provider model lists for the dropdown
        const freeProviders = LMStudioClient_1.FREE_PROVIDERS.map(p => {
            let models = p.models;
            if (p.configKey === 'omnirouteApiKey' && omniModels.length > 0) {
                const combinedSet = new Set([...models, ...omniModels]);
                models = Array.from(combinedSet);
            }
            return {
                name: p.name,
                configKey: p.configKey,
                keyHint: p.keyHint,
                models: models,
                apiKey: config.get(p.configKey) || ''
            };
        });
        const translations = i18n_1.I18nManager.getTranslations();
        const activeLang = i18n_1.I18nManager.getActiveLanguage();
        this._view.webview.postMessage({
            type: 'connectionStatus',
            connected: lmStudioConnected,
            model: activeModel,
            lmStudioModels: lmModels,
            geminiModels: geminiModels,
            loadedModels: loadedModels,
            freeProviders: freeProviders,
            serverUrl: serverUrl,
            apiKey: apiKey,
            translations: translations,
            language: activeLang
        });
    }
    /**
     * Helper command execution method that pushes the current text editor selection into the webview.
     */
    sendSelectionToChat() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage('No active text editor open.');
            return;
        }
        const selectionText = editor.document.getText(editor.selection);
        if (!selectionText) {
            vscode.window.showInformationMessage('Please select some code to send to the local agent.');
            return;
        }
        if (this._view) {
            this._view.show(true);
            this._view.webview.postMessage({
                type: 'addCodeSelection',
                text: selectionText
            });
        }
    }
    /**
     * Saves a chat session in the workspace state for persistence.
     * If the session already exists, it updates the messages, model, and timestamp.
     * @param chat The ChatSession object to be stored.
     */
    async _handleSaveChat(chat) {
        if (!chat || !chat.id) {
            return;
        }
        const chats = this._context.workspaceState.get('kai.chats') || {};
        chats[chat.id] = {
            id: chat.id,
            title: chat.title || 'New Chat',
            messages: chat.messages || [],
            model: chat.model || '',
            thinking: chat.thinking !== false,
            timestamp: chat.timestamp || Date.now()
        };
        await this._context.workspaceState.update('kai.chats', chats);
    }
    /**
     * Loads the list of saved chats from the workspace state,
     * sorts them by timestamp in descending order, and sends the history list to the webview.
     */
    async _handleLoadChatHistory() {
        if (!this._view) {
            return;
        }
        const chatsMap = this._context.workspaceState.get('kai.chats') || {};
        const chatsList = Object.values(chatsMap).sort((a, b) => b.timestamp - a.timestamp);
        this._view.webview.postMessage({
            type: 'chatHistory',
            chats: chatsList
        });
    }
    /**
     * Deletes a chat session by its ID from the workspace state and updates the webview's list.
     * @param chatId The unique ID of the chat to delete.
     */
    async _handleDeleteChat(chatId) {
        if (!chatId) {
            return;
        }
        const chats = this._context.workspaceState.get('kai.chats') || {};
        if (chats[chatId]) {
            delete chats[chatId];
            await this._context.workspaceState.update('kai.chats', chats);
        }
        await this._handleLoadChatHistory();
    }
    /**
     * Retrieves a specific chat session by its ID and sends it back to the webview.
     * @param chatId The unique ID of the chat to load.
     */
    async _handleLoadChat(chatId) {
        if (!this._view || !chatId) {
            return;
        }
        const chats = this._context.workspaceState.get('kai.chats') || {};
        const chat = chats[chatId];
        if (chat) {
            this._view.webview.postMessage({
                type: 'loadChat',
                chat: chat
            });
        }
    }
    _loadSvgs() {
        const svgDir = path.join(this._extensionUri.fsPath, 'media', 'svg');
        const svgs = {};
        try {
            if (fs.existsSync(svgDir)) {
                const files = fs.readdirSync(svgDir);
                for (const file of files) {
                    if (file.endsWith('.svg')) {
                        const name = path.basename(file, '.svg');
                        svgs[name] = fs.readFileSync(path.join(svgDir, file), 'utf8').trim();
                    }
                }
            }
        }
        catch (e) {
            console.error('Error loading SVGs:', e);
        }
        return svgs;
    }
    /**
     * Compiles and returns the full HTML string for the webview.
     * Links CSS/JS files and configures Content Security Policy.
     * @param webview The webview instance.
     * @returns The HTML document string.
     */
    _getHtmlForWebview(webview) {
        // Resolve resources from media directory
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.css'));
        // Use a nonce to restrict script source access
        const nonce = getNonce();
        const svgs = this._loadSvgs();
        const translations = i18n_1.I18nManager.getTranslations();
        const activeLang = i18n_1.I18nManager.getActiveLanguage();
        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <!--
                    Content Security Policy (CSP):
                    Allows loading scripts with the specific nonce and styles/images from the extension's resources and local server APIs.
                -->
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src *;">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${styleUri}" rel="stylesheet" />
                <title>Kai</title>
                <script nonce="${nonce}">
                    window.KAI_SVGS = ${JSON.stringify(svgs)};
                    window.KAI_I18N = ${JSON.stringify(translations)};
                    window.KAI_LANG = "${activeLang}";
                </script>
            </head>
            <body>
                <div class="sidebar-container">
                    <!-- Container 1: Minimalist Top Bar -->
                    <div class="sidebar-header">
                        <div class="header-actions">
                            <button id="new-chat-btn" class="icon-btn-header" title="${translations.newChat}">
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                            </button>
                            <button id="history-btn" class="icon-btn-header" title="${translations.history}">
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                            </button>
                            <button id="settings-btn" class="icon-btn-header" title="${translations.settings}">
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                            </button>
                        </div>
                    </div>

                    <!-- Container 2: Main Content Area (Swappable Views) -->
                    <div id="main-content-container" class="main-content-container">
                        <!-- View A: Active Chat View (Default) -->
                        <div id="chat-view" class="content-view">
                            <!-- Chat Output Area -->
                            <div id="chat-container" class="chat-container"></div>

                            <!-- Chat Input Area -->
                            <div class="input-panel">
                                <div class="input-card">
                                    <textarea id="message-input" placeholder="${translations.messagePlaceholder}" rows="1"></textarea>
                                    <div class="input-toolbar">
                                        <div class="toolbar-left">
                                            <div class="custom-dropdown" id="model-dropdown-container">
                                                <button type="button" class="dropdown-trigger" id="dropdown-trigger-btn" title="Active Model">
                                                    <span id="status-dot" class="status-dot status-disconnected"></span>
                                                    <span id="selected-model-text">${translations.selectModel || 'Select Model'}</span>
                                                    <svg class="dropdown-trigger-chevron" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                                                </button>
                                                <div class="dropdown-menu hidden" id="dropdown-options-menu">
                                                    <!-- Dynamically populated -->
                                                </div>
                                            </div>
                                            <label class="switch-container" title="Enable tool execution agent loop">
                                                <input type="checkbox" id="thinking-toggle" checked>
                                                <span class="slider-track"></span>
                                                <span class="switch-label" id="thinking-toggle-label">${translations.thinkingToggle}</span>
                                            </label>
                                        </div>
                                        <button id="send-btn" title="Send message">
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- View B: History View -->
                        <div id="history-container" class="content-view history-container hidden">
                            <div class="history-panel-header">
                                <span>${translations.previousChats}</span>
                                <button id="close-history-btn" class="icon-btn-header" title="Close History">✕</button>
                            </div>
                            <div id="history-list" class="history-list"></div>
                        </div>

                        <!-- View C: Settings View -->
                        <div id="settings-container" class="content-view settings-container hidden">
                            <div class="settings-panel-header">
                                <span>${translations.settings}</span>
                                <button id="close-settings-btn" class="icon-btn-header" title="Close Settings">✕</button>
                            </div>
                            <div class="settings-content-panel">
                                <div class="setting-item" id="manage-keys-container">
                                    <button type="button" class="btn-primary" id="manage-keys-btn">
                                        ${svgs.manage_keys || ''}
                                        <span>${translations.manageApiKeys}</span>
                                    </button>
                                </div>
                                <div class="setting-item" style="margin-top: 10px; margin-bottom: 10px;">
                                    <label for="language-select-input" style="font-size: 0.75rem; color: var(--app-muted); margin-bottom: 4px; display: block;">${translations.language}</label>
                                    <select id="language-select-input" style="width: 100%; background: var(--app-input-bg); color: var(--app-fg); border: 1px solid var(--app-input-border); border-radius: var(--app-radius-sm); padding: 4px;">
                                        <option value="auto">Auto (VS Code)</option>
                                        <option value="en">English</option>
                                        <option value="nl">Nederlands</option>
                                        <option value="de">Deutsch</option>
                                        <option value="fr">Français</option>
                                        <option value="es">Español</option>
                                    </select>
                                </div>
                                <label class="setting-row" title="${translations.showThinking}">
                                    <input type="checkbox" id="show-thinking-toggle" checked>
                                    <span>${translations.showThinking}</span>
                                </label>
                                <div id="thinking-subsettings" class="setting-sub-panel">
                                    <label class="setting-row" title="${translations.keepThinkingGenerating}">
                                        <input type="checkbox" id="keep-thinking-expanded-toggle" checked>
                                        <span>${translations.keepThinkingGenerating}</span>
                                    </label>
                                    <label class="setting-row" title="${translations.keepThinkingFinished}">
                                        <input type="checkbox" id="keep-thinking-finished-expanded-toggle">
                                        <span>${translations.keepThinkingFinished}</span>
                                    </label>
                                </div>
                            </div>
                        </div>

                        <!-- API Keys Modal Overlay (Positioned directly over main-content-container) -->
                        <div id="keys-container" class="keys-container hidden">
                            <div class="keys-panel-header">
                                <span>${translations.manageApiKeys}</span>
                                <button id="close-keys-btn" class="icon-btn-header" title="Close Keys Manager">✕</button>
                            </div>
                            <div class="keys-content-panel">
                                <div class="setting-item" id="gemini-key-item">
                                    <label for="api-key-input">Google Gemini API Key</label>
                                    <input type="password" id="api-key-input" placeholder="AIzaSy...">
                                </div>
                                <!-- Dynamic provider key inputs rendered here -->
                                <div id="dynamic-keys-list"></div>
                            </div>
                        </div>
                    </div>
                    </div>
                </div>

                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }
}
exports.SidebarProvider = SidebarProvider;
SidebarProvider.viewType = 'kai-chat-sidebar';
/**
 * Generates a random alphanumeric nonce string to secure script tags.
 * @returns A 32-character random nonce.
 */
function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
//# sourceMappingURL=SidebarProvider.js.map
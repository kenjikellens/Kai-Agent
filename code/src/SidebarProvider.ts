import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { AgentExecutor } from './AgentExecutor';
import { LMStudioClient, FREE_PROVIDERS } from './LMStudioClient';
import { I18nManager } from './i18n';
import { SessionStore } from './SessionStore';

/**
 * SidebarProvider implements the vscode.WebviewViewProvider to govern the behavior,
 * HTML rendering, and message passing of the LM Studio Agent sidebar panel.
 */
export class SidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'kai-chat-sidebar';
    private _view?: vscode.WebviewView;
    private _activeAbortController?: AbortController;
    private _currentStreamingText: string = '';
    private _currentStreamingMessages: any[] = [];

    private readonly _extensionUri: vscode.Uri;
    private readonly _sessionStore: SessionStore;

    /**
     * Initializes a new instance of the SidebarProvider.
     * @param context The extension context for persistent state and resource URI.
     */
    constructor(context: vscode.ExtensionContext) {
        this._extensionUri = context.extensionUri;
        this._sessionStore = new SessionStore(context.workspaceState);
    }

    /**
     * Called by VS Code when the webview sidebar is resolved/initialized.
     * Sets up the webview HTML content, registers event listeners, and establishes connection status.
     * @param webviewView The webview view to resolve.
     * @param context Additional contextual information.
     * @param token Cancellation token.
     */
    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
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
                    await this._handleSendMessage(data.messages, data.model, data.thinking, data.geminiThinkingLevel || 'high');
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
                    const envUpdates: Record<string, string> = {};

                    if (data.apiKey !== undefined) {
                        await config.update('apiKey', data.apiKey, vscode.ConfigurationTarget.Global);
                        envUpdates['GEMINI_API_KEY'] = data.apiKey;
                    }
                    if (data.language !== undefined) {
                        await config.update('language', data.language, vscode.ConfigurationTarget.Global);
                    }
                    // Persist per-provider API keys sent from the settings panel
                    if (data.providerKeys && typeof data.providerKeys === 'object') {
                        for (const [configKey, keyValue] of Object.entries(data.providerKeys)) {
                            await config.update(configKey, keyValue as string, vscode.ConfigurationTarget.Global);
                            const envName = configKey.replace('ApiKey', '_API_KEY').toUpperCase();
                            envUpdates[envName] = keyValue as string;
                        }
                    }
                    this._syncEnvFile(envUpdates);
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
                case 'openFile': {
                    await this._handleOpenFile(data.filePath);
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
    private async _handleSendMessage(
        messages: { role: string; content: string }[],
        model?: string,
        thinking: boolean = true,
        geminiThinkingLevel: string = 'high'
    ) {
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
        const serverUrl = config.get<string>('serverUrl') || 'http://localhost:1234/v1';
        const temperature = config.get<number>('temperature') || 0.7;

        // Extract the user prompt (it is the content of the last user message)
        const lastUserMsg = messages[messages.length - 1];
        const userPrompt = lastUserMsg ? lastUserMsg.content : '';
        
        try {
            fs.appendFileSync(path.join(workspacePath, 'kai_debug.log'), `[DEBUG] _handleSendMessage payload: model="${model}", prompt="${userPrompt}", totalMessages=${messages.length}\n`);
        } catch {}
        
        // Remove last user message from conversation history and filter out UI-only messages
        const chatHistoryWithoutLast = messages.slice(0, -1).filter((m: any) => m.role !== 'file-summary');

        this._currentStreamingMessages = messages;
        this._currentStreamingText = '';

        // Instantiate the AgentExecutor with workspace path and settings
        const executor = new AgentExecutor(
            workspacePath,
            this._extensionUri.fsPath,
            serverUrl,
            temperature,
            (progress) => {
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
            }
        );

        this._activeAbortController = new AbortController();

        try {
            // Retrieve active editor file context if available
            const activeEditor = vscode.window.activeTextEditor;
            let activeFile: { fileName: string; filePath: string; content: string } | undefined = undefined;
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
            const runResult = await executor.run(
                userPrompt,
                chatHistoryWithoutLast,
                model || 'local-model',
                this._activeAbortController.signal,
                activeFile,
                thinking,
                geminiThinkingLevel
            );

            // Send final completion message to the webview
            this._view.webview.postMessage({
                type: 'reply',
                content: runResult.reply,
                fullHistory: runResult.messages,
                modifiedFiles: runResult.modifiedFiles
            });
        } catch (error: any) {
            try {
                fs.appendFileSync(path.join(workspacePath, 'kai_debug.log'), `[ERROR] _handleSendMessage error: ${error.message || error}\n${error.stack || ''}\n`);
            } catch {}
            // Re-throw if error was generated from manual abort cancellation
            if (error.name === 'AbortError') {
                return;
            }
            this._view.webview.postMessage({
                type: 'replyError',
                message: error.message || 'Error occurred during execution.'
            });
        } finally {
            this._activeAbortController = undefined;
            this._currentStreamingText = '';
        }
    }

    /**
     * Connects to LM Studio to verify server status and retrieve the active loaded model.
     * Reports the model status back to the webview.
     */
    private async _handleCheckConnection() {
        if (!this._view) {
            return;
        }

        const config = vscode.workspace.getConfiguration('kai');
        const serverUrl = config.get<string>('serverUrl') || 'http://localhost:1234/v1';
        const apiKey = config.get<string>('apiKey') || '';
        const translations = I18nManager.getTranslations();
        const activeLang = I18nManager.getActiveLanguage();

        const buildFreeProviders = () => {
            return FREE_PROVIDERS.map(p => {
                return {
                    name: p.name,
                    configKey: p.configKey,
                    keyHint: p.keyHint,
                    models: p.models,
                    apiKey: config.get<string>(p.configKey) || ''
                };
            });
        };

        // 1. Send translations and API keys immediately (without connection status to avoid Offline flicker)

        // 2. Perform fast async model discovery
        const client = new LMStudioClient(serverUrl);

        const [lmResult, geminiResult] = await Promise.allSettled([
            client.getLMStudioModels(),
            client.getGeminiModels(apiKey)
        ]);

        const lmModels = lmResult.status === 'fulfilled' ? lmResult.value : [];
        const lmStudioConnected = lmResult.status === 'fulfilled' && lmModels.length > 0;
        const geminiModels = geminiResult.status === 'fulfilled' ? geminiResult.value : [];

        let loadedModels: string[] = [];
        if (lmStudioConnected) {
            loadedModels = await client.getLoadedModels().catch(() => []);
        } else {
            loadedModels = [...geminiModels];
        }

        const activeModel = lmModels.length > 0 ? lmModels[0] : (geminiModels.length > 0 ? geminiModels[0] : 'local-model');
        const updatedFreeProviders = buildFreeProviders();

        // 3. Post updated model availability
        this._view.webview.postMessage({
            type: 'connectionStatus',
            connected: lmStudioConnected,
            model: activeModel,
            lmStudioModels: lmModels,
            geminiModels: geminiModels,
            loadedModels: loadedModels,
            freeProviders: updatedFreeProviders,
            serverUrl: serverUrl,
            apiKey: apiKey,
            translations: translations,
            language: activeLang
        });

        // Also ensure current config keys are synced to .env file
        const envSync: Record<string, string> = {
            'GEMINI_API_KEY': apiKey
        };
        for (const p of FREE_PROVIDERS) {
            const keyVal = config.get<string>(p.configKey) || '';
            if (keyVal) {
                const envName = p.configKey.replace('ApiKey', '_API_KEY').toUpperCase();
                envSync[envName] = keyVal;
            }
        }
        this._syncEnvFile(envSync);
    }

    /**
     * Synchronizes API keys to the workspace root .env file.
     * @param envEntries Mapping of environment variable names to API key values.
     */
    private _syncEnvFile(envEntries: Record<string, string>) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return;
        }
        const envPath = path.join(workspaceFolders[0].uri.fsPath, '.env');
        let lines: string[] = [];
        if (fs.existsSync(envPath)) {
            lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
        }

        const envMap = new Map<string, string>();
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx !== -1) {
                const key = trimmed.slice(0, eqIdx).trim();
                const val = trimmed.slice(eqIdx + 1).trim();
                envMap.set(key, val);
            }
        }

        for (const [key, val] of Object.entries(envEntries)) {
            if (val) {
                envMap.set(key, val);
            }
        }

        const updatedContent = Array.from(envMap.entries())
            .map(([k, v]) => `${k}=${v}`)
            .join('\n') + '\n';

        try {
            fs.writeFileSync(envPath, updatedContent, 'utf8');
        } catch (e) {
            console.error('Failed to sync .env file:', e);
        }
    }

    /**
     * Helper command execution method that pushes the current text editor selection into the webview.
     */
    public sendSelectionToChat() {
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
     * Saves a chat session in workspaceState storage via SessionStore.
     * @param chat The ChatSession object to be stored.
     */
    private async _handleSaveChat(chat: any) {
        await this._sessionStore.saveChat(chat);
    }

    /**
     * Loads saved chat history via SessionStore and sends the sorted list to the webview.
     */
    private async _handleLoadChatHistory() {
        if (!this._view) {
            return;
        }
        const chatsList = this._sessionStore.getHistoryList();
        this._view.webview.postMessage({
            type: 'chatHistory',
            chats: chatsList
        });
    }

    /**
     * Deletes a chat session by ID via SessionStore and updates the webview's list.
     * @param chatId The unique ID of the chat to delete.
     */
    private async _handleDeleteChat(chatId: string) {
        if (!chatId) {
            return;
        }
        const updatedList = await this._sessionStore.deleteChat(chatId);
        if (this._view) {
            this._view.webview.postMessage({
                type: 'chatHistory',
                chats: updatedList
            });
        }
    }

    /**
     * Retrieves a specific chat session by ID via SessionStore and sends it back to the webview.
     * @param chatId The unique ID of the chat to load.
     */
    private async _handleLoadChat(chatId: string) {
        if (!this._view || !chatId) {
            return;
        }
        const chat = this._sessionStore.getChat(chatId);
        if (chat) {
            this._view.webview.postMessage({
                type: 'loadChat',
                chat: chat
            });
        }
    }

    /**
     * Handles opening a file in the active VS Code editor tab when clicked from the webview.
     * @param relOrAbsPath Relative or absolute file path to open.
     */
    private async _handleOpenFile(relOrAbsPath: string) {
        if (!relOrAbsPath) {
            return;
        }
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return;
        }
        const workspacePath = workspaceFolders[0].uri.fsPath;
        const targetPath = path.isAbsolute(relOrAbsPath)
            ? relOrAbsPath
            : path.join(workspacePath, relOrAbsPath);

        if (fs.existsSync(targetPath)) {
            const docUri = vscode.Uri.file(targetPath);
            const doc = await vscode.workspace.openTextDocument(docUri);
            await vscode.window.showTextDocument(doc);
        }
    }

    private _loadSvgs(): Record<string, string> {
        const svgDir = path.join(this._extensionUri.fsPath, 'media', 'svg');
        const svgs: Record<string, string> = {};
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
        } catch (e) {
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
    private _getHtmlForWebview(webview: vscode.Webview): string {
        // Resolve resources from media directory
        const constantsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'js', 'Constants.js'));
        const domUtilsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'js', 'DOMUtils.js'));
        const appStateUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'js', 'AppState.js'));
        const markdownFormatterUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'js', 'MarkdownFormatter.js'));
        const ipcBridgeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'js', 'WebviewIPCBridge.js'));
        const fileSummaryWidgetUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'js', 'FileSummaryWidget.js'));
        const modelDropdownControllerUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'js', 'ModelDropdownController.js'));
        const settingsControllerUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'js', 'SettingsController.js'));
        const historyManagerUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'js', 'HistoryManager.js'));
        const chatUIControllerUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'js', 'ChatUIController.js'));
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.css'));
        const codiconUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css'));

        // Use a nonce to restrict script source access
        const nonce = getNonce();
        const svgs = this._loadSvgs();

        const translations = I18nManager.getTranslations();
        const activeLang = I18nManager.getActiveLanguage();

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <!--
                    Content Security Policy (CSP):
                    Allows loading scripts with the specific nonce and styles/images/fonts from the extension's resources and local server APIs.
                -->
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}'; connect-src *;">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${codiconUri}" rel="stylesheet" />
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
                                            <!-- 2nd Dropdown Container: Gemini Thinking Level -->
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

                            <!-- API Keys Overlay (Positioned inside Settings view, directly under the Settings header) -->
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
                </div>

                <script nonce="${nonce}" src="${constantsUri}"></script>
                <script nonce="${nonce}" src="${domUtilsUri}"></script>
                <script nonce="${nonce}" src="${appStateUri}"></script>
                <script nonce="${nonce}" src="${markdownFormatterUri}"></script>
                <script nonce="${nonce}" src="${ipcBridgeUri}"></script>
                <script nonce="${nonce}" src="${fileSummaryWidgetUri}"></script>
                <script nonce="${nonce}" src="${modelDropdownControllerUri}"></script>
                <script nonce="${nonce}" src="${settingsControllerUri}"></script>
                <script nonce="${nonce}" src="${historyManagerUri}"></script>
                <script nonce="${nonce}" src="${chatUIControllerUri}"></script>
                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }
}

/**
 * Generates a random alphanumeric nonce string to secure script tags.
 * @returns A 32-character random nonce.
 */
function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

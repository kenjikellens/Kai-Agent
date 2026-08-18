import { BrowserWindow, dialog, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { AgentExecutor } from './AgentExecutor';
import { LMStudioClient, FREE_PROVIDERS } from './LMStudioClient';
import { LMStudioManifestParser } from './providers/LMStudioManifestParser';
import { I18nManager } from './i18n';
import { SessionStore } from './SessionStore';
import { WorkspaceManager } from './WorkspaceManager';
import { ConfigManager } from './ConfigManager';

/**
 * AppHost coordinates bidirectional IPC messaging between the Electron Main process
 * and the Webview UI (Renderer process), handling agent runs, model discovery,
 * file picking, settings updates, and chat history.
 */
export class AppHost {
    private window: BrowserWindow;
    private workspaceManager: WorkspaceManager;
    private sessionStore: SessionStore;
    private configManager: ConfigManager;
    private activeAbortController?: AbortController;
    private currentStreamingText: string = '';
    private currentStreamingMessages: any[] = [];

    /**
     * Initializes a new instance of AppHost.
     * @param window The main Electron BrowserWindow.
     * @param workspaceManager Active workspace manager instance.
     */
    constructor(window: BrowserWindow, workspaceManager: WorkspaceManager) {
        this.window = window;
        this.workspaceManager = workspaceManager;
        this.sessionStore = new SessionStore();
        this.configManager = ConfigManager.getInstance();
    }

    /**
     * Sends a message payload to the Renderer Webview process.
     * @param message Message payload object.
     */
    public postMessage(message: any): void {
        if (!this.window.isDestroyed() && this.window.webContents) {
            this.window.webContents.send('kai-message', message);
        }
    }

    /**
     * Dispatches incoming IPC messages from the renderer process.
     * @param data Incoming message payload.
     */
    public async handleMessage(data: any): Promise<void> {
        if (!data || !data.type) return;

        switch (data.type) {
            case 'sendMessage': {
                await this.handleSendMessage(
                    data.messages,
                    data.model,
                    data.thinking,
                    data.geminiThinkingLevel || 'high',
                    data.planningMode || false,
                    data.attachedFiles || []
                );
                break;
            }
            case 'abort': {
                if (this.activeAbortController) {
                    this.activeAbortController.abort();
                    this.activeAbortController = undefined;
                }
                break;
            }
            case 'checkConnection': {
                await this.handleCheckConnection();
                break;
            }
            case 'updateSettings': {
                const updates: any = {};

                if (data.serverUrl !== undefined) updates.serverUrl = data.serverUrl;
                if (data.lmStudioCacheDir !== undefined) updates.lmStudioCacheDir = data.lmStudioCacheDir;
                if (data.apiKey !== undefined) {
                    updates.apiKey = data.apiKey;
                }
                if (data.language !== undefined) updates.language = data.language;

                if (data.providerKeys && typeof data.providerKeys === 'object') {
                    for (const [configKey, keyValue] of Object.entries(data.providerKeys)) {
                        updates[configKey] = keyValue;
                    }
                }
                if (Array.isArray(data.freeProviders)) {
                    for (const p of data.freeProviders) {
                        if (p.configKey && p.apiKey !== undefined) {
                            updates[p.configKey] = p.apiKey;
                        }
                    }
                }

                this.configManager.update(updates);
                await this.handleCheckConnection();
                break;
            }
            case 'browseLMStudioFolder': {
                await this.handleBrowseLMStudioFolder();
                break;
            }
            case 'browseWorkspaceFolder': {
                await this.handleBrowseWorkspaceFolder();
                break;
            }
            case 'openFilePicker': {
                await this.handleOpenFilePicker();
                break;
            }
            case 'saveChat': {
                if (data.chat && (data.chat.messages?.length > 0 || data.chat.uiEvents?.length > 0)) {
                    await this.sessionStore.saveChat(data.chat);
                    const chatsList = this.sessionStore.getHistoryList();
                    this.postMessage({
                        type: 'chatHistory',
                        chats: chatsList
                    });
                }
                break;
            }
            case 'loadChatHistory': {
                const chatsList = this.sessionStore.getHistoryList();
                this.postMessage({
                    type: 'chatHistory',
                    chats: chatsList
                });
                break;
            }
            case 'deleteChat': {
                if (data.chatId) {
                    const updatedList = await this.sessionStore.deleteChat(data.chatId);
                    this.postMessage({
                        type: 'chatHistory',
                        chats: updatedList
                    });
                }
                break;
            }
            case 'loadChat': {
                if (data.chatId) {
                    const chat = this.sessionStore.getChat(data.chatId);
                    if (chat) {
                        this.postMessage({
                            type: 'loadChat',
                            chat: chat
                        });
                    }
                }
                break;
            }
            case 'openFile': {
                if (data.filePath) {
                    const absPath = this.workspaceManager.resolvePath(data.filePath);
                    if (fs.existsSync(absPath)) {
                        shell.openPath(absPath);
                    }
                }
                break;
            }
            case 'openFilePicker': {
                await this.handleOpenFilePicker();
                break;
            }
            case 'openExternal': {
                if (data.url) {
                    shell.openExternal(data.url);
                }
                break;
            }
        }
    }

    /**
     * Handles agent execution on user prompt.
     */
    private async handleSendMessage(
        messages: { role: string; content: string }[],
        model?: string,
        thinking: boolean = true,
        geminiThinkingLevel: string = 'high',
        planningMode: boolean = false,
        attachedFiles: any[] = []
    ): Promise<void> {
        const workspacePath = this.workspaceManager.getWorkspacePath();
        const appPath = path.resolve(__dirname, '../..');
        const config = this.configManager.getConfig();
        const serverUrl = config.serverUrl || 'http://localhost:1234/v1';

        this.activeAbortController = new AbortController();

        const executor = new AgentExecutor(
            workspacePath,
            appPath,
            serverUrl,
            0.2,
            (event) => {
                this.postMessage({
                    type: 'agentProgress',
                    progressType: event.type,
                    text: event.text || event.output,
                    tool: event.tool,
                    query: event.query,
                    output: event.output,
                    toolId: event.toolId,
                    fileName: event.fileName
                });
            }
        );

        this.currentStreamingText = '';
        this.currentStreamingMessages = messages;

        try {
            const userPrompt = messages.length > 0 ? messages[messages.length - 1].content : '';
            const history = messages.slice(0, -1);

            const result = await executor.run(
                userPrompt,
                history,
                model || 'local-model',
                this.activeAbortController.signal,
                undefined,
                thinking,
                geminiThinkingLevel,
                planningMode,
                attachedFiles
            );

            this.postMessage({
                type: 'reply',
                content: result.reply,
                modifiedFiles: result.modifiedFiles
            });
        } catch (error: any) {
            if (error.name === 'AbortError') {
                return;
            }
            this.postMessage({
                type: 'replyError',
                message: error.message || 'Error occurred during execution.'
            });
        } finally {
            this.activeAbortController = undefined;
            this.currentStreamingText = '';
        }
    }

    /**
     * Checks LLM server, Gemini, and cloud provider connectivity in parallel.
     */
    public async handleCheckConnection(): Promise<void> {
        const config = this.configManager.getConfig();
        const serverUrl = config.serverUrl || 'http://localhost:1234/v1';
        const apiKey = (config.apiKey || '').trim();
        const translations = I18nManager.getTranslations();
        const activeLang = I18nManager.getActiveLanguage();
        const workspacePath = this.workspaceManager.getWorkspacePath();

        const buildFreeProviders = () => {
            return FREE_PROVIDERS.map(p => ({
                name: p.name,
                configKey: p.configKey,
                keyHint: p.keyHint,
                models: p.models,
                apiKey: ((config as any)[p.configKey] || '').trim(),
                connected: false
            }));
        };

        const client = new LMStudioClient(serverUrl, apiKey);
        const rawFreeProviders = buildFreeProviders();

        // Perform fast concurrent validation across local server, Gemini, and cloud providers
        const [lmResult, geminiValidationResult, ...freeValidationResults] = await Promise.allSettled([
            client.getLMStudioModels(),
            apiKey ? client.validateGemini(apiKey) : Promise.resolve(false),
            ...rawFreeProviders.map(p => p.apiKey ? client.validateFreeProvider(p.configKey, p.apiKey) : Promise.resolve(false))
        ]);

        const lmModels = lmResult.status === 'fulfilled' ? lmResult.value : [];
        const lmStudioConnected = lmResult.status === 'fulfilled' && lmModels.length > 0;
        const isGeminiValid = geminiValidationResult.status === 'fulfilled' ? Boolean(geminiValidationResult.value) : false;
        const geminiModels = await client.getGeminiModels();

        const updatedFreeProviders = rawFreeProviders.map((p, idx) => {
            const valRes = freeValidationResults[idx];
            const isConnected = valRes && valRes.status === 'fulfilled' ? Boolean(valRes.value) : false;
            return {
                ...p,
                connected: isConnected
            };
        });

        let loadedModels: string[] = [];
        if (lmStudioConnected) {
            loadedModels = await client.getLoadedModels().catch(() => []);
        } else if (isGeminiValid) {
            loadedModels = [...geminiModels];
        }

        const activeModel = lmModels.length > 0
            ? lmModels[0]
            : (isGeminiValid && geminiModels.length > 0 ? geminiModels[0] : 'local-model');

        const lmStudioCacheDir = config.lmStudioCacheDir || '';
        const lmStudioCacheStatus = LMStudioManifestParser.validateCache(lmStudioCacheDir);
        const lmStudioCapabilities = LMStudioManifestParser.parseModelCapabilities(lmStudioCacheDir);
        const svgs = this._loadSvgs();

        this.postMessage({
            type: 'connectionStatus',
            connected: lmStudioConnected,
            geminiConnected: isGeminiValid,
            model: activeModel,
            lmStudioModels: lmModels,
            geminiModels: geminiModels,
            loadedModels: loadedModels,
            freeProviders: updatedFreeProviders,
            serverUrl: serverUrl,
            apiKey: apiKey,
            lmStudioCacheDir: lmStudioCacheDir,
            lmStudioCacheStatus: lmStudioCacheStatus,
            lmStudioCapabilities: lmStudioCapabilities,
            translations: translations,
            language: activeLang,
            workspacePath: workspacePath,
            workspaceName: path.basename(workspacePath) || workspacePath,
            svgs: svgs
        });
    }

    /**
     * Opens folder picker to select active workspace.
     */
    private async handleBrowseWorkspaceFolder(): Promise<void> {
        const selected = await this.workspaceManager.openWorkspacePicker(this.window);
        if (selected) {
            await this.handleCheckConnection();
        }
    }

    /**
     * Opens folder picker for LM Studio directory.
     */
    private async handleBrowseLMStudioFolder(): Promise<void> {
        const result = await dialog.showOpenDialog(this.window, {
            properties: ['openDirectory'],
            title: 'Select LM Studio Directory'
        });

        if (!result.canceled && result.filePaths.length > 0) {
            const selectedPath = result.filePaths[0];
            this.configManager.update({ lmStudioCacheDir: selectedPath });
            await this.handleCheckConnection();
        }
    }

    /**
     * Opens native file attachment picker.
     */
    private async handleOpenFilePicker(): Promise<void> {
        const result = await dialog.showOpenDialog(this.window, {
            properties: ['openFile', 'multiSelections'],
            title: 'Attach Files',
            filters: [
                { name: 'Code & Text Files', extensions: ['js', 'ts', 'jsx', 'tsx', 'py', 'html', 'css', 'json', 'md', 'txt', 'csv', 'java', 'c', 'cpp', 'rs', 'go', 'php', 'rb', 'sql', 'sh', 'yaml', 'yml', 'xml', 'env', 'toml'] },
                { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }
            ]
        });

        if (result.canceled || result.filePaths.length === 0) {
            return;
        }

        const files: { fileName: string; filePath: string; relativePath: string; content: string }[] = [];
        const workspacePath = this.workspaceManager.getWorkspacePath();

        for (const filePath of result.filePaths) {
            try {
                const stat = fs.statSync(filePath);
                if (stat.size > 2 * 1024 * 1024) continue;

                let relPath = filePath;
                if (workspacePath && filePath.startsWith(workspacePath)) {
                    relPath = path.relative(workspacePath, filePath);
                }

                const fileContent = fs.readFileSync(filePath, 'utf8');
                files.push({
                    fileName: path.basename(filePath),
                    filePath: filePath,
                    relativePath: relPath,
                    content: fileContent
                });
            } catch {
                // ignore
            }
        }

        if (files.length > 0) {
            this.postMessage({
                type: 'filesSelected',
                files: files
            });
        }
    }

    /**
     * Loads SVG icons dynamically from the renderer/media/svg directory on disk.
     * @returns Map of icon names to SVG markup strings.
     */
    private _loadSvgs(): Record<string, string> {
        const candidates = [
            path.resolve(__dirname, '../../src/renderer/media/svg'),
            path.resolve(__dirname, '../renderer/media/svg'),
            path.resolve(process.cwd(), 'src/renderer/media/svg')
        ];

        const svgs: Record<string, string> = {};
        for (const svgDir of candidates) {
            try {
                if (fs.existsSync(svgDir)) {
                    const files = fs.readdirSync(svgDir);
                    for (const file of files) {
                        if (file.endsWith('.svg')) {
                            const name = path.basename(file, '.svg');
                            svgs[name] = fs.readFileSync(path.join(svgDir, file), 'utf8').trim();
                        }
                    }
                    if (Object.keys(svgs).length > 0) {
                        return svgs;
                    }
                }
            } catch (e) {
                console.error('Error loading SVGs in AppHost:', e);
            }
        }
        return svgs;
    }
}

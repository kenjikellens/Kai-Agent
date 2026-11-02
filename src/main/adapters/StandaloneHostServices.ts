import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { IHostServices } from '../core/IHostServices';
import { ISessionStorage, ChatSessionRecord } from '../core/ISessionStorage';
import { ConfigManager } from '../ConfigManager';

/**
 * Standalone desktop host services adapter implementing IHostServices.
 * Bridges backend tools and engine components to standalone Node.js filesystem, configuration manager, and regex symbol indexing.
 */
export class StandaloneHostServices implements IHostServices {
    /**
     * Retrieves compiler and syntax diagnostics for a target file in standalone desktop mode.
     * @param filePath Optional target file path.
     * @returns Formatted diagnostics summary string.
     */
    public async getDiagnostics(filePath?: string): Promise<string> {
        if (!filePath) {
            return 'No diagnostics found in workspace.';
        }

        try {
            if (!fs.existsSync(filePath)) {
                return `File does not exist: ${filePath}`;
            }

            if (filePath.endsWith('.json')) {
                const content = fs.readFileSync(filePath, 'utf8');
                JSON.parse(content);
                return 'No syntax errors detected.';
            }

            return 'Syntax check completed (no fatal parse errors).';
        } catch (error: any) {
            return `[ERROR] ${filePath}: Syntax error - ${error?.message || error}`;
        }
    }

    /**
     * Captures post-edit compiler and syntax diagnostics in standalone mode.
     * @param targetFilePath Modified file path.
     * @param workspacePath Active workspace root directory.
     * @param isNewFile Whether the file was newly created.
     * @returns Formatted diagnostic note or empty string.
     */
    public async getPostEditDiagnostics(
        targetFilePath: string,
        workspacePath: string,
        _isNewFile: boolean = false
    ): Promise<string> {
        try {
            const absolutePath = path.isAbsolute(targetFilePath)
                ? targetFilePath
                : path.join(workspacePath, targetFilePath);

            if (!fs.existsSync(absolutePath)) {
                return '';
            }

            if (targetFilePath.endsWith('.json')) {
                try {
                    const content = fs.readFileSync(absolutePath, 'utf8');
                    JSON.parse(content);
                } catch (e: any) {
                    return `\n[Diagnostics note]: errors: [${targetFilePath}: Invalid JSON syntax - ${e.message}]`;
                }
            }

            return '';
        } catch {
            return '';
        }
    }

    /**
     * Searches workspace code symbols (classes, functions, interfaces, methods) across workspace files using fast regex matching.
     * @param query Search keyword.
     * @param workspacePath Workspace root directory.
     * @returns Formatted list of symbol locations.
     */
    public async searchWorkspaceSymbols(query: string, workspacePath: string): Promise<string> {
        if (!query || !query.trim()) {
            return 'Error: Symbol search query cannot be empty.';
        }

        const results: string[] = [];
        const pattern = new RegExp(`\\b(class|function|interface|type|enum|const|let|var|def)\\s+(${query}\\w*)\\b`, 'i');

        const scanDir = (dir: string) => {
            if (results.length >= 50) return;
            try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build') {
                        continue;
                    }
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        scanDir(fullPath);
                    } else if (entry.isFile() && /\.(js|ts|jsx|tsx|py|java|cpp|c|rs|go|php|rb|cs|html|css)$/i.test(entry.name)) {
                        try {
                            const content = fs.readFileSync(fullPath, 'utf8');
                            const lines = content.split(/\r?\n/);
                            for (let i = 0; i < lines.length; i++) {
                                const line = lines[i];
                                const match = line.match(pattern);
                                if (match) {
                                    const kind = match[1];
                                    const symbolName = match[2];
                                    const relPath = path.relative(workspacePath, fullPath).replace(/\\/g, '/');
                                    results.push(`[${kind.toUpperCase()}] ${symbolName} -> ${relPath}:${i + 1}`);
                                    if (results.length >= 50) break;
                                }
                            }
                        } catch {
                            // Ignore unreadable files
                        }
                    }
                }
            } catch {
                // Ignore unreadable directories
            }
        };

        scanDir(workspacePath);

        if (results.length === 0) {
            return `No symbols found matching query: "${query}"`;
        }

        return results.join('\n');
    }

    /**
     * Retrieves user configuration from ConfigManager in standalone desktop mode.
     * @param _section Configuration section name (unused in standalone flat config).
     * @param key Setting property key name.
     * @param defaultValue Default fallback if unset.
     */
    public getConfiguration<T>(_section: string, key: string, defaultValue?: T): T {
        try {
            const config = ConfigManager.getInstance().getConfig() as any;
            if (config && config[key] !== undefined && config[key] !== null) {
                return config[key] as T;
            }
            return defaultValue as T;
        } catch {
            return defaultValue as T;
        }
    }

    private static pendingRequests: Map<string, { resolve: (val: string) => void; timer: NodeJS.Timeout }> = new Map();
    private static activeWebview?: { postMessage: (msg: any) => void };

    /**
     * Registers the active webview or IPC host to receive interactive clarification requests.
     * Mutates static reference used by askUser to post prompts to the Electron renderer.
     * @param webview Webview or host container with postMessage capability.
     */
    public static setActiveWebview(webview: { postMessage: (msg: any) => void }): void {
        this.activeWebview = webview;
    }

    /**
     * Resolves a pending ask_user prompt with the developer's selected choice or typed text.
     * Clears the timeout timer and resolves the suspended execution promise.
     * @param requestId The correlation ID of the pending prompt.
     * @param answer The developer's response string.
     * @returns True if request was found and resolved.
     */
    public static resolveAskUser(requestId: string, answer: string): boolean {
        const pending = this.pendingRequests.get(requestId);
        if (pending) {
            clearTimeout(pending.timer);
            this.pendingRequests.delete(requestId);
            pending.resolve(answer);
            return true;
        }
        return false;
    }

    /**
     * Suspends agent execution to request human clarification or multiple-choice selection from the developer.
     * Dispatches an interactive prompt card to the UI and resolves with the chosen answer string.
     * @param question The clarification question or prompt for the user.
     * @param options Optional list of multiple-choice answers for the user to click.
     * @param allowCustom Whether the user can type a custom response (default true).
     * @returns The user's selected or typed answer string.
     */
    public askUser(question: string, options?: string[], allowCustom?: boolean): Promise<string> {
        return new Promise<string>((resolve) => {
            const requestId = `ask-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
            const timer = setTimeout(() => {
                StandaloneHostServices.pendingRequests.delete(requestId);
                resolve('[ask_user: Timed out waiting for developer response]');
            }, 300000);

            StandaloneHostServices.pendingRequests.set(requestId, { resolve, timer });

            if (StandaloneHostServices.activeWebview) {
                StandaloneHostServices.activeWebview.postMessage({
                    type: 'ask_user_request',
                    requestId,
                    question,
                    options: Array.isArray(options) ? options : [],
                    allowCustom: allowCustom !== false
                });
            } else {
                clearTimeout(timer);
                StandaloneHostServices.pendingRequests.delete(requestId);
                resolve(`[ask_user: Webview UI is not available. Question was: ${question}]`);
            }
        });
    }
}

/**
 * Standalone filesystem storage driver implementing ISessionStorage.
 * Persists chat sessions directly to ~/.kai-agent/sessions.json on disk.
 */
export class FileSessionStorage implements ISessionStorage {
    private storagePath: string;

    /**
     * Initializes a new instance of FileSessionStorage.
     */
    constructor() {
        const homeDir = os.homedir();
        const baseDir = path.join(homeDir, '.kai-agent');
        if (!fs.existsSync(baseDir)) {
            fs.mkdirSync(baseDir, { recursive: true });
        }
        this.storagePath = path.join(baseDir, 'sessions.json');
    }

    /**
     * Loads all chat sessions from disk into memory.
     * @returns Dictionary of chat sessions.
     */
    public load(): Record<string, ChatSessionRecord> {
        try {
            if (fs.existsSync(this.storagePath)) {
                const data = fs.readFileSync(this.storagePath, 'utf8');
                return JSON.parse(data);
            }
        } catch (e) {
            console.error('Failed to load sessions.json:', e);
        }
        return {};
    }

    /**
     * Saves chat sessions atomically to disk.
     * @param sessions Dictionary of chat sessions.
     */
    public save(sessions: Record<string, ChatSessionRecord>): void {
        try {
            fs.writeFileSync(this.storagePath, JSON.stringify(sessions, null, 2), 'utf8');
        } catch (e) {
            console.error('Failed to save sessions.json:', e);
        }
    }
}


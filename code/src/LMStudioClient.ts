import * as http from 'http';
import * as https from 'https';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Describes a free-tier cloud LLM provider that is OpenAI SDK-compatible.
 * Source: https://github.com/mnfst/awesome-free-llm-apis
 */
export interface FreeProvider {
    /** Display name shown in the model dropdown. */
    name: string;
    /** Base URL for OpenAI-compatible API calls. */
    baseUrl: string;
    /** VS Code configuration key used to read the API key (under the 'kai' namespace). */
    configKey: string;
    /** List of model IDs available on the free tier. */
    models: string[];
    /** Short description shown in the UI placeholder when no API key is set. */
    keyHint: string;
}

/**
 * Static registry of free-tier LLM providers that are OpenAI SDK-compatible.
 * Each provider's models are prefixed with a unique namespace (e.g. "mistral/")
 * so the routing logic can identify them at inference time.
 */
export const FREE_PROVIDERS: FreeProvider[] = [
    {
        name: 'Mistral AI',
        baseUrl: 'https://api.mistral.ai/v1',
        configKey: 'mistralApiKey',
        keyHint: 'Get free key at console.mistral.ai',
        models: [
            'mistral/mistral-medium-3',
            'mistral/mistral-small-latest',
            'mistral/mistral-large-latest',
            'mistral/open-mistral-nemo',
            'mistral/codestral-latest',
            'mistral/pixtral-large-latest'
        ]
    },
    {
        name: 'Cohere',
        baseUrl: 'https://api.cohere.com/v2',
        configKey: 'cohereApiKey',
        keyHint: 'Get free key at dashboard.cohere.com',
        models: [
            'cohere/command-a-plus',
            'cohere/command-a',
            'cohere/command-r-plus',
            'cohere/command-r',
            'cohere/command-r7b-12-2024'
        ]
    },
    {
        name: 'Cerebras',
        baseUrl: 'https://api.cerebras.ai/v1',
        configKey: 'cerebrasApiKey',
        keyHint: 'Get free key at cloud.cerebras.ai',
        models: [
            'cerebras/llama-4-scout-17b-16e-instruct',
            'cerebras/llama-3.3-70b'
        ]
    },
    {
        name: 'Zhipu AI (GLM)',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        configKey: 'zhipuApiKey',
        keyHint: 'Get free key at open.bigmodel.cn',
        models: [
            'zhipu/glm-4-flash',
            'zhipu/glm-4v-flash'
        ]
    },
    {
        name: 'OmniRoute Gateway',
        baseUrl: 'http://localhost:8000/v1',
        configKey: 'omnirouteApiKey',
        keyHint: 'Run OmniRoute via npm: npx omniroute (default: http://localhost:8000/v1)',
        models: [
            'omniroute/auto',
            'omniroute/free-aggregate',
            'omniroute/claude-3-5-sonnet',
            'omniroute/deepseek-r1',
            'omniroute/gpt-4o'
        ]
    }
];

/**
 * LMStudioClient handles communication with the locally running LM Studio HTTP API,
 * cloud-based Google Gemini APIs, and free-tier OpenAI-compatible cloud providers.
 */
export class LMStudioClient {
    private serverUrl: string;
    private apiKey: string;

    /**
     * Initializes a new instance of the LMStudioClient.
     * @param serverUrl The base API URL of LM Studio (e.g. "http://localhost:1234/v1").
     */
    constructor(serverUrl: string, apiKey?: string) {
        this.serverUrl = serverUrl;
        const config = vscode.workspace.getConfiguration('kai');
        this.apiKey = apiKey || config.get<string>('apiKey') || this._getEnvKey('GEMINI_API_KEY') || '';
    }

    /**
     * Helper method to parse the server URL and determine the port and hostname.
     * @returns An object containing the hostname, port, and path prefix.
     */
    private parseServerUrl(): { hostname: string; port: number; pathPrefix: string } {
        try {
            const parsed = new URL(this.serverUrl);
            return {
                hostname: parsed.hostname || 'localhost',
                port: parsed.port ? parseInt(parsed.port, 10) : 80,
                pathPrefix: parsed.pathname.replace(/\/$/, '')
            };
        } catch {
            return { hostname: 'localhost', port: 1234, pathPrefix: '/v1' };
        }
    }

    /**
     * Fetches the list of models currently available across local LM Studio, Gemini, free providers, and OmniRoute.
     * @returns A promise that resolves to an array of model IDs.
     */
    public async getModels(): Promise<string[]> {
        const lmModels = await this.getLMStudioModels().catch(() => []);
        const geminiModels = await this.getGeminiModels(this.apiKey).catch(() => []);
        const freeProviderModels = this.getFreeProviderModels();
        const omniModels = await this.getOmniRouteModels().catch(() => []);
        const combined = new Set([...lmModels, ...geminiModels, ...freeProviderModels, ...omniModels]);
        return Array.from(combined);
    }

    /**
     * Fetches models dynamically from the active OmniRoute gateway instance if reachable.
     */
    public async getOmniRouteModels(): Promise<string[]> {
        return new Promise((resolve) => {
            const config = vscode.workspace.getConfiguration('kai');
            const serverUrl = config.get<string>('omnirouteServerUrl') || 'http://localhost:8000/v1';
            const apiKey = config.get<string>('omnirouteApiKey') || 'omniroute';
            try {
                const parsedUrl = new URL(`${serverUrl.replace(/\/$/, '')}/models`);
                const clientModule = parsedUrl.protocol === 'https:' ? https : http;
                const options: http.RequestOptions = {
                    hostname: parsedUrl.hostname,
                    port: parsedUrl.port ? parseInt(parsedUrl.port, 10) : (parsedUrl.protocol === 'https:' ? 443 : 80),
                    path: parsedUrl.pathname + parsedUrl.search,
                    method: 'GET',
                    timeout: 3000,
                    headers: {
                        'Authorization': `Bearer ${apiKey}`
                    }
                };

                const req = clientModule.request(options, (res) => {
                    let data = '';
                    res.on('data', (chunk) => { data += chunk; });
                    res.on('end', () => {
                        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                            try {
                                const parsed = JSON.parse(data);
                                if (parsed && Array.isArray(parsed.data)) {
                                    const models = parsed.data.map((m: any) => {
                                        const id = m.id || m;
                                        return id.startsWith('omniroute/') ? id : `omniroute/${id}`;
                                    });
                                    resolve(models);
                                    return;
                                }
                            } catch {
                                // ignore parse error
                            }
                        }
                        resolve([]);
                    });
                });

                req.on('error', () => resolve([]));
                req.on('timeout', () => { req.destroy(); resolve([]); });
                req.end();
            } catch {
                resolve([]);
            }
        });
    }

    /**
     * Returns the static list of all model IDs from the registered free-tier cloud providers.
     * These are always available in the dropdown regardless of API key presence;
     * a missing key will produce an error only when the user attempts to chat.
     * @returns A flat array of namespaced model ID strings (e.g. "mistral/mistral-small-latest").
     */
    public getFreeProviderModels(): string[] {
        return FREE_PROVIDERS.flatMap(p => p.models);
    }

    /**
     * Fetches local LM Studio models.
     */
    public async getLMStudioModels(): Promise<string[]> {
        return new Promise((resolve, reject) => {
            const { hostname, port, pathPrefix } = this.parseServerUrl();
            const options: http.RequestOptions = {
                hostname,
                port,
                path: `${pathPrefix}/models`,
                method: 'GET',
                timeout: 1500
            };

            const req = http.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            const parsed = JSON.parse(data);
                            if (parsed && Array.isArray(parsed.data)) {
                                resolve(parsed.data.map((m: any) => m.id));
                            } else {
                                resolve([]);
                            }
                        } catch (err) {
                            reject(new Error('Failed to parse models response JSON'));
                        }
                    } else {
                        reject(new Error(`Server returned HTTP ${res.statusCode}`));
                    }
                });
            });

            req.on('error', (err) => {
                reject(err);
            });

            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Connection timed out while fetching models'));
            });

            req.end();
        });
    }

    /**
     * Fetches the list of models actively loaded in LM Studio VRAM/RAM.
     * @returns A promise that resolves to an array of loaded model IDs.
     */
    public async getLoadedModels(): Promise<string[]> {
        const localLoaded = await this.getLocalLoadedModels().catch(() => []);
        const geminiModels = await this.getGeminiModels(this.apiKey).catch(() => []);
        return [...localLoaded, ...geminiModels];
    }

    /**
     * Fetches loaded LM Studio models.
     */
    private async getLocalLoadedModels(): Promise<string[]> {
        return new Promise((resolve) => {
            const { exec } = require('child_process');
            const os = require('os');
            const path = require('path');
            const fs = require('fs');
            
            let command = 'lms ps --json';
            try {
                const explicitPath = path.join(os.homedir(), '.lmstudio', 'bin', 'lms.exe');
                if (process.platform === 'win32' && fs.existsSync(explicitPath)) {
                    command = `"${explicitPath}" ps --json`;
                }
            } catch (e) {
                // ignore
            }

            exec(command, { timeout: 1500 }, (error: any, stdout: string) => {
                if (error) {
                    resolve([]);
                    return;
                }
                try {
                    const parsed = JSON.parse(stdout);
                    if (Array.isArray(parsed)) {
                        resolve(parsed.map((m: any) => m.modelKey || m.identifier || m.path));
                    } else {
                        resolve([]);
                    }
                } catch (e) {
                    resolve([]);
                }
            });
        });
    }

    /**
     * Sends a chat message history to LM Studio and retrieves the generated response.
     * @param messages An array of chat messages with role ('user' | 'assistant' | 'system') and content.
     * @param model The identifier of the target loaded model (e.g. from /v1/models).
     * @param temperature The sampling temperature (default: 0.7).
     * @returns A promise that resolves to the completion text response.
     */
    public async chatCompletion(
        messages: { role: string; content: string }[],
        model: string = 'local-model',
        temperature: number = 0.7,
        signal?: any
    ): Promise<string> {
        const isGemini = model && model.toLowerCase().startsWith('gemini');
        if (isGemini) {
            return this.chatGemini(messages, model, temperature, signal);
        }

        // Route to a free-tier OpenAI-compatible cloud provider if model is namespaced
        const freeProvider = this._resolveFreeProvider(model);
        if (freeProvider) {
            return this._chatFreeProvider(messages, model, temperature, freeProvider);
        }

        return new Promise((resolve, reject) => {
            const { hostname, port, pathPrefix } = this.parseServerUrl();
            
            // Build the standard OpenAI-compatible payload
            const payload = JSON.stringify({
                model: model,
                messages: messages,
                temperature: temperature,
                stream: false
            });

            const options: http.RequestOptions = {
                hostname,
                port,
                path: `${pathPrefix}/chat/completions`,
                method: 'POST',
                signal: signal,
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload)
                }
            };

            const req = http.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            const parsed = JSON.parse(data);
                            if (parsed && parsed.choices && parsed.choices[0] && parsed.choices[0].message) {
                                resolve(parsed.choices[0].message.content || '');
                            } else {
                                reject(new Error('Invalid response structure from completion API'));
                            }
                        } catch (err) {
                            reject(new Error('Failed to parse completion response JSON'));
                        }
                    } else {
                        reject(new Error(`Server returned HTTP status ${res.statusCode}`));
                    }
                });
            });

            req.on('error', (err) => {
                reject(err);
            });

            req.write(payload);
            req.end();
        });
    }

    /**
     * Sends a chat message history to LM Studio and streams the generated response chunk-by-chunk.
     * @param messages An array of chat messages with role ('user' | 'assistant' | 'system') and content.
     * @param model The identifier of the target loaded model (e.g. from /v1/models).
     * @param temperature The sampling temperature (default: 0.7).
     * @param onToken A callback triggered whenever a new text chunk is received from the server.
     * @param signal An optional AbortSignal to cancel the HTTP request.
     * @returns A promise that resolves to the final concatenated completion text response.
     */
    public async chatCompletionStream(
        messages: { role: string; content: string }[],
        model: string = 'local-model',
        temperature: number = 0.7,
        onToken: (token: string) => void,
        signal?: any,
        thinking: boolean = true
    ): Promise<string> {
        const isGemini = model && model.toLowerCase().startsWith('gemini');
        if (isGemini) {
            return this.chatGeminiStream(messages, model, temperature, onToken, signal, thinking);
        }

        // Route to a free-tier OpenAI-compatible cloud provider if model is namespaced
        const freeProviderForStream = this._resolveFreeProvider(model);
        if (freeProviderForStream) {
            return this._chatFreeProviderStream(messages, model, temperature, onToken, signal, freeProviderForStream);
        }

        let modelIdLower = model.toLowerCase();

        // If the model name is generic, dynamically query the active loaded models from the server
        if (modelIdLower === 'local-model' || modelIdLower === 'active gui model') {
            try {
                const models = await this.getModels();
                if (models && models.length > 0) {
                    modelIdLower = models[0].toLowerCase();
                }
            } catch {
                // Ignore and fallback to generic handling
            }
        }

        return new Promise((resolve, reject) => {
            const { hostname, port, pathPrefix } = this.parseServerUrl();
            
            // Build the standard OpenAI-compatible payload with stream: true
            const requestParams: any = {
                model: model,
                messages: messages,
                temperature: temperature,
                stream: true
            };

            if (!thinking) {
                // 1. Standard thinking toggle (Gemma, general)
                requestParams.thinking = false;
                
                // 2. Qwen, GLM, DeepSeek, Gemma, and template-based thinking parameters
                requestParams.enable_thinking = false;
                requestParams.chat_template_kwargs = {
                    enable_thinking: false
                };

                // 3. OpenAI-spec compatible reasoning effort (for newer LM Studio models)
                requestParams.reasoning_effort = "none";
                requestParams.reasoning = "off";
            } else {
                requestParams.thinking = true;
                requestParams.enable_thinking = true;
                requestParams.chat_template_kwargs = {
                    enable_thinking: true
                };
            }

            const payload = JSON.stringify(requestParams);

            const options: http.RequestOptions = {
                hostname,
                port,
                path: `${pathPrefix}/chat/completions`,
                method: 'POST',
                signal: signal,
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload)
                }
            };

            const req = http.request(options, (res) => {
                if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
                    reject(new Error(`Server returned HTTP status ${res.statusCode}`));
                    return;
                }

                let buffer = '';
                let fullText = '';
                let inThinking = false;

                const processParsedChunk = (parsed: any) => {
                    if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta) {
                        const delta = parsed.choices[0].delta;
                        
                        // Handle reasoning content (thinking)
                        if (delta.reasoning_content !== undefined && delta.reasoning_content !== null) {
                            let text = '';
                            if (!inThinking) {
                                text += '<think>';
                                inThinking = true;
                            }
                            text += delta.reasoning_content;
                            fullText += text;
                            onToken(text);
                        } 
                        // Handle regular content
                        else if (delta.content !== undefined && delta.content !== null) {
                            let text = '';
                            if (inThinking) {
                                text += '</think>';
                                inThinking = false;
                            }
                            text += delta.content;
                            fullText += text;
                            onToken(text);
                        }
                    }
                };

                res.on('data', (chunk) => {
                    buffer += chunk.toString();
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || ''; // Keep the last incomplete line

                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed) {
                            continue;
                        }
                        if (trimmed === 'data: [DONE]') {
                            continue;
                        }
                        if (trimmed.startsWith('data: ')) {
                            try {
                                const parsed = JSON.parse(trimmed.slice(6));
                                processParsedChunk(parsed);
                            } catch (err) {
                                // Ignore json parse errors for incomplete lines
                            }
                        }
                    }
                });

                res.on('end', () => {
                    // Process any remaining data in the buffer
                    if (buffer.trim().startsWith('data: ')) {
                        try {
                            const trimmed = buffer.trim();
                            if (trimmed !== 'data: [DONE]') {
                                const parsed = JSON.parse(trimmed.slice(6));
                                processParsedChunk(parsed);
                            }
                        } catch {
                            // ignore
                        }
                    }
                    if (inThinking && thinking) {
                        fullText += '</think>';
                        onToken('</think>');
                        inThinking = false;
                    }
                    resolve(fullText);
                });
            });

            req.on('error', (err) => {
                reject(err);
            });

            req.write(payload);
            req.end();
        });
    }

    // ---------------------------------------------------------------------------
    // Free-tier provider routing helpers
    // ---------------------------------------------------------------------------

    /**
     * Resolves a FreeProvider entry from a namespaced model ID.
     * For example, "mistral/mistral-small-latest" resolves to the Mistral provider.
     * @param model The full namespaced model identifier.
     * @returns The matching FreeProvider, or undefined if the model is not a free provider model.
     */
    private _resolveFreeProvider(model: string): FreeProvider | undefined {
        if (!model) { return undefined; }
        const matched = FREE_PROVIDERS.find(p => p.models.includes(model));
        if (matched) { return matched; }
        if (model.startsWith('omniroute/')) {
            return FREE_PROVIDERS.find(p => p.configKey === 'omnirouteApiKey');
        }
        return undefined;
    }

    /**
     * Strips the provider namespace prefix from a model ID before sending to the API.
     * E.g. "mistral/mistral-small-latest" → "mistral-small-latest".
     * @param model Namespaced model ID.
     * @returns The bare model ID expected by the provider's API.
     */
    private _stripProviderPrefix(model: string): string {
        const slashIdx = model.indexOf('/');
        return slashIdx !== -1 ? model.slice(slashIdx + 1) : model;
    }

    /**
     * Retrieves the base URL for a FreeProvider, supporting custom settings overrides (e.g. for OmniRoute).
     */
    private _getProviderBaseUrl(provider: FreeProvider): string {
        if (provider.configKey === 'omnirouteApiKey') {
            const config = vscode.workspace.getConfiguration('kai');
            const customUrl = config.get<string>('omnirouteServerUrl');
            if (customUrl && customUrl.trim() !== '') {
                return customUrl.trim().replace(/\/$/, '');
            }
        }
        return provider.baseUrl;
    }

    /**
     * Reads the API key for a free-tier provider from VS Code's extension settings.
     * @param provider The FreeProvider whose key should be retrieved.
     * @returns The configured API key string, or an empty string if not set.
     */
    private _getProviderApiKey(provider: FreeProvider): string {
        const config = vscode.workspace.getConfiguration('kai');
        let key = config.get<string>(provider.configKey) || '';
        if (!key) {
            const envVarName = provider.configKey.replace('ApiKey', '_API_KEY').toUpperCase();
            key = this._getEnvKey(envVarName);
        }
        if (!key && provider.configKey === 'omnirouteApiKey') {
            key = 'omniroute';
        }
        return key;
    }

    /**
     * Reads an environment variable value from process.env or a workspace .env file.
     */
    private _getEnvKey(keyName: string): string {
        if (process.env[keyName]) {
            return process.env[keyName]!;
        }
        try {
            const folders = vscode.workspace.workspaceFolders;
            if (folders && folders.length > 0) {
                for (const folder of folders) {
                    const envPath = path.join(folder.uri.fsPath, '.env');
                    if (fs.existsSync(envPath)) {
                        const content = fs.readFileSync(envPath, 'utf8');
                        const lines = content.split('\n');
                        for (const line of lines) {
                            const trimmed = line.trim();
                            if (!trimmed || trimmed.startsWith('#')) {
                                continue;
                            }
                            const eqIdx = trimmed.indexOf('=');
                            if (eqIdx !== -1) {
                                const k = trimmed.slice(0, eqIdx).trim();
                                const v = trimmed.slice(eqIdx + 1).trim();
                                if (k === keyName) {
                                    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
                                        return v.slice(1, -1);
                                    }
                                    return v;
                                }
                            }
                        }
                    }
                }
            }
        } catch (e) {
            // Ignore errors
        }
        return '';
    }

    /**
     * Sends a non-streaming chat completion request to a free-tier OpenAI-compatible provider.
     * Constructs a standard POST /chat/completions request using the provider's base URL and API key.
     * @param messages Chat message history.
     * @param model Namespaced model ID (e.g. "mistral/mistral-small-latest").
     * @param temperature Sampling temperature.
     * @param provider Resolved FreeProvider configuration.
     * @returns The assistant's reply text.
     */
    private _chatFreeProvider(
        messages: { role: string; content: string }[],
        model: string,
        temperature: number,
        provider: FreeProvider
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            const apiKey = this._getProviderApiKey(provider);
            if (!apiKey) {
                reject(new Error(`No API key configured for ${provider.name}. Add it in Settings.`));
                return;
            }

            const bareModel = this._stripProviderPrefix(model);
            const payload = JSON.stringify({
                model: bareModel,
                messages,
                temperature,
                stream: false
            });

            const baseUrl = this._getProviderBaseUrl(provider);
            const parsedUrl = new URL(`${baseUrl}/chat/completions`);
            const clientModule = parsedUrl.protocol === 'https:' ? https : http;
            const options: http.RequestOptions = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port ? parseInt(parsedUrl.port, 10) : (parsedUrl.protocol === 'https:' ? 443 : 80),
                path: parsedUrl.pathname + parsedUrl.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                    'Authorization': `Bearer ${apiKey}`
                }
            };

            const req = clientModule.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            const parsed = JSON.parse(data);
                            resolve(parsed.choices?.[0]?.message?.content || '');
                        } catch {
                            reject(new Error(`Failed to parse response from ${provider.name}`));
                        }
                    } else {
                        try {
                            const parsed = JSON.parse(data);
                            reject(new Error(parsed.message || parsed.error?.message || `${provider.name} returned HTTP ${res.statusCode}`));
                        } catch {
                            reject(new Error(`${provider.name} returned HTTP ${res.statusCode}`));
                        }
                    }
                });
            });

            req.on('error', reject);
            req.write(payload);
            req.end();
        });
    }

    /**
     * Sends a streaming chat completion request to a free-tier OpenAI-compatible provider.
     * Parses Server-Sent Events (SSE) line-by-line and forwards tokens via the onToken callback.
     * @param messages Chat message history.
     * @param model Namespaced model ID.
     * @param temperature Sampling temperature.
     * @param onToken Callback invoked for each streamed text chunk.
     * @param signal Optional AbortSignal.
     * @param provider Resolved FreeProvider configuration.
     * @returns The fully assembled response text.
     */
    private _chatFreeProviderStream(
        messages: { role: string; content: string }[],
        model: string,
        temperature: number,
        onToken: (token: string) => void,
        signal: any,
        provider: FreeProvider
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            const apiKey = this._getProviderApiKey(provider);
            if (!apiKey) {
                reject(new Error(`No API key configured for ${provider.name}. Add it in Settings.`));
                return;
            }

            const bareModel = this._stripProviderPrefix(model);
            const payload = JSON.stringify({
                model: bareModel,
                messages,
                temperature,
                stream: true
            });

            const baseUrl = this._getProviderBaseUrl(provider);
            const parsedUrl = new URL(`${baseUrl}/chat/completions`);
            const clientModule = parsedUrl.protocol === 'https:' ? https : http;
            const options: http.RequestOptions = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port ? parseInt(parsedUrl.port, 10) : (parsedUrl.protocol === 'https:' ? 443 : 80),
                path: parsedUrl.pathname + parsedUrl.search,
                method: 'POST',
                signal,
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                    'Authorization': `Bearer ${apiKey}`
                }
            };

            const req = clientModule.request(options, (res) => {
                if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
                    let errData = '';
                    res.on('data', (d) => errData += d);
                    res.on('end', () => {
                        try {
                            const parsed = JSON.parse(errData);
                            reject(new Error(parsed.message || parsed.error?.message || `${provider.name} returned HTTP ${res.statusCode}`));
                        } catch {
                            reject(new Error(`${provider.name} returned HTTP ${res.statusCode}`));
                        }
                    });
                    return;
                }

                let buffer = '';
                let fullText = '';
                let inThinking = false;

                res.on('data', (chunk) => {
                    buffer += chunk.toString();
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed || trimmed === 'data: [DONE]') { continue; }
                        if (trimmed.startsWith('data: ')) {
                            try {
                                const parsed = JSON.parse(trimmed.slice(6));
                                const delta = parsed.choices?.[0]?.delta;
                                if (delta) {
                                    if (delta.reasoning_content !== undefined && delta.reasoning_content !== null) {
                                        let text = '';
                                        if (!inThinking) {
                                            text += '<think>';
                                            inThinking = true;
                                        }
                                        text += delta.reasoning_content;
                                        fullText += text;
                                        onToken(text);
                                    } else if (delta.content !== undefined && delta.content !== null) {
                                        let text = '';
                                        if (inThinking) {
                                            text += '</think>';
                                            inThinking = false;
                                        }
                                        text += delta.content;
                                        fullText += text;
                                        onToken(text);
                                    }
                                }
                            } catch {
                                // Skip incomplete SSE lines
                            }
                        }
                    }
                });

                res.on('end', () => {
                    if (inThinking) {
                        onToken('</think>');
                        fullText += '</think>';
                        inThinking = false;
                    }
                    resolve(fullText);
                });
            });

            req.on('error', reject);
            req.write(payload);
            req.end();
        });
    }

    /**
     * Fetches the list of models from Gemini API.
     * @param apiKey The Gemini API Key.
     * @returns A promise resolving to a list of model IDs.
     */
    public async getGeminiModels(apiKey: string): Promise<string[]> {
        const allowedModels = [
            'gemini-3.6-flash',
            'gemini-3.5-flash',
            'gemini-3.5-flash-lite',
            'gemini-3-flash-preview',
            'gemini-3.1-pro-preview',
            'gemini-3.1-flash-lite',
        ];

        return new Promise((resolve) => {
            if (!apiKey) {
                resolve(allowedModels);
                return;
            }

            const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
            try {
                const parsedUrl = new URL(url);
                const options: https.RequestOptions = {
                    hostname: parsedUrl.hostname,
                    path: parsedUrl.pathname + parsedUrl.search,
                    method: 'GET',
                    timeout: 2500
                };

                const req = https.request(options, (res) => {
                    let data = '';
                    res.on('data', (chunk) => {
                        data += chunk;
                    });
                    res.on('end', () => {
                        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                            try {
                                const parsed = JSON.parse(data);
                                if (parsed && Array.isArray(parsed.models)) {
                                    const models = parsed.models
                                        .filter((m: any) => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'))
                                        .map((m: any) => m.name.replace(/^models\//, ''))
                                        .filter((name: string) => allowedModels.includes(name.toLowerCase()));
                                    
                                    if (models.length > 0) {
                                        resolve(models);
                                        return;
                                    }
                                }
                            } catch (err) {
                                // ignore error, fallback below
                            }
                        }
                        resolve(allowedModels);
                    });
                });

                req.on('error', () => {
                    resolve(allowedModels);
                });

                req.on('timeout', () => {
                    req.destroy();
                    resolve(allowedModels);
                });

                req.end();
            } catch {
                resolve(allowedModels);
            }
        });
    }

    /**
     * Calls Gemini non-streaming API to get chat response.
     */
    private async chatGemini(
        messages: { role: string; content: string }[],
        model: string,
        temperature: number,
        signal?: any
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            const apiKey = this.apiKey;
            if (!apiKey) {
                reject(new Error('Gemini API key is not configured in settings. Please add your API key.'));
                return;
            }

            const modelParam = model || 'gemini-3.1-flash-lite';
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelParam}:generateContent?key=${apiKey}`;

            const contents = messages
                .filter(m => m.role !== 'system')
                .map(m => ({
                    role: m.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: m.content }]
                }));

            const systemMsg = messages.find(m => m.role === 'system');
            const systemInstruction = systemMsg ? {
                parts: [{ text: systemMsg.content }]
            } : undefined;

            const requestBody: any = {
                contents: contents,
                generationConfig: {
                    temperature: temperature,
                    thinkingConfig: {
                        thinking_level: 'HIGH'
                    }
                }
            };

            if (systemInstruction) {
                requestBody.systemInstruction = systemInstruction;
            }

            const payload = JSON.stringify(requestBody);

            try {
                const parsedUrl = new URL(url);
                const options: https.RequestOptions = {
                    hostname: parsedUrl.hostname,
                    path: parsedUrl.pathname + parsedUrl.search,
                    method: 'POST',
                    signal: signal,
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(payload)
                    }
                };

                const req = https.request(options, (res) => {
                    let data = '';
                    res.on('data', (d) => data += d);
                    res.on('end', () => {
                        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                            try {
                                const parsed = JSON.parse(data);
                                if (parsed.candidates && parsed.candidates[0].content && parsed.candidates[0].content.parts) {
                                    const parts = parsed.candidates[0].content.parts;
                                    let fullText = '';
                                    for (const part of parts) {
                                        if (part.text) {
                                            fullText += part.text;
                                        }
                                    }
                                    resolve(fullText);
                                } else {
                                    reject(new Error('Invalid response structure from Gemini API'));
                                }
                            } catch {
                                reject(new Error('Failed to parse Gemini response JSON'));
                            }
                        } else {
                            try {
                                const parsed = JSON.parse(data);
                                reject(new Error(parsed.error?.message || `Gemini returned HTTP status ${res.statusCode}`));
                            } catch {
                                reject(new Error(`Gemini returned HTTP status ${res.statusCode}`));
                            }
                        }
                    });
                });

                req.on('error', (err) => {
                    reject(err);
                });

                req.write(payload);
                req.end();
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Calls Gemini streaming API and parses the response chunk-by-chunk.
     */
    private async chatGeminiStream(
        messages: { role: string; content: string }[],
        model: string,
        temperature: number,
        onToken: (token: string) => void,
        signal?: any,
        thinking: boolean = true
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            const apiKey = this.apiKey;
            if (!apiKey) {
                reject(new Error('Gemini API key is not configured in settings. Please add your API key.'));
                return;
            }

            const modelParam = model || 'gemini-3.1-flash-lite';
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelParam}:streamGenerateContent?key=${apiKey}`;

            const contents = messages
                .filter(m => m.role !== 'system')
                .map(m => ({
                    role: m.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: m.content }]
                }));

            const systemMsg = messages.find(m => m.role === 'system');
            const systemInstruction = systemMsg ? {
                parts: [{ text: systemMsg.content }]
            } : undefined;

            const generationConfig: any = {
                temperature: temperature
            };

            // If thinking toggle is checked in the UI and the model supports it, enable it.
            // In Gemini 3+ API, setting thinkingConfig with thinking_level controls reasoning.
            generationConfig.thinkingConfig = {
                thinking_level: thinking ? 'HIGH' : 'MINIMAL'
            };

            const requestBody: any = {
                contents: contents,
                generationConfig: generationConfig
            };

            if (systemInstruction) {
                requestBody.systemInstruction = systemInstruction;
            }

            const payload = JSON.stringify(requestBody);

            try {
                const parsedUrl = new URL(url);
                const options: https.RequestOptions = {
                    hostname: parsedUrl.hostname,
                    path: parsedUrl.pathname + parsedUrl.search,
                    method: 'POST',
                    signal: signal,
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(payload)
                    }
                };

                const req = https.request(options, (res) => {
                    if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
                        let errData = '';
                        res.on('data', (d) => errData += d);
                        res.on('end', () => {
                            try {
                                const parsed = JSON.parse(errData);
                                reject(new Error(parsed.error?.message || `Gemini returned HTTP status ${res.statusCode}`));
                            } catch {
                                reject(new Error(`Gemini returned HTTP status ${res.statusCode}`));
                            }
                        });
                        return;
                    }

                    let buffer = '';
                    let fullText = '';
                    let inThinking = false;

                    res.on('data', (chunk) => {
                        buffer += chunk.toString();
                        let startIdx = 0;
                        while (true) {
                            const openBrace = buffer.indexOf('{', startIdx);
                            if (openBrace === -1) break;

                            let depth = 0;
                            let foundMatch = false;
                            let endBrace = -1;
                            let inString = false;
                            let escape = false;

                            for (let i = openBrace; i < buffer.length; i++) {
                                const char = buffer[i];
                                if (escape) {
                                    escape = false;
                                    continue;
                                }
                                if (char === '\\') {
                                    escape = true;
                                    continue;
                                }
                                if (char === '"') {
                                    inString = !inString;
                                    continue;
                                }
                                if (!inString) {
                                    if (char === '{') {
                                        depth++;
                                    } else if (char === '}') {
                                        depth--;
                                        if (depth === 0) {
                                            endBrace = i;
                                            foundMatch = true;
                                            break;
                                        }
                                    }
                                }
                            }

                            if (foundMatch) {
                                const jsonStr = buffer.substring(openBrace, endBrace + 1);
                                try {
                                    const data = JSON.parse(jsonStr);
                                    if (data.candidates && data.candidates[0].content && data.candidates[0].content.parts) {
                                        const parts = data.candidates[0].content.parts;
                                        for (const part of parts) {
                                            if (part.text) {
                                                if (inThinking) {
                                                    onToken('</think>');
                                                    fullText += '</think>';
                                                    inThinking = false;
                                                }
                                                onToken(part.text);
                                                fullText += part.text;
                                            } else if (part.thought) {
                                                if (!inThinking) {
                                                    onToken('<think>');
                                                    fullText += '<think>';
                                                    inThinking = true;
                                                }
                                                onToken(part.thought);
                                                fullText += part.thought;
                                            }
                                        }
                                    }
                                    startIdx = endBrace + 1;
                                } catch (e) {
                                    // Parse failed (e.g. due to incomplete chunk), wait for more data
                                    break;
                                }
                            } else {
                                break;
                            }
                        }
                        if (startIdx > 0) {
                            buffer = buffer.substring(startIdx);
                        }
                    });

                    res.on('end', () => {
                        if (inThinking) {
                            onToken('</think>');
                            fullText += '</think>';
                            inThinking = false;
                        }
                        resolve(fullText);
                    });
                });

                req.on('error', (err) => {
                    reject(err);
                });

                req.write(payload);
                req.end();
            } catch (err) {
                reject(err);
            }
        });
    }
}

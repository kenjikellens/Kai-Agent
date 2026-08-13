import * as http from 'http';
import * as vscode from 'vscode';
import { HttpClient } from './HttpClient';
import { ILLMProvider } from './providers/ILLMProvider';
import { GeminiClient } from './providers/GeminiClient';
import { FreeProviderClient, FREE_PROVIDERS, FreeProvider } from './providers/FreeProviderClient';
import { MuseGlimmerStreamParser } from './providers/MuseGlimmerStreamParser';

// Re-export FreeProvider & FREE_PROVIDERS for backward compatibility across modules
export { FreeProvider, FREE_PROVIDERS };

/**
 * LMStudioClient handles communication with the locally running LM Studio HTTP API server.
 */
export class LMStudioClient implements ILLMProvider {
    /** Local models retain the existing text-based tool-call protocol. */
    public supportsNativeFunctionCalling(): boolean {
        return false;
    }
    private serverUrl: string;
    private apiKey: string;
    private geminiClient: GeminiClient;
    private freeProviderClient: FreeProviderClient;

    /**
     * Initializes a new instance of LMStudioClient.
     * @param serverUrl Base API URL of LM Studio (default: "http://localhost:1234/v1").
     * @param apiKey Optional API key.
     */
    constructor(serverUrl?: string, apiKey?: string) {
        const config = vscode.workspace.getConfiguration('kai');
        this.serverUrl = serverUrl || config.get<string>('serverUrl') || 'http://localhost:1234/v1';
        this.apiKey = apiKey || config.get<string>('apiKey') || process.env.GEMINI_API_KEY || '';
        this.geminiClient = new GeminiClient(this.apiKey);
        this.freeProviderClient = new FreeProviderClient();
    }

    /**
     * Parses the server URL into hostname, port, and path prefix.
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
     * Retrieves all available models across local LM Studio, Gemini, and free providers.
     * @returns Array of model ID strings.
     */
    public async getModels(): Promise<string[]> {
        const lmModels = await this.getLMStudioModels().catch(() => []);
        const geminiModels = await this.geminiClient.getModels().catch(() => []);
        const freeProviderModels = await this.freeProviderClient.getModels().catch(() => []);
        const omniModels = await this.getOmniRouteModels().catch(() => []);
        const combined = new Set([...lmModels, ...geminiModels, ...freeProviderModels, ...omniModels]);
        return Array.from(combined);
    }

    /**
     * Returns OmniRoute model list.
     */
    public async getOmniRouteModels(): Promise<string[]> {
        return ['omniroute/auto'];
    }

    /**
     * Returns list of free provider models.
     */
    public getFreeProviderModels(): string[] {
        return FREE_PROVIDERS.flatMap(p => p.models);
    }

    /**
     * Fetches local LM Studio models via HTTP GET /models.
     */
    public async getLMStudioModels(): Promise<string[]> {
        const { hostname, port, pathPrefix } = this.parseServerUrl();
        const url = `http://${hostname}:${port}${pathPrefix}/models`;
        try {
            const res = await HttpClient.getJson<{ data: any[] }>(url, {}, 1500);
            if (res && Array.isArray(res.data)) {
                return res.data.map((m: any) => m.id);
            }
            return [];
        } catch {
            return [];
        }
    }

    /**
     * Fetches models currently loaded in LM Studio or Gemini.
     */
    public async getLoadedModels(): Promise<string[]> {
        const localLoaded = await this.getLocalLoadedModels().catch(() => []);
        const geminiModels = await this.geminiClient.getModels().catch(() => []);
        return [...localLoaded, ...geminiModels];
    }

    /**
     * Queries local loaded LM Studio models via lms CLI or process.
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
            } catch {
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
                } catch {
                    resolve([]);
                }
            });
        });
    }

    /**
     * Delegated method for getGeminiModels.
     */
    public async getGeminiModels(_apiKey?: string): Promise<string[]> {
        return this.geminiClient.getModels();
    }

    /**
     * Sends non-streaming chat completion to local LM Studio server.
     */
    public async chatCompletion(
        messages: { role: string; content: string }[],
        model: string = 'local-model',
        temperature: number = 0.7,
        signal?: any,
        thinking: boolean = true,
        geminiThinkingLevel: string = 'high'
    ): Promise<string> {
        if (model && model.toLowerCase().startsWith('gemini')) {
            return this.geminiClient.chatCompletion(messages, model, temperature, signal, thinking, geminiThinkingLevel);
        }

        const freeProvider = this.freeProviderClient.resolveFreeProvider(model);
        if (freeProvider) {
            return this.freeProviderClient.chatCompletion(messages, model, temperature, signal, thinking, geminiThinkingLevel);
        }

        return new Promise((resolve, reject) => {
            const { hostname, port, pathPrefix } = this.parseServerUrl();
            
            const requestParams: any = {
                model: model,
                messages: messages,
                temperature: temperature,
                stream: false
            };

            this.applyThinkingParameters(requestParams, model, thinking);

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
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            const parsed = JSON.parse(data);
                            if (parsed && parsed.choices && parsed.choices[0] && parsed.choices[0].message) {
                                const rawContent = parsed.choices[0].message.content || '';
                                if (MuseGlimmerStreamParser.isMuseGlimmerModel(model) || MuseGlimmerStreamParser.hasMuseGlimmerMarkers(rawContent)) {
                                    resolve(MuseGlimmerStreamParser.parseCompleteResponse(rawContent, thinking));
                                } else {
                                    resolve(rawContent);
                                }
                            } else {
                                reject(new Error('Invalid response structure from completion API'));
                            }
                        } catch {
                            reject(new Error('Failed to parse completion response JSON'));
                        }
                    } else {
                        reject(new Error(`Server returned HTTP status ${res.statusCode}`));
                    }
                });
            });

            req.on('error', (err) => reject(err));
            req.write(payload);
            req.end();
        });
    }

    /**
     * Sends streaming chat completion to local LM Studio server.
     */
    public async chatCompletionStream(
        messages: { role: string; content: string }[],
        model: string = 'local-model',
        temperature: number = 0.7,
        onToken: (token: string) => void = () => {},
        signal?: any,
        thinking: boolean = true,
        geminiThinkingLevel: string = 'high'
    ): Promise<string> {
        if (model && model.toLowerCase().startsWith('gemini')) {
            return this.geminiClient.chatCompletionStream(messages, model, temperature, onToken, signal, thinking, geminiThinkingLevel);
        }

        const freeProvider = this.freeProviderClient.resolveFreeProvider(model);
        if (freeProvider) {
            return this.freeProviderClient.chatCompletionStream(messages, model, temperature, onToken, signal, thinking, geminiThinkingLevel);
        }

        return new Promise((resolve, reject) => {
            const { hostname, port, pathPrefix } = this.parseServerUrl();
            
            const requestParams: any = {
                model: model,
                messages: messages,
                temperature: temperature,
                stream: true
            };

            this.applyThinkingParameters(requestParams, model, thinking);

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
                const isMuseModel = MuseGlimmerStreamParser.isMuseGlimmerModel(model);
                const museParser = new MuseGlimmerStreamParser(thinking, (token: string) => {
                    fullText += token;
                    onToken(token);
                });
                let isMuseStreaming = isMuseModel;

                const processParsedChunk = (parsed: any) => {
                    if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta) {
                        const delta = parsed.choices[0].delta;
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
                            if (!isMuseStreaming && delta.content.startsWith('to=self<|message|>')) {
                                isMuseStreaming = true;
                            }

                            if (isMuseStreaming) {
                                museParser.processChunk(delta.content);
                            } else {
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
                    }
                };

                res.on('data', (chunk) => {
                    buffer += chunk.toString();
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed || trimmed === 'data: [DONE]') continue;
                        if (trimmed.startsWith('data: ')) {
                            try {
                                const parsed = JSON.parse(trimmed.slice(6));
                                processParsedChunk(parsed);
                            } catch {
                                // ignore partial lines
                            }
                        }
                    }
                });

                res.on('end', () => {
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
                    if (isMuseStreaming) {
                        museParser.finish();
                    } else if (inThinking && thinking) {
                        fullText += '</think>';
                        onToken('</think>');
                        inThinking = false;
                    }
                    resolve(fullText);
                });
            });

            req.on('error', (err) => reject(err));
            req.write(payload);
            req.end();
        });
    }

    /**
     * Dynamically applies thinking/reasoning parameters based on the target model family.
     * @param requestParams Target HTTP payload object.
     * @param model Model ID string.
     * @param thinking Whether thinking phase is enabled.
     */
    private applyThinkingParameters(requestParams: any, model: string, thinking: boolean): void {
        const modelLower = (model || '').toLowerCase();

        if (thinking) {
            if (modelLower.includes('muse') || modelLower.includes('glimmer')) {
                // Muse Glimmer natively emits reasoning tokens; preserve active thinking flags
                requestParams.thinking = true;
            } else if (modelLower.includes('gemma')) {
                requestParams.thinking = true;
            } else if (modelLower.includes('qwen') || modelLower.includes('glm')) {
                requestParams.thinking = true;
                requestParams.enable_thinking = true;
                requestParams.chat_template_kwargs = { enable_thinking: true };
            } else if (modelLower.includes('mistral') || modelLower.includes('codestral')) {
                requestParams.reasoning_effort = 'high';
            } else {
                requestParams.thinking = true;
                requestParams.enable_thinking = true;
                requestParams.reasoning_effort = 'high';
                requestParams.chat_template_kwargs = { enable_thinking: true };
            }
        } else {
            if (modelLower.includes('muse') || modelLower.includes('glimmer')) {
                // Muse Glimmer does not support parameter-level thinking disabling;
                // output is handled and filtered by the client stream transformer.
                requestParams.thinking = false;
                requestParams.reasoning_effort = 'none';
                requestParams.reasoning = 'off';
            } else if (modelLower.includes('gemma')) {
                requestParams.thinking = false;
                requestParams.reasoning_effort = 'none';
                requestParams.reasoning = 'off';
            } else if (modelLower.includes('qwen') || modelLower.includes('glm')) {
                requestParams.thinking = false;
                requestParams.enable_thinking = false;
                requestParams.chat_template_kwargs = { enable_thinking: false };
                requestParams.reasoning_effort = 'none';
                requestParams.reasoning = 'off';
            } else if (modelLower.includes('mistral') || modelLower.includes('codestral')) {
                requestParams.reasoning_effort = 'none';
            } else {
                requestParams.thinking = false;
                requestParams.enable_thinking = false;
                requestParams.chat_template_kwargs = { enable_thinking: false };
                requestParams.reasoning_effort = 'none';
                requestParams.reasoning = 'off';
            }
        }
    }
}

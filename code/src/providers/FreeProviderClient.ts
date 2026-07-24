import * as http from 'http';
import * as https from 'https';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ILLMProvider } from './ILLMProvider';

/**
 * Describes a free-tier cloud LLM provider that is OpenAI SDK-compatible.
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
            'omniroute/auto'
        ]
    }
];

/**
 * FreeProviderClient handles API communication with OpenAI-compatible free tier cloud providers.
 */
export class FreeProviderClient implements ILLMProvider {
    /**
     * Retrieves the complete list of free provider model IDs.
     * @returns A promise resolving to an array of namespaced model ID strings.
     */
    public async getModels(): Promise<string[]> {
        return FREE_PROVIDERS.flatMap(p => p.models);
    }

    /**
     * Resolves a FreeProvider entry from a namespaced model ID.
     * @param model The full namespaced model identifier.
     * @returns The matching FreeProvider, or undefined if not found.
     */
    public resolveFreeProvider(model: string): FreeProvider | undefined {
        if (!model) return undefined;
        const matched = FREE_PROVIDERS.find(p => p.models.includes(model));
        if (matched) return matched;
        if (model.startsWith('omniroute/')) {
            return FREE_PROVIDERS.find(p => p.configKey === 'omnirouteApiKey');
        }
        return undefined;
    }

    /**
     * Strips provider namespace prefix from a model ID string.
     * @param model Namespaced model ID.
     * @returns Bare model ID.
     */
    private _stripProviderPrefix(model: string): string {
        const slashIdx = model.indexOf('/');
        return slashIdx !== -1 ? model.slice(slashIdx + 1) : model;
    }

    /**
     * Resolves provider base URL.
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
     * Reads API key for a free provider from settings or environment.
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
     * Reads environment variable or .env file value.
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
                            if (!trimmed || trimmed.startsWith('#')) continue;
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
        } catch {
            // ignore
        }
        return '';
    }

    /**
     * Executes non-streaming chat completion request for a free cloud provider.
     */
    public async chatCompletion(
        messages: { role: string; content: string }[],
        model: string,
        temperature: number = 0.7,
        signal?: any,
        _thinking?: boolean,
        _geminiThinkingLevel?: string
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            const provider = this.resolveFreeProvider(model);
            if (!provider) {
                reject(new Error(`Unknown provider for model ${model}`));
                return;
            }

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
                signal,
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
     * Executes streaming chat completion request for a free cloud provider.
     */
    public async chatCompletionStream(
        messages: { role: string; content: string }[],
        model: string,
        temperature: number,
        onToken: (token: string) => void,
        signal?: any,
        _thinking?: boolean,
        _geminiThinkingLevel?: string
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            const provider = this.resolveFreeProvider(model);
            if (!provider) {
                reject(new Error(`Unknown provider for model ${model}`));
                return;
            }

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
}

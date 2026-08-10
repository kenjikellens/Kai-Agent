import * as http from 'http';
import * as https from 'https';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ChatMessage, ILLMProvider, NativeToolCall, NativeToolCallResult } from './ILLMProvider';
import { FunctionDeclaration } from '../tools/Tool';
import { normalizeReasoningSegments, ReasoningSegment } from './ReasoningContent';

/**
 * Base abstract class for OpenAI-compatible cloud LLM providers.
 */
export abstract class BaseCloudProviderClient implements ILLMProvider {
    /** Display name of the provider. */
    public abstract readonly name: string;
    /** Default base URL for API endpoints. */
    public abstract readonly baseUrl: string;
    /** VS Code configuration key used to store API key. */
    public abstract readonly configKey: string;
    /** List of supported model identifiers. */
    public abstract readonly models: string[];
    /** Short description shown in UI placeholder. */
    public abstract readonly keyHint: string;
    /** Override only for providers whose endpoint accepts OpenAI-compatible tools. */
    protected readonly nativeFunctionCalling: boolean = false;

    /**
     * Retrieves the supported model IDs for this provider.
     * @returns Array of model ID strings.
     */
    public async getModels(): Promise<string[]> {
        return this.models;
    }

    /** Returns whether this provider has an explicitly supported native tool format. */
    public supportsNativeFunctionCalling(): boolean {
        return this.nativeFunctionCalling;
    }

    /**
     * Checks if this provider supports the given model ID.
     * @param model Model ID string.
     * @returns Boolean indicating whether model belongs to this provider.
     */
    public supportsModel(model: string): boolean {
        if (!model) return false;
        return this.models.includes(model);
    }

    /**
     * Strips provider namespace prefix from model ID string.
     * @param model Namespaced model ID.
     * @returns Bare model ID.
     */
    protected stripProviderPrefix(model: string): string {
        const slashIdx = model.indexOf('/');
        return slashIdx !== -1 ? model.slice(slashIdx + 1) : model;
    }

    /**
     * Resolves the active base URL for API requests.
     * @returns Base URL string.
     */
    protected getProviderBaseUrl(): string {
        if (this.configKey === 'omnirouteApiKey') {
            const config = vscode.workspace.getConfiguration('kai');
            const customUrl = config.get<string>('omnirouteServerUrl');
            if (customUrl && customUrl.trim() !== '') {
                return customUrl.trim().replace(/\/$/, '');
            }
        }
        return this.baseUrl;
    }

    /**
     * Reads the configured API key from VS Code settings or environment.
     * @returns Resolved API key string.
     */
    protected getProviderApiKey(): string {
        const config = vscode.workspace.getConfiguration('kai');
        let key = config.get<string>(this.configKey) || '';
        if (!key) {
            const envVarName = this.configKey.replace('ApiKey', '_API_KEY').toUpperCase();
            key = this.getEnvKey(envVarName);
        }
        if (!key && this.configKey === 'omnirouteApiKey') {
            key = 'omniroute';
        }
        return key;
    }

    /**
     * Searches environment variables or workspace .env files for a key.
     * @param keyName Target environment variable name.
     * @returns API key value or empty string.
     */
    protected getEnvKey(keyName: string): string {
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
     * Prepares request payload object before JSON serialization.
     * @param model Bare or full model identifier.
     * @param messages Chat messages array.
     * @param temperature Temperature float parameter.
     * @param stream Boolean indicating whether response should be streamed.
     * @param thinking Optional thinking toggle flag.
     * @returns Request payload object.
     */
    protected preparePayload(
        model: string,
        messages: { role: string; content: string }[],
        temperature: number,
        stream: boolean,
        _thinking?: boolean
    ): Record<string, any> {
        return {
            model: this.stripProviderPrefix(model),
            messages,
            temperature,
            stream
        };
    }

    /**
     * Executes non-streaming chat completion HTTP POST request.
     */
    public async chatCompletion(
        messages: { role: string; content: string }[],
        model: string,
        temperature: number = 0.7,
        signal?: any,
        thinking?: boolean,
        _geminiThinkingLevel?: string
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            const apiKey = this.getProviderApiKey();
            if (!apiKey) {
                reject(new Error(`No API key configured for ${this.name}. Add it in Settings.`));
                return;
            }

            const requestBody = this.preparePayload(model, messages, temperature, false, thinking);
            const payload = JSON.stringify(requestBody);

            const baseUrl = this.getProviderBaseUrl();
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
                            const message = parsed.choices?.[0]?.message;
                            const segments = this.getContentSegments(message || {});
                            let result = '';
                            let inThinking = false;
                            for (const segment of segments) {
                                if (segment.thinking) {
                                    if (!inThinking) {
                                        result += '<think>';
                                        inThinking = true;
                                    }
                                } else if (inThinking) {
                                    result += '</think>\n\n';
                                    inThinking = false;
                                }
                                result += segment.text;
                            }
                            if (inThinking) result += '</think>';
                            resolve(result);
                        } catch {
                            reject(new Error(`Failed to parse response from ${this.name}`));
                        }
                    } else {
                        try {
                            const parsed = JSON.parse(data);
                            reject(new Error(parsed.message || parsed.error?.message || `${this.name} returned HTTP ${res.statusCode}`));
                        } catch {
                            reject(new Error(`${this.name} returned HTTP ${res.statusCode}`));
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
     * Executes streaming chat completion SSE request.
     */
    public async chatCompletionStream(
        messages: { role: string; content: string }[],
        model: string,
        temperature: number,
        onToken: (token: string) => void,
        signal?: any,
        thinking?: boolean,
        _geminiThinkingLevel?: string
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            const apiKey = this.getProviderApiKey();
            if (!apiKey) {
                reject(new Error(`No API key configured for ${this.name}. Add it in Settings.`));
                return;
            }

            const requestBody = this.preparePayload(model, messages, temperature, true, thinking);
            const payload = JSON.stringify(requestBody);

            const baseUrl = this.getProviderBaseUrl();
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
                            reject(new Error(parsed.message || parsed.error?.message || `${this.name} returned HTTP ${res.statusCode}`));
                        } catch {
                            reject(new Error(`${this.name} returned HTTP ${res.statusCode}`));
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
                                    for (const segment of this.getContentSegments(delta)) {
                                        let text = '';
                                        if (segment.thinking) {
                                            if (!inThinking) {
                                                text += '<think>';
                                                inThinking = true;
                                            }
                                        } else if (inThinking) {
                                            text += '</think>';
                                            inThinking = false;
                                        }
                                        text += segment.text;
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

    /** Streams an OpenAI-compatible chat completion with native function tools. */
    public async chatCompletionStreamWithTools(
        messages: ChatMessage[],
        model: string,
        temperature: number,
        tools: FunctionDeclaration[],
        onToken: (token: string) => void,
        signal?: any,
        thinking?: boolean,
        _geminiThinkingLevel?: string
    ): Promise<NativeToolCallResult> {
        if (!this.supportsNativeFunctionCalling()) {
            throw new Error(`${this.name} does not support native function calling.`);
        }

        return new Promise((resolve, reject) => {
            const apiKey = this.getProviderApiKey();
            if (!apiKey) {
                reject(new Error(`No API key configured for ${this.name}. Add it in Settings.`));
                return;
            }

            const requestBody = this.preparePayload(model, messages, temperature, true, thinking);
            requestBody.tools = tools;
            requestBody.tool_choice = 'auto';
            const payload = JSON.stringify(requestBody);
            const baseUrl = this.getProviderBaseUrl();
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
                    res.on('data', (chunk) => { errData += chunk; });
                    res.on('end', () => {
                        try {
                            const parsed = JSON.parse(errData);
                            reject(new Error(parsed.message || parsed.error?.message || `${this.name} returned HTTP ${res.statusCode}`));
                        } catch {
                            reject(new Error(`${this.name} returned HTTP ${res.statusCode}`));
                        }
                    });
                    return;
                }

                let buffer = '';
                let fullText = '';
                let inThinking = false;
                const toolCalls = new Map<number, NativeToolCall>();

                const processDelta = (delta: any) => {
                    for (const segment of this.getContentSegments(delta)) {
                        let text = '';
                        if (segment.thinking) {
                            if (!inThinking) {
                                text += '<think>';
                                inThinking = true;
                            }
                        } else if (inThinking) {
                            text += '</think>';
                            inThinking = false;
                        }
                        text += segment.text;
                        fullText += text;
                        onToken(text);
                    }

                    for (const partialCall of delta.tool_calls || []) {
                        const index = partialCall.index ?? 0;
                        const call = toolCalls.get(index) || {
                            id: partialCall.id || `call_${index}`,
                            type: 'function' as const,
                            function: { name: '', arguments: '' }
                        };
                        if (partialCall.id) call.id = partialCall.id;
                        if (partialCall.function?.name) call.function.name += partialCall.function.name;
                        if (partialCall.function?.arguments) call.function.arguments += partialCall.function.arguments;
                        toolCalls.set(index, call);
                    }
                };

                res.on('data', (chunk) => {
                    buffer += chunk.toString();
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';
                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed || trimmed === 'data: [DONE]' || !trimmed.startsWith('data: ')) continue;
                        try {
                            processDelta(JSON.parse(trimmed.slice(6)).choices?.[0]?.delta || {});
                        } catch {
                            // Ignore malformed SSE events and wait for the next complete event.
                        }
                    }
                });

                res.on('end', () => {
                    if (inThinking) {
                        fullText += '</think>';
                        onToken('</think>');
                    }
                    if (toolCalls.size > 1) {
                        reject(new Error(`${this.name} returned multiple tool calls; multi-tool execution is not supported yet.`));
                        return;
                    }
                    const toolCall = toolCalls.values().next().value as NativeToolCall | undefined;
                    if (!toolCall) {
                        resolve({ type: 'text', text: fullText });
                        return;
                    }
                    try {
                        resolve({
                            type: 'tool_call',
                            text: fullText,
                            toolCall: {
                                id: toolCall.id,
                                name: toolCall.function.name,
                                args: toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {}
                            }
                        });
                    } catch {
                        reject(new Error(`${this.name} returned invalid JSON arguments for tool ${toolCall.function.name}.`));
                    }
                });
            });

            req.on('error', reject);
            req.write(payload);
            req.end();
        });
    }

    /** Normalizes Mistral's legacy and current reasoning response shapes. */
    private getContentSegments(source: any): ReasoningSegment[] {
        return normalizeReasoningSegments(source);
    }
}

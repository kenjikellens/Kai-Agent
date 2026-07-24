import * as https from 'https';
import * as vscode from 'vscode';
import { ILLMProvider } from './ILLMProvider';

/**
 * GeminiClient handles API communication directly with Google Gemini REST endpoints.
 */
export class GeminiClient implements ILLMProvider {
    private apiKey: string;

    /**
     * Initializes GeminiClient instance with target API key or workspace setting.
     * @param apiKey Optional explicit API key.
     */
    constructor(apiKey?: string) {
        const config = vscode.workspace.getConfiguration('kai');
        this.apiKey = apiKey || config.get<string>('apiKey') || process.env.GEMINI_API_KEY || '';
    }

    /**
     * Retrieves the supported model IDs for Gemini API.
     * @returns A promise resolving to an array of model ID strings.
     */
    public async getModels(): Promise<string[]> {
        return [
            'gemini-3.6-flash',
            'gemini-3.5-flash',
            'gemini-3.5-flash-lite',
            'gemini-3-flash',
            'gemini-3.1-pro',
            'gemini-3.1-flash-lite',
        ];
    }

    /**
     * Executes non-streaming chat completion with Gemini API.
     */
    public async chatCompletion(
        messages: { role: string; content: string }[],
        model: string,
        temperature: number = 0.7,
        signal?: any,
        _thinking?: boolean,
        geminiThinkingLevel: string = 'high'
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

            const level = geminiThinkingLevel || 'high';
            const requestBody: any = {
                contents: contents,
                generationConfig: {
                    temperature: temperature,
                    thinkingConfig: {
                        thinkingLevel: level,
                        includeThoughts: level !== 'minimal'
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

                req.on('error', (err) => reject(err));
                req.write(payload);
                req.end();
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Executes streaming chat completion with Gemini API.
     */
    public async chatCompletionStream(
        messages: { role: string; content: string }[],
        model: string,
        temperature: number,
        onToken: (token: string) => void,
        signal?: any,
        _thinking?: boolean,
        geminiThinkingLevel: string = 'high'
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

            const level = geminiThinkingLevel || 'high';
            const generationConfig: any = {
                temperature: temperature,
                thinkingConfig: {
                    thinkingLevel: level,
                    includeThoughts: level !== 'minimal'
                }
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
                                    if (char === '{') depth++;
                                    else if (char === '}') {
                                        depth--;
                                        if (depth === 0) {
                                            foundMatch = true;
                                            endBrace = i;
                                            break;
                                        }
                                    }
                                }
                            }

                            if (foundMatch && endBrace !== -1) {
                                const jsonStr = buffer.slice(openBrace, endBrace + 1);
                                try {
                                    const parsed = JSON.parse(jsonStr);
                                    if (parsed.candidates && parsed.candidates[0].content && parsed.candidates[0].content.parts) {
                                        const parts = parsed.candidates[0].content.parts;
                                        for (const part of parts) {
                                            if (part.thought === true && part.text) {
                                                let text = '';
                                                if (!inThinking) {
                                                    text += '<think>';
                                                    inThinking = true;
                                                }
                                                text += part.text;
                                                fullText += text;
                                                onToken(text);
                                            } else if (part.text) {
                                                let text = '';
                                                if (inThinking) {
                                                    text += '</think>';
                                                    inThinking = false;
                                                }
                                                text += part.text;
                                                fullText += text;
                                                onToken(text);
                                            }
                                        }
                                    }
                                } catch {
                                    // ignore parse errors for partial objects
                                }
                                buffer = buffer.slice(endBrace + 1);
                                startIdx = 0;
                            } else {
                                break;
                            }
                        }
                    });

                    res.on('end', () => {
                        if (inThinking) {
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
            } catch (err) {
                reject(err);
            }
        });
    }
}

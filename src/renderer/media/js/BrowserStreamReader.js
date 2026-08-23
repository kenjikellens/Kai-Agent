/**
 * BrowserStreamReader: Consumes Server-Sent Events (SSE) streams and emits parsed tokens and thinking blocks.
 */
class BrowserStreamReader {
    /**
     * Reads an SSE Response stream and emits tokens via callback.
     * @param {Response} response Fetch Response instance.
     * @param {AbortSignal} signal AbortSignal to cancel stream.
     * @param {object} options Configuration options (isGemini, allowThinkingUI, onToken).
     * @returns {Promise<string>} Accumulated full text output.
     */
    static async readStream(response, signal, options = {}) {
        const { isGemini = false, allowThinkingUI = true, onToken = () => {} } = options;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        let buffer = '';
        let isThinking = false;

        try {
            while (true) {
                if (signal.aborted) break;
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (signal.aborted) break;
                    const trimmed = line.trim();
                    if (!trimmed || trimmed.startsWith(':')) continue;
                    if (trimmed === 'data: [DONE]') break;
                    if (trimmed.startsWith('data: ')) {
                        try {
                            const json = JSON.parse(trimmed.slice(6));

                            if (isGemini) {
                                const parts = json.candidates?.[0]?.content?.parts || [];
                                for (const part of parts) {
                                    if (part.thought) {
                                        if (allowThinkingUI) {
                                            if (!isThinking) {
                                                isThinking = true;
                                                fullText += '<think>';
                                                onToken('<think>');
                                            }
                                            fullText += part.text;
                                            onToken(part.text);
                                        }
                                    } else if (part.text) {
                                        if (isThinking) {
                                            isThinking = false;
                                            fullText += '</think>';
                                            onToken('</think>');
                                        }
                                        fullText += part.text;
                                        onToken(part.text);
                                    }
                                }
                            } else {
                                const delta = json.choices?.[0]?.delta || {};
                                const reasoning = delta.reasoning_content || delta.reasoning || delta.thought || '';
                                if (reasoning) {
                                    if (allowThinkingUI) {
                                        if (!isThinking) {
                                            isThinking = true;
                                            fullText += '<think>';
                                            onToken('<think>');
                                        }
                                        fullText += reasoning;
                                        onToken(reasoning);
                                    }
                                }
                                if (delta.content) {
                                    if (isThinking) {
                                        isThinking = false;
                                        fullText += '</think>';
                                        onToken('</think>');
                                    }
                                    fullText += delta.content;
                                    onToken(delta.content);
                                }
                            }
                        } catch (e) {
                            // Non-JSON line or partial chunk, continue
                        }
                    }
                }
            }
        } finally {
            if (isThinking) {
                fullText += '</think>';
                onToken('</think>');
            }
        }

        return fullText;
    }
}

if (typeof window !== 'undefined') {
    window.BrowserStreamReader = BrowserStreamReader;
}

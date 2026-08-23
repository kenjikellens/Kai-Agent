export interface ReasoningSegment {
    thinking: boolean;
    text: string;
}

/**
 * Normalizes reasoning content from OpenAI, OpenRouter, DeepSeek, and Mistral responses.
 * Detects reasoning fields: reasoning, thought, reasoning_content, or delta objects.
 */
export function normalizeReasoningSegments(source: any): ReasoningSegment[] {
    if (!source) return [];

    // Check OpenRouter / DeepSeek reasoning fields
    const reasoningText = source.reasoning !== undefined && source.reasoning !== null
        ? String(source.reasoning)
        : (source.thought !== undefined && source.thought !== null
            ? String(source.thought)
            : (source.reasoning_content !== undefined && source.reasoning_content !== null
                ? String(source.reasoning_content)
                : (source.delta?.reasoning !== undefined && source.delta?.reasoning !== null
                    ? String(source.delta.reasoning)
                    : (source.delta?.thought !== undefined && source.delta?.thought !== null
                        ? String(source.delta.thought)
                        : (source.delta?.reasoning_content !== undefined && source.delta?.reasoning_content !== null
                            ? String(source.delta.reasoning_content)
                            : null)))));

    if (reasoningText !== null && reasoningText.length > 0) {
        return [{ thinking: true, text: reasoningText }];
    }

    const content = source?.content;
    if (typeof content === 'string') return content ? [{ thinking: false, text: content }] : [];
    if (!Array.isArray(content)) return [];

    const segments: ReasoningSegment[] = [];
    for (const chunk of content) {
        if (chunk?.type === 'thinking' || Array.isArray(chunk?.thinking)) {
            const text = Array.isArray(chunk.thinking)
                ? chunk.thinking.map((part: any) => part?.text || '').join('')
                : (chunk.text || '');
            if (text) segments.push({ thinking: true, text });
        } else if (chunk?.type === 'text' || chunk?.text) {
            if (chunk.text) segments.push({ thinking: false, text: String(chunk.text) });
        }
    }
    return segments;
}

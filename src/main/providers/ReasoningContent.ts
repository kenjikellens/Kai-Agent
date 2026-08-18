export interface ReasoningSegment {
    thinking: boolean;
    text: string;
}

/** Normalizes OpenAI-compatible reasoning_content and Mistral content chunks. */
export function normalizeReasoningSegments(source: any): ReasoningSegment[] {
    if (source?.reasoning_content !== undefined && source.reasoning_content !== null) {
        return [{ thinking: true, text: String(source.reasoning_content) }];
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

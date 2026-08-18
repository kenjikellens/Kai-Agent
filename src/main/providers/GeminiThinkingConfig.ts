/**
 * Builds the Gemini thinking config for both Gemini 3 and older Gemini 2.5
 * models. This function is intentionally pure so the outgoing payload can be
 * tested without an API key or VS Code Extension Host.
 */
export function buildGeminiThinkingConfig(model: string, thinking: boolean = true, level: string = 'high'): Record<string, any> {
    const normalizedLevel = String(level || 'high').toLowerCase();
    const enabled = thinking !== false && normalizedLevel !== 'off' && normalizedLevel !== 'minimal';
    const modelLower = String(model || '').toLowerCase();
    const isGemini3 = modelLower.includes('gemini-3');
    // Gemini 3.1 Pro rejects MINIMAL; LOW is its smallest supported level.
    const minimalLevel = modelLower.includes('pro') ? 'LOW' : 'MINIMAL';
    const upperLevel = enabled ? normalizedLevel.toUpperCase() : minimalLevel;

    if (isGemini3) {
        return {
            thinkingLevel: upperLevel,
            includeThoughts: enabled
        };
    }

    // Gemini 2.5 uses a token budget instead of Gemini 3's named levels.
    const thinkingBudget = enabled
        ? ({ low: 1024, medium: 4096, high: -1 } as Record<string, number>)[normalizedLevel] ?? -1
        : 0;
    return { thinkingBudget, includeThoughts: enabled };
}

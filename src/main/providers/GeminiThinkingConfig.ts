/**
 * Dynamic soft-coded configuration definitions for Google Gemini thinking capabilities.
 */
export const GEMINI_THINKING_LEVELS = [
    { label: 'High', value: 'high', budgetTokens: -1, levelName: 'HIGH' },
    { label: 'Medium', value: 'medium', budgetTokens: 8192, levelName: 'MEDIUM' },
    { label: 'Low', value: 'low', budgetTokens: 1024, levelName: 'LOW' },
    { label: 'Minimal', value: 'minimal', budgetTokens: 0, levelName: 'MINIMAL' }
] as const;

/**
 * Builds the Gemini thinking config for both Gemini 3 and older Gemini 2.5 / 2.0 models.
 * Dynamically resolves token budgets and named thinking levels.
 *
 * @param model Target Gemini model identifier string.
 * @param thinking Boolean flag indicating whether thinking is enabled.
 * @param level Thinking level string ('high' | 'medium' | 'low' | 'off' | 'minimal').
 * @returns Object formatted for generationConfig.thinkingConfig.
 */
export function buildGeminiThinkingConfig(model: string, thinking: boolean = true, level: string = 'high'): Record<string, any> {
    const normalizedLevel = String(level || 'high').toLowerCase();
    const enabled = thinking !== false && normalizedLevel !== 'off' && normalizedLevel !== 'minimal';
    const modelLower = String(model || '').toLowerCase();
    const isGemini3 = modelLower.includes('gemini-3');

    if (isGemini3) {
        // Gemini 3.1 Pro rejects MINIMAL; LOW is its smallest supported level.
        const minimalLevel = modelLower.includes('pro') ? 'LOW' : 'MINIMAL';
        const matched = GEMINI_THINKING_LEVELS.find(lvl => lvl.value === normalizedLevel);
        const upperLevel = enabled ? (matched ? matched.levelName : normalizedLevel.toUpperCase()) : minimalLevel;

        return {
            thinkingLevel: upperLevel,
            includeThoughts: enabled
        };
    }

    // Gemini 2.x and 2.5 use a token budget instead of Gemini 3's named levels.
    const matchedBudget = GEMINI_THINKING_LEVELS.find(lvl => lvl.value === normalizedLevel);
    const thinkingBudget = enabled ? (matchedBudget ? matchedBudget.budgetTokens : -1) : 0;

    return {
        thinkingBudget: thinkingBudget,
        includeThoughts: enabled
    };
}

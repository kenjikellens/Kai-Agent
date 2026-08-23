import { BaseCloudProviderClient } from './BaseCloudProviderClient';

/**
 * Dedicated client implementation for OpenRouter cloud API.
 */
export class OpenRouterClient extends BaseCloudProviderClient {
    protected override readonly nativeFunctionCalling = true;
    /** Display name of provider shown in UI. */
    public readonly name = 'OpenRouter';
    /** Base URL endpoint for OpenRouter API. */
    public readonly baseUrl = 'https://openrouter.ai/api/v1';
    /** Configuration key for OpenRouter API key. */
    public readonly configKey = 'openrouterApiKey';
    /** Key hint text for UI setting input. */
    public readonly keyHint = 'Get API key at openrouter.ai/keys';
    /** Available OpenRouter model identifiers. */
    public readonly models = [
        "openrouter/stealth/ox-alpha",
        "openrouter/google/gemma-4-31b-it:free",
        "openrouter/google/gemma-4-26b-a4b-it:free",
        "openrouter/cohere/north-mini-code:free",
        "openrouter/z-ai/glm-5.2:free",
        "openrouter/nvidia/nemotron-3.5-lightning:free",
        "openrouter/nvidia/nemotron-3-super-120b-a12b:free",
        "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free",
        "openrouter/poolside/laguna-s-2.1:free",
        "openrouter/thinkingmachines/inkling:free",
        "openrouter/liquid/lfm-2.5-2.6b:free"
    ];

    /**
     * Checks if this provider supports the given model ID.
     * Supports both preset models and arbitrary namespaced 'openrouter/...' models.
     * @param model Namespaced model ID string.
     * @returns Boolean indicating support.
     */
    public override supportsModel(model: string): boolean {
        if (!model) return false;
        return model.startsWith('openrouter/') || this.models.includes(model);
    }

    /**
     * Custom headers required by OpenRouter.
     * @returns Headers record.
     */
    protected override getCustomHeaders(): Record<string, string> {
        return {
            'HTTP-Referer': 'https://kai-agent.local',
            'X-Title': 'KAI Agent'
        };
    }

    /**
     * Prepares request payload object with OpenRouter-specific reasoning parameters.
     * @param model Bare or namespaced model identifier.
     * @param messages Chat completion messages array.
     * @param temperature Temperature parameter.
     * @param stream Boolean flag indicating streaming mode.
     * @param thinking Optional reasoning toggle flag.
     * @returns Request payload object formatted for OpenRouter API.
     */
    protected override preparePayload(
        model: string,
        messages: { role: string; content: string }[],
        temperature: number,
        stream: boolean,
        thinking?: boolean
    ): Record<string, any> {
        const payload = super.preparePayload(model, messages, temperature, stream, thinking);
        const bareModel = this.stripProviderPrefix(model).toLowerCase();
        
        // Check if model supports reasoning (Ox Alpha, R1, GLM-5.2, Gemma 4, DeepSeek, etc.)
        const isReasoningModel = bareModel.includes('ox-alpha') ||
            bareModel.includes('r1') ||
            bareModel.includes('reasoning') ||
            bareModel.includes('glm-5.2') ||
            bareModel.includes('gemma-4') ||
            bareModel.includes('deepseek');

        if (isReasoningModel) {
            if (thinking !== false) {
                payload.reasoning = {
                    effort: 'high',
                    exclude: false
                };
            } else {
                payload.reasoning = {
                    effort: 'none',
                    exclude: true
                };
            }
        }

        return payload;
    }
}

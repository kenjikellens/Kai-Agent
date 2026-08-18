import { BaseCloudProviderClient } from './BaseCloudProviderClient';

/**
 * Dedicated client implementation for Mistral AI cloud API.
 */
export class MistralClient extends BaseCloudProviderClient {
    protected override readonly nativeFunctionCalling = true;
    /** Display name of provider shown in UI. */
    public readonly name = 'Mistral AI';
    /** Base URL endpoint for Mistral AI API. */
    public readonly baseUrl = 'https://api.mistral.ai/v1';
    /** VS Code settings configuration key for Mistral API key. */
    public readonly configKey = 'mistralApiKey';
    /** Key hint text for UI setting input. */
    public readonly keyHint = 'Get free key at console.mistral.ai';
    /** Available Mistral AI model identifiers. */
    public readonly models = [
        'mistral/magistral-small-latest',
        'mistral/magistral-medium-latest',
        'mistral/mistral-medium-3-5',
        'mistral/mistral-medium-3',
        'mistral/mistral-small-latest',
        'mistral/mistral-large-latest',
        'mistral/open-mistral-nemo',
        'mistral/codestral-latest',
        'mistral/pixtral-large-latest'
    ];

    /**
     * Prepares request payload object with Mistral-specific reasoning_effort parameter.
     * @param model Bare or namespaced model identifier.
     * @param messages Chat completion messages array.
     * @param temperature Temperature parameter.
     * @param stream Boolean flag indicating streaming mode.
     * @param thinking Optional reasoning toggle flag.
     * @returns Request payload object formatted for Mistral AI API.
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
        
        // Only attach reasoning_effort to models that support adjustable reasoning
        const supportsReasoning = bareModel.includes('magistral') || bareModel.includes('mistral-small') || bareModel.includes('mistral-medium') || bareModel.includes('codestral');
        if (supportsReasoning) {
            payload.reasoning_effort = thinking !== false ? 'high' : 'none';
        }
        return payload;
    }
}

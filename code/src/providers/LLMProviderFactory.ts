import { ILLMProvider } from './ILLMProvider';
import { GeminiClient } from './GeminiClient';
import { FreeProviderClient } from './FreeProviderClient';
import { LMStudioClient } from '../LMStudioClient';

/**
 * LLMProviderFactory instantiates and resolves the appropriate ILLMProvider strategy for a target model ID.
 */
export class LLMProviderFactory {
    /**
     * Resolves the provider implementation for a given model ID.
     * @param model Model ID string (e.g. "gemini-3.6-flash", "mistral/mistral-small-latest", or "gemma-4-e2b").
     * @param serverUrl Optional base server URL for LM Studio.
     * @param apiKey Optional API key for Gemini.
     * @returns ILLMProvider strategy instance.
     */
    static getProvider(model: string, serverUrl?: string, apiKey?: string): ILLMProvider {
        const cleanModel = model ? model.trim().toLowerCase() : '';

        // 1. Gemini Models
        if (cleanModel.startsWith('gemini')) {
            return new GeminiClient(apiKey);
        }

        // 2. Free Tier Cloud Providers (Mistral, Cohere, Cerebras, Zhipu GLM, OmniRoute)
        const freeProviderClient = new FreeProviderClient();
        if (freeProviderClient.resolveFreeProvider(model)) {
            return freeProviderClient;
        }

        // 3. Local LM Studio Instance
        return new LMStudioClient(serverUrl || 'http://localhost:1234/v1', apiKey);
    }
}

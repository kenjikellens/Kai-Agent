import { ILLMProvider } from './ILLMProvider';
import { GeminiClient } from './GeminiClient';
import { MistralClient } from './MistralClient';
import { CohereClient } from './CohereClient';
import { CerebrasClient } from './CerebrasClient';
import { ZhipuClient } from './ZhipuClient';
import { OmniRouteClient } from './OmniRouteClient';
import { FreeProviderClient } from './FreeProviderClient';
import { LMStudioClient } from '../LMStudioClient';

/**
 * Singleton/Factory instances for dedicated cloud providers.
 */
const mistralClient = new MistralClient();
const cohereClient = new CohereClient();
const cerebrasClient = new CerebrasClient();
const zhipuClient = new ZhipuClient();
const omniRouteClient = new OmniRouteClient();
const freeProviderClient = new FreeProviderClient();

/**
 * LLMProviderFactory instantiates and resolves the appropriate ILLMProvider strategy for a target model ID.
 */
export class LLMProviderFactory {
    /**
     * Resolves the dedicated provider implementation for a given model ID.
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

        // 2. Specific Cloud Providers (OOP dedicated class strategies)
        if (mistralClient.supportsModel(model)) {
            return mistralClient;
        }
        if (cohereClient.supportsModel(model)) {
            return cohereClient;
        }
        if (cerebrasClient.supportsModel(model)) {
            return cerebrasClient;
        }
        if (zhipuClient.supportsModel(model)) {
            return zhipuClient;
        }
        if (omniRouteClient.supportsModel(model) || cleanModel.startsWith('omniroute/')) {
            return omniRouteClient;
        }

        // 3. Composite Free Provider Fallback
        if (freeProviderClient.resolveFreeProvider(model)) {
            return freeProviderClient;
        }

        // 4. Local LM Studio Instance
        return new LMStudioClient(serverUrl || 'http://localhost:1234/v1', apiKey);
    }
}

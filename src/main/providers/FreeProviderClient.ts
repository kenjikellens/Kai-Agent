import { ChatMessage, ILLMProvider, NativeToolCallResult } from './ILLMProvider';
import { FunctionDeclaration } from '../tools/Tool';
import { BaseCloudProviderClient } from './BaseCloudProviderClient';
import { MistralClient } from './MistralClient';
import { CohereClient } from './CohereClient';
import { CerebrasClient } from './CerebrasClient';
import { ZhipuClient } from './ZhipuClient';
import { OmniRouteClient } from './OmniRouteClient';
import { OpenRouterClient } from './OpenRouterClient';

/**
 * Describes a free-tier cloud LLM provider configuration metadata.
 */
export interface FreeProvider {
    /** Display name shown in the model dropdown. */
    name: string;
    /** Base URL for OpenAI-compatible API calls. */
    baseUrl: string;
    /** VS Code configuration key used to read the API key (under the 'kai' namespace). */
    configKey: string;
    /** List of model IDs available on the free tier. */
    models: string[];
    /** Short description shown in the UI placeholder when no API key is set. */
    keyHint: string;
}

/**
 * Instantiate dedicated instances for each cloud provider.
 */
const mistralClient = new MistralClient();
const cohereClient = new CohereClient();
const cerebrasClient = new CerebrasClient();
const zhipuClient = new ZhipuClient();
const omniRouteClient = new OmniRouteClient();
const openRouterClient = new OpenRouterClient();

/**
 * List of all instantiated cloud provider strategies.
 */
export const PROVIDER_CLIENTS: BaseCloudProviderClient[] = [
    mistralClient,
    cohereClient,
    cerebrasClient,
    zhipuClient,
    omniRouteClient,
    openRouterClient
];

/**
 * Static registry array of free-tier LLM providers for backwards compatibility.
 */
export const FREE_PROVIDERS: FreeProvider[] = PROVIDER_CLIENTS.map(client => ({
    name: client.name,
    baseUrl: client.baseUrl,
    configKey: client.configKey,
    models: client.models,
    keyHint: client.keyHint
}));

/**
 * FreeProviderClient acts as a composite facade for all OpenAI-compatible cloud providers.
 */
export class FreeProviderClient implements ILLMProvider {
    /**
     * Retrieves the complete list of free provider model IDs.
     * @returns A promise resolving to an array of namespaced model ID strings.
     */
    public async getModels(): Promise<string[]> {
        return PROVIDER_CLIENTS.flatMap(p => p.models);
    }

    /**
     * Resolves a FreeProvider metadata entry from a namespaced model ID.
     * @param model The full namespaced model identifier.
     * @returns Matching FreeProvider metadata or undefined.
     */
    public resolveFreeProvider(model: string): FreeProvider | undefined {
        if (!model) return undefined;
        const matched = FREE_PROVIDERS.find(p => p.models.includes(model));
        if (matched) return matched;
        if (model.startsWith('omniroute/')) {
            return FREE_PROVIDERS.find(p => p.configKey === 'omnirouteApiKey');
        }
        if (model.startsWith('openrouter/')) {
            return FREE_PROVIDERS.find(p => p.configKey === 'openrouterApiKey');
        }
        return undefined;
    }

    /**
     * Resolves the dedicated BaseCloudProviderClient strategy for a model ID.
     * @param model Namespaced model ID string.
     * @returns Matching BaseCloudProviderClient strategy or undefined.
     */
    public resolveClient(model: string): BaseCloudProviderClient | undefined {
        if (!model) return undefined;
        const matched = PROVIDER_CLIENTS.find(client => client.supportsModel(model));
        if (matched) return matched;
        if (model.startsWith('omniroute/')) {
            return omniRouteClient;
        }
        if (model.startsWith('openrouter/')) {
            return openRouterClient;
        }
        return undefined;
    }

    /**
     * Validates if a specific provider's API key is working.
     * @param configKey Provider configuration key name.
     * @param apiKey Optional explicit API key.
     * @returns Promise resolving to true if valid, false otherwise.
     */
    public async validateProvider(configKey: string, apiKey?: string): Promise<boolean> {
        const client = PROVIDER_CLIENTS.find(c => c.configKey === configKey);
        if (!client) return false;
        return client.validateApiKey(apiKey);
    }

    /**
     * Executes non-streaming chat completion by delegating to the target provider strategy.
     */
    public async chatCompletion(
        messages: { role: string; content: string }[],
        model: string,
        temperature: number = 0.7,
        signal?: any,
        thinking?: boolean,
        geminiThinkingLevel?: string
    ): Promise<string> {
        const client = this.resolveClient(model);
        if (!client) {
            throw new Error(`Unknown provider for model ${model}`);
        }
        return client.chatCompletion(messages, model, temperature, signal, thinking, geminiThinkingLevel);
    }

    /**
     * Executes streaming chat completion by delegating to the target provider strategy.
     */
    public async chatCompletionStream(
        messages: { role: string; content: string }[],
        model: string,
        temperature: number,
        onToken: (token: string) => void,
        signal?: any,
        thinking?: boolean,
        geminiThinkingLevel?: string
    ): Promise<string> {
        const client = this.resolveClient(model);
        if (!client) {
            throw new Error(`Unknown provider for model ${model}`);
        }
        return client.chatCompletionStream(messages, model, temperature, onToken, signal, thinking, geminiThinkingLevel);
    }

    /** Delegates native-tool support to the provider selected for the requested model. */
    public supportsNativeFunctionCalling(): boolean {
        return false;
    }

    /** Delegates a native-tool request to the concrete resolved provider. */
    public async chatCompletionStreamWithTools(
        messages: ChatMessage[],
        model: string,
        temperature: number,
        tools: FunctionDeclaration[],
        onToken: (token: string) => void,
        signal?: any,
        thinking?: boolean,
        geminiThinkingLevel?: string
    ): Promise<NativeToolCallResult> {
        const client = this.resolveClient(model);
        if (!client || !client.supportsNativeFunctionCalling()) {
            throw new Error(`Native function calling is not available for model ${model}.`);
        }
        return client.chatCompletionStreamWithTools(messages, model, temperature, tools, onToken, signal, thinking, geminiThinkingLevel);
    }
}

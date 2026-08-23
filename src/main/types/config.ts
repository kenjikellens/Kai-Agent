/**
 * Configuration interface and types for the KAI Agent Standalone Desktop application.
 */
export interface KaiConfig {
    /** Base URL for LM Studio local API server. */
    serverUrl: string;
    /** Custom directory path for LM Studio model cache. */
    lmStudioCacheDir: string;
    /** API key for Google Gemini models. */
    apiKey: string;
    /** API key for Mistral AI. */
    mistralApiKey?: string;
    /** API key for Cohere. */
    cohereApiKey?: string;
    /** API key for Cerebras. */
    cerebrasApiKey?: string;
    /** API key for Zhipu AI. */
    zhipuApiKey?: string;
    /** API key for OpenRouter. */
    openrouterApiKey?: string;
    /** Base URL for OmniRoute gateway. */
    omnirouteServerUrl?: string;
    /** API key for OmniRoute. */
    omnirouteApiKey?: string;
    /** Temperature for completions. */
    temperature: number;
    /** Custom path to web-search-mcp server index.js. */
    webSearchMcpPath?: string;
    /** Active language code. */
    language: string;
}

/** Default configuration values for KAI Agent. */
export const DEFAULT_CONFIG: KaiConfig = {
    serverUrl: 'http://localhost:1234/v1',
    lmStudioCacheDir: '',
    apiKey: '',
    mistralApiKey: '',
    cohereApiKey: '',
    cerebrasApiKey: '',
    zhipuApiKey: '',
    openrouterApiKey: '',
    omnirouteServerUrl: 'http://localhost:8000/v1',
    omnirouteApiKey: '',
    temperature: 0.7,
    webSearchMcpPath: '',
    language: 'auto'
};

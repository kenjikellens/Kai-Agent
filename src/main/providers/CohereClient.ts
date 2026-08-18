import { BaseCloudProviderClient } from './BaseCloudProviderClient';

/**
 * Dedicated client implementation for Cohere cloud API.
 */
export class CohereClient extends BaseCloudProviderClient {
    /** Display name of provider shown in UI. */
    public readonly name = 'Cohere';
    /** Base URL endpoint for Cohere v2 API. */
    public readonly baseUrl = 'https://api.cohere.com/v2';
    /** VS Code settings configuration key for Cohere API key. */
    public readonly configKey = 'cohereApiKey';
    /** Key hint text for UI setting input. */
    public readonly keyHint = 'Get free key at dashboard.cohere.com';
    /** Available Cohere model identifiers. */
    public readonly models = [
        'cohere/command-a-plus',
        'cohere/command-a',
        'cohere/command-r-plus',
        'cohere/command-r',
        'cohere/command-r7b-12-2024'
    ];
}

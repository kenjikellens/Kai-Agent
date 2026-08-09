import { BaseCloudProviderClient } from './BaseCloudProviderClient';

/**
 * Dedicated client implementation for Cerebras AI cloud API.
 */
export class CerebrasClient extends BaseCloudProviderClient {
    protected override readonly nativeFunctionCalling = true;
    /** Display name of provider shown in UI. */
    public readonly name = 'Cerebras';
    /** Base URL endpoint for Cerebras API. */
    public readonly baseUrl = 'https://api.cerebras.ai/v1';
    /** VS Code settings configuration key for Cerebras API key. */
    public readonly configKey = 'cerebrasApiKey';
    /** Key hint text for UI setting input. */
    public readonly keyHint = 'Get free key at cloud.cerebras.ai';
    /** Available Cerebras model identifiers. */
    public readonly models = [
        'cerebras/llama-4-scout-17b-16e-instruct',
        'cerebras/llama-3.3-70b'
    ];
}

import { BaseCloudProviderClient } from './BaseCloudProviderClient';

/**
 * Dedicated client implementation for OmniRoute Gateway API.
 */
export class OmniRouteClient extends BaseCloudProviderClient {
    /** Display name of provider shown in UI. */
    public readonly name = 'OmniRoute Gateway';
    /** Default local base URL for OmniRoute. */
    public readonly baseUrl = 'http://localhost:8000/v1';
    /** VS Code settings configuration key for OmniRoute API key. */
    public readonly configKey = 'omnirouteApiKey';
    /** Key hint text for UI setting input. */
    public readonly keyHint = 'Run OmniRoute via npm: npx omniroute (default: http://localhost:8000/v1)';
    /** Available OmniRoute model identifiers. */
    public readonly models = [
        'omniroute/auto'
    ];
}

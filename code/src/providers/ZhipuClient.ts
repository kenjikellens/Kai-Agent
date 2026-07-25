import { BaseCloudProviderClient } from './BaseCloudProviderClient';

/**
 * Dedicated client implementation for Zhipu AI (GLM) cloud API.
 */
export class ZhipuClient extends BaseCloudProviderClient {
    /** Display name of provider shown in UI. */
    public readonly name = 'Zhipu AI (GLM)';
    /** Base URL endpoint for Zhipu AI API. */
    public readonly baseUrl = 'https://open.bigmodel.cn/api/paas/v4';
    /** VS Code settings configuration key for Zhipu API key. */
    public readonly configKey = 'zhipuApiKey';
    /** Key hint text for UI setting input. */
    public readonly keyHint = 'Get free key at open.bigmodel.cn';
    /** Available Zhipu AI model identifiers. */
    public readonly models = [
        'zhipu/glm-4-flash',
        'zhipu/glm-4v-flash'
    ];
}

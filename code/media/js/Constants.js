/**
 * Constants.js provides global configuration constants for Kai Agent UI.
 */
const KAI_CONSTANTS = {
    DEFAULT_GEMINI_MODELS: [
        'gemini-3.6-flash',
        'gemini-3.5-flash',
        'gemini-3.5-flash-lite',
        'gemini-3-flash-preview',
        'gemini-3.1-pro-preview',
        'gemini-3.1-flash-lite',
    ],
    DEFAULT_FREE_PROVIDERS: [
        { name: 'Mistral AI', configKey: 'mistralApiKey', keyHint: 'Get free key at console.mistral.ai' },
        { name: 'Cohere', configKey: 'cohereApiKey', keyHint: 'Get free key at dashboard.cohere.com' },
        { name: 'Cerebras', configKey: 'cerebrasApiKey', keyHint: 'Get free key at cloud.cerebras.ai' },
        { name: 'Zhipu AI', configKey: 'zhipuApiKey', keyHint: 'Get free key at open.bigmodel.cn' },
        { name: 'OmniRoute Gateway', configKey: 'omnirouteApiKey', keyHint: 'Run OmniRoute via npm: npx omniroute' }
    ],
    DEFAULT_PROVIDERS_WITH_MODELS: [
        { name: 'OmniRoute Gateway', models: ['omniroute/auto'] },
        { name: 'Mistral AI', models: ['mistral/mistral-small-latest', 'mistral/codestral-latest', 'mistral/open-mixtral-8x22b'] },
        { name: 'Cohere', models: ['cohere/command-r-plus', 'cohere/command-r'] },
        { name: 'Cerebras', models: ['cerebras/llama-3.3-70b', 'cerebras/llama-3.1-8b'] },
        { name: 'Zhipu AI', models: ['zhipu/glm-4-flash', 'zhipu/glm-4-plus'] }
    ]
};

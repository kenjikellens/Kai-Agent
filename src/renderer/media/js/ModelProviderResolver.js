/**
 * ModelProviderResolver provides high-speed memoized provider requirement lookups,
 * API key verification, and connection status resolution across all supported providers.
 */
class ModelProviderResolver {
    /**
     * Initializes provider descriptor cache and configuration maps.
     * @param {MarkdownFormatter} [formatter] Formatter instance for clean model names.
     */
    constructor(formatter = null) {
        this.formatter = formatter;
        this._providerCache = new Map();
    }

    /**
     * Clears internal provider resolution cache when settings or keys change.
     */
    invalidateCache() {
        this._providerCache.clear();
    }

    /**
     * Determines provider requirements and key status for a given model ID.
     * @param {string} modelId Model identifier string.
     * @returns {object|null} Provider descriptor object or null if local.
     */
    getProviderInfo(modelId) {
        if (!modelId) return null;
        const bare = modelId.endsWith(' (thinking)') ? modelId.slice(0, -11) : modelId;
        const lower = bare.toLowerCase();

        if (this._providerCache.has(lower)) {
            const cached = this._providerCache.get(lower);
            // Re-verify key state dynamically
            cached.hasKey = !!(localStorage.getItem(`kai.${cached.configKey}`) || (cached.configKey === 'geminiApiKey' ? localStorage.getItem('kai.apiKey') : '') || '').trim();
            return cached;
        }

        let info = null;
        if (lower.startsWith('gemini') || lower.includes('gemini')) {
            const key = (localStorage.getItem('kai.geminiApiKey') || localStorage.getItem('kai.apiKey') || '').trim();
            info = {
                providerName: 'Google Gemini',
                configKey: 'geminiApiKey',
                keyHint: 'Get free key at aistudio.google.com/app/apikey',
                url: 'https://aistudio.google.com/app/apikey',
                hasKey: !!key,
                modelName: this.formatter ? this.formatter.formatModelName(bare) : bare
            };
        } else {
            const freeProviders = (typeof KAI_CONSTANTS !== 'undefined' && KAI_CONSTANTS.DEFAULT_FREE_PROVIDERS) || [];
            for (const p of freeProviders) {
                const pKey = p.name.toLowerCase().split(' ')[0];
                if (lower.startsWith(pKey) || lower.includes(pKey)) {
                    const key = (localStorage.getItem(`kai.${p.configKey}`) || '').trim();
                    let url = '';
                    if (p.configKey === 'mistralApiKey') url = 'https://console.mistral.ai';
                    else if (p.configKey === 'cohereApiKey') url = 'https://dashboard.cohere.com';
                    else if (p.configKey === 'cerebrasApiKey') url = 'https://cloud.cerebras.ai';
                    else if (p.configKey === 'zhipuApiKey') url = 'https://open.bigmodel.cn';
                    info = {
                        providerName: p.name,
                        configKey: p.configKey,
                        keyHint: p.keyHint,
                        url: url,
                        hasKey: !!key,
                        modelName: this.formatter ? this.formatter.formatModelName(bare) : bare
                    };
                    break;
                }
            }
        }

        if (info) {
            this._providerCache.set(lower, info);
        }
        return info;
    }

    /**
     * Determines whether a model is connected (API key configured for cloud, or loaded for LM Studio).
     * @param {string} modelId Target model identifier.
     * @param {object} connectionContext Context containing connected flag and loadedModels array.
     * @returns {boolean} True if model is available for execution.
     */
    isModelConnected(modelId, connectionContext = {}) {
        if (!modelId) return false;
        const bare = modelId.endsWith(' (thinking)') ? modelId.slice(0, -11) : modelId;
        const lower = bare.toLowerCase();

        const providerInfo = this.getProviderInfo(bare);
        if (providerInfo) {
            return providerInfo.hasKey;
        }

        const isLMConnected = !!connectionContext.connected;
        const loadedModels = connectionContext.loadedModels || [];
        return isLMConnected && (loadedModels.includes(bare) || loadedModels.some(m => m.toLowerCase() === lower));
    }
}

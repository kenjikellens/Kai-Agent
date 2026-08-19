/**
 * SettingsRepository manages persistent configuration storage in localStorage
 * with debounced disk writes and IPC synchronization.
 */
class SettingsRepository {
    /**
     * Initializes configuration definitions and debounced save pipeline.
     * @param {WebviewIPCBridge} [ipcBridge] IPC bridge instance.
     */
    constructor(ipcBridge = null) {
        this.ipcBridge = ipcBridge;
        this._debouncedSave = typeof DOMUtils !== 'undefined' && DOMUtils.debounce
            ? DOMUtils.debounce((key, val) => {
                if (this.ipcBridge && typeof this.ipcBridge.updateSettings === 'function') {
                    this.ipcBridge.updateSettings({ providerKeys: this.getAllProviderKeys() });
                }
            }, 250)
            : null;
    }

    /**
     * Retrieves an external provider API key from localStorage.
     * @param {string} configKey Key identifier (e.g., 'geminiApiKey', 'mistralApiKey').
     * @returns {string} Stored API key string.
     */
    getProviderKey(configKey) {
        if (!configKey) return '';
        if (configKey === 'geminiApiKey') {
            return (localStorage.getItem('kai.geminiApiKey') || localStorage.getItem('kai.apiKey') || '').trim();
        }
        return (localStorage.getItem(`kai.${configKey}`) || '').trim();
    }

    /**
     * Sets an external provider API key and schedules debounced persistence.
     * @param {string} configKey Key identifier.
     * @param {string} value New API key value.
     */
    setProviderKey(configKey, value) {
        if (!configKey) return;
        const clean = (value || '').trim();
        localStorage.setItem(`kai.${configKey}`, clean);
        if (configKey === 'geminiApiKey') {
            localStorage.setItem('kai.apiKey', clean);
        }
        if (this._debouncedSave) {
            this._debouncedSave(configKey, clean);
        } else if (this.ipcBridge && typeof this.ipcBridge.updateSettings === 'function') {
            this.ipcBridge.updateSettings({ providerKeys: this.getAllProviderKeys() });
        }
    }

    /**
     * Gathers all stored provider keys into a single dictionary.
     * @returns {Record<string, string>} Provider key dictionary.
     */
    getAllProviderKeys() {
        const keys = {};
        const freeProviders = (typeof KAI_CONSTANTS !== 'undefined' && KAI_CONSTANTS.DEFAULT_FREE_PROVIDERS) || [];
        keys['apiKey'] = this.getProviderKey('geminiApiKey');
        keys['geminiApiKey'] = keys['apiKey'];
        for (const p of freeProviders) {
            keys[p.configKey] = this.getProviderKey(p.configKey);
        }
        return keys;
    }
}

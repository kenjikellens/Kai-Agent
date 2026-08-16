import * as vscode from 'vscode';
import { en } from './locales/en';
import { nl } from './locales/nl';
import { de } from './locales/de';
import { fr } from './locales/fr';
import { es } from './locales/es';
import { zh } from './locales/zh';
import { hi } from './locales/hi';
import { ar } from './locales/ar';
import { pt } from './locales/pt';

/**
 * Interface defining translation keys for UI elements and messages.
 */
export interface Translations {
    newChat: string;
    previousChats: string;
    noPreviousChats: string;
    history: string;
    settings: string;
    manageApiKeys: string;
    showThinking: string;
    keepThinkingGenerating: string;
    keepThinkingFinished: string;
    thinkingToggle: string;
    thinkingProcess: string;
    thinkingText: string;
    messagePlaceholder: string;
    lmStudioHeader: string;
    checkingServer: string;
    connected: string;
    offline: string;
    cloudProvidersHeader: string;
    selectModel: string;
    noWorkspaceError: string;
    language: string;
    uploadFile: string;
    planningMode: string;
    planningModeDesc: string;
    generalSettings: string;
    thinkingSettings: string;
    apiKeysSettings: string;
    thinkingDisplayStyle: string;
    serverUrl: string;
    lmStudioDirectory: string;
    browse: string;
    checkingCache: string;
    cacheLoaded: string;
    cacheNotFound: string;
    geminiApiKey: string;
    manageFreeProviderKeys: string;
    externalProvidersHeader: string;
    externalProviderApiKeys: string;
    close: string;
    iconAndText: string;
    iconOnly: string;
    textOnly: string;
}

/**
 * Interface for language selector option metadata.
 */
export interface LanguageOption {
    value: string;
    label: string;
}

/**
 * Dictionary registry mapping 2-letter language codes to their dedicated locale modules.
 */
const LOCALES: Record<string, Translations> = {
    en,
    nl,
    de,
    fr,
    es,
    zh,
    hi,
    ar,
    pt
};

/**
 * Manages active language resolution and translation lookup.
 */
export class I18nManager {
    /**
     * Returns supported language options for UI select controls.
     */
    public static getSupportedLanguages(): LanguageOption[] {
        return [
            { value: 'auto', label: 'Auto (VS Code)' },
            { value: 'en', label: 'English' },
            { value: 'nl', label: 'Nederlands' },
            { value: 'de', label: 'Deutsch' },
            { value: 'fr', label: 'Français' },
            { value: 'es', label: 'Español' },
            { value: 'zh', label: '中文 (Simplified)' },
            { value: 'hi', label: 'हिन्दी (Hindi)' },
            { value: 'ar', label: 'العربية (Arabic)' },
            { value: 'pt', label: 'Português' }
        ];
    }

    /**
     * Resolves the active 2-letter language code based on setting or VS Code environment.
     */
    public static getActiveLanguage(): string {
        const config = vscode.workspace.getConfiguration('kai');
        const setting = config.get<string>('language') || 'auto';
        if (setting === 'auto') {
            const vscodeLang = vscode.env.language ? vscode.env.language.toLowerCase().slice(0, 2) : 'en';
            return LOCALES[vscodeLang] ? vscodeLang : 'en';
        }
        return LOCALES[setting] ? setting : 'en';
    }

    /**
     * Retrieves the translation dictionary for the active language.
     */
    public static getTranslations(): Translations {
        const lang = this.getActiveLanguage();
        return LOCALES[lang] || LOCALES.en;
    }
}

import * as vscode from 'vscode';

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
}

const LOCALES: Record<string, Translations> = {
    en: {
        newChat: 'New Chat',
        previousChats: 'Previous Chats',
        noPreviousChats: 'No previous chats found.',
        history: 'History',
        settings: 'Settings',
        manageApiKeys: 'Manage API Keys',
        showThinking: 'Show thinking process',
        keepThinkingGenerating: 'Keep thinking expanded while generating',
        keepThinkingFinished: 'Keep thinking expanded after reasoning is done',
        thinkingToggle: 'Thinking',
        thinkingProcess: 'Thinking Process',
        thinkingText: 'Thinking...',
        messagePlaceholder: 'Message AI agent...',
        lmStudioHeader: 'LM Studio',
        checkingServer: 'Checking server...',
        connected: 'Connected',
        offline: 'Offline',
        cloudProvidersHeader: 'Cloud & Free Providers',
        selectModel: 'Select Model',
        noWorkspaceError: 'No active workspace directory found. Please open a folder first.',
        language: 'Language'
    },
    nl: {
        newChat: 'Nieuwe Chat',
        previousChats: 'Eerdere Chats',
        noPreviousChats: 'Geen eerdere chats gevonden.',
        history: 'Geschiedenis',
        settings: 'Instellingen',
        manageApiKeys: 'API Sleutels Beheren',
        showThinking: 'Denkproces tonen',
        keepThinkingGenerating: 'Denkproces uitgeklapt houden tijdens genereren',
        keepThinkingFinished: 'Denkproces uitgeklapt houden na voltooien',
        thinkingToggle: 'Denken',
        thinkingProcess: 'Denkproces',
        thinkingText: 'Aan het denken...',
        messagePlaceholder: 'Bericht aan AI agent...',
        lmStudioHeader: 'LM Studio',
        checkingServer: 'Server controleren...',
        connected: 'Verbonden',
        offline: 'Offline',
        cloudProvidersHeader: 'Cloud & Gratis Providers',
        selectModel: 'Selecteer Model',
        noWorkspaceError: 'Geen actieve werkruimte gevonden. Open eerst een map.',
        language: 'Taal'
    },
    de: {
        newChat: 'Neuer Chat',
        previousChats: 'Bisherige Chats',
        noPreviousChats: 'Keine bisherigen Chats gefunden.',
        history: 'Verlauf',
        settings: 'Einstellungen',
        manageApiKeys: 'API-Schlüssel verwalten',
        showThinking: 'Denkprozess anzeigen',
        keepThinkingGenerating: 'Denkprozess während der Generierung ausgeklappt lassen',
        keepThinkingFinished: 'Denkprozess nach Beendung ausgeklappt lassen',
        thinkingToggle: 'Denken',
        thinkingProcess: 'Denkprozess',
        thinkingText: 'Denkt nach...',
        messagePlaceholder: 'Nachricht an AI Agent...',
        lmStudioHeader: 'LM Studio',
        checkingServer: 'Server wird geprüft...',
        connected: 'Verbunden',
        offline: 'Offline',
        cloudProvidersHeader: 'Cloud & Kostenlose Anbieter',
        selectModel: 'Modell auswählen',
        noWorkspaceError: 'Kein aktiver Arbeitsbereich gefunden. Bitte zuerst einen Ordner öffnen.',
        language: 'Sprache'
    },
    fr: {
        newChat: 'Nouvelle Discussion',
        previousChats: 'Discussions Précédentes',
        noPreviousChats: 'Aucune discussion précédente trouvée.',
        history: 'Historique',
        settings: 'Paramètres',
        manageApiKeys: 'Gérer les clés API',
        showThinking: 'Afficher le processus de réflexion',
        keepThinkingGenerating: 'Garder la réflexion ouverte pendant la génération',
        keepThinkingFinished: 'Garder la réflexion ouverte une fois terminée',
        thinkingToggle: 'Réflexion',
        thinkingProcess: 'Processus de réflexion',
        thinkingText: 'Réflexion en cours...',
        messagePlaceholder: 'Envoyer un message à l\'agent IA...',
        lmStudioHeader: 'LM Studio',
        checkingServer: 'Vérification du serveur...',
        connected: 'Connecté',
        offline: 'Hors ligne',
        cloudProvidersHeader: 'Fournisseurs Cloud & Gratuits',
        selectModel: 'Sélectionner le modèle',
        noWorkspaceError: 'Aucun dossier de travail actif. Veuillez d\'abord ouvrir un dossier.',
        language: 'Langue'
    },
    es: {
        newChat: 'Nuevo Chat',
        previousChats: 'Chats Anteriores',
        noPreviousChats: 'No se encontraron chats anteriores.',
        history: 'Historial',
        settings: 'Configuración',
        manageApiKeys: 'Gestionar Claves API',
        showThinking: 'Mostrar proceso de pensamiento',
        keepThinkingGenerating: 'Mantener pensamiento abierto mientras genera',
        keepThinkingFinished: 'Mantener pensamiento abierto al finalizar',
        thinkingToggle: 'Pensamiento',
        thinkingProcess: 'Proceso de pensamiento',
        thinkingText: 'Pensando...',
        messagePlaceholder: 'Enviar mensaje al agente IA...',
        lmStudioHeader: 'LM Studio',
        checkingServer: 'Comprobando servidor...',
        connected: 'Conectado',
        offline: 'Desconectado',
        cloudProvidersHeader: 'Proveedores Cloud y Gratuitos',
        selectModel: 'Seleccionar Modelo',
        noWorkspaceError: 'No se encontró un directorio de trabajo activo. Por favor abra una carpeta primero.',
        language: 'Idioma'
    }
};

/**
 * Manages active language resolution and translation lookup.
 */
export class I18nManager {
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

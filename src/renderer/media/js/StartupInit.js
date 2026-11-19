/**
 * StartupInit: Hydrates validated visual scale, typography, chat width, and timing CSS custom properties before first paint.
 * Reads `localStorage` preferences and mutates `:root` custom properties under strict CSP.
 */
try {
    const savedScale = localStorage.getItem('kai.uiScale') || '1.0';
    document.documentElement.style.removeProperty('zoom');
    document.documentElement.style.setProperty('--app-ui-scale', savedScale);

    const allowedFontSizes = ['13px', '14px', '15px', '16px', '17px'];
    const rawFontSize = localStorage.getItem('kai.fontSize') || '15px';
    const savedFontSize = allowedFontSizes.includes(rawFontSize) ? rawFontSize : '15px';
    document.documentElement.style.setProperty('--app-base-font-size', savedFontSize);

    const allowedChatWidths = ['720px', '820px', '1040px', '100%'];
    const rawChatWidth = localStorage.getItem('kai.chatWidth') || '820px';
    const savedChatWidth = allowedChatWidths.includes(rawChatWidth) ? rawChatWidth : '820px';
    document.documentElement.style.setProperty('--app-chat-max-width', savedChatWidth);

    const savedThinkingHeight = localStorage.getItem('kai.thinkingMaxHeight') || '150px';
    document.documentElement.style.setProperty('--app-thinking-max-height', savedThinkingHeight);
    const savedExtraDelay = parseInt(localStorage.getItem('kai.streamSettleDelay') || '0', 10);
    const baseDelay = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--stream-settle-base-delay'), 10) || 150;
    const effectiveSettle = baseDelay + (isNaN(savedExtraDelay) ? 0 : savedExtraDelay);
    document.documentElement.style.setProperty('--stream-settle-delay', `${effectiveSettle}ms`);
} catch (e) {}

window.KAI_SVGS = window.KAI_SVGS || {};
window.KAI_I18N = window.KAI_I18N || {};
window.KAI_LANG = window.KAI_LANG || 'auto';
window.KAI_SUPPORTED_LANGUAGES = [
    { value: 'auto', label: 'Auto (System)' },
    { value: 'en', label: 'English' },
    { value: 'nl', label: 'Nederlands' },
    { value: 'de', label: 'Deutsch' },
    { value: 'fr', label: 'Français' },
    { value: 'es', label: 'Español' },
    { value: 'zh', label: '中文 (简体)' },
    { value: 'zh_tw', label: '中文 (繁體)' },
    { value: 'pt', label: 'Português' },
    { value: 'ja', label: '日本語' },
    { value: 'ko', label: '한국어' },
    { value: 'ru', label: 'Русский' },
    { value: 'it', label: 'Italiano' },
    { value: 'pl', label: 'Polski' },
    { value: 'tr', label: 'Türkçe' },
    { value: 'cs', label: 'Čeština' },
    { value: 'hu', label: 'Magyar' },
    { value: 'ar', label: 'العربية' },
    { value: 'hi', label: 'हिन्दी' }
];

/**
 * MarkdownFormatter handles Markdown parsing, HTML entity escaping,
 * code block syntax formatting, and reasoning <think> block rendering logic.
 */
class MarkdownFormatter {
    /**
     * Formats basic HTML entities safely to prevent injection.
     * @param {string} text Raw input string.
     * @returns {string} HTML-escaped string.
     */
    escapeHtml(text) {
        if (!text) return '';
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    /**
     * Formats a long model ID or path into a clean display name.
     * @param {string} modelId Full model identifier.
     * @returns {string} Clean display name.
     */
    formatModelName(modelId) {
        if (!modelId) return 'Local Model';
        const slashIdx = modelId.indexOf('/');
        const displayId = slashIdx !== -1 ? modelId.slice(slashIdx + 1) : modelId;
        const parts = displayId.split(/[/\\]/).filter(p => p.trim() !== '');
        if (parts.length === 0) return displayId;
        
        let last = parts[parts.length - 1];
        if (/^model(\.gguf)?$/i.test(last) && parts.length > 1) {
            last = parts[parts.length - 2];
        }
        return last.replace(/\.gguf$/i, '');
    }

    /**
     * Formats raw markdown text into safe rendered HTML.
     * @param {string} text Raw markdown text.
     * @param {boolean|null} forceThinkingCollapsed Optional collapse override.
     * @param {boolean} isThinkingEnabled Whether agent thinking is enabled.
     * @returns {string} Formatted HTML.
     */
    formatMarkdown(text, forceThinkingCollapsed = null, isThinkingEnabled = true) {
        if (!text) return '';
        const chevronSvg = `<svg class="custom-chevron" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 5px; display: inline-block; vertical-align: middle;"><polyline points="6 9 12 15 18 9"></polyline></svg>`;

        let cleanText = text;

        // 1. Strip special model tokens and tool call tags
        cleanText = cleanText.replace(/<\|?\/?tool_calls?\|?>/gi, '');
        cleanText = cleanText.replace(/<\|[a-zA-Z0-9_\-\s:\/|]+\|?>/gi, '');
        cleanText = cleanText.replace(/<[a-zA-Z0-9_\-\s:\/]*tool_call[a-zA-Z0-9_\-\s:\/|]*>/gi, '');
        cleanText = cleanText.replace(/\bcall:[a-zA-Z0-9_\-]+\b/gi, '');

        // 2. Strip incomplete streaming tool calls from end of text
        cleanText = cleanText.replace(/```json(?:(?!```)[\s\S])*$/i, '');
        cleanText = cleanText.replace(/```\s*\{\s*(?:(?!```)[\s\S])*$/i, '');
        cleanText = cleanText.replace(/\{\s*["'](?:type|path|command|chunks|query|action)["'](?:(?!\})[\s\S])*$/i, '');

        // 3. Handle tool result formatting
        if (cleanText.startsWith('[Tool Result for')) {
            const match = cleanText.match(/^\[Tool Result for (.*?)\]:\n([\s\S]*)/);
            if (match) {
                const toolName = match[1];
                const resultBody = match[2];
                return `<details class="tool-result-details" open><summary>${chevronSvg}Tool Result: <strong>${this.escapeHtml(toolName)}</strong></summary><pre><code>${this.escapeHtml(resultBody)}</code></pre></details>`;
            }
        }

        // 4. Strip completed fenced JSON tool calls
        cleanText = cleanText.replace(/```json\s*([\s\S]*?)```/gi, '');
        cleanText = cleanText.replace(/```\s*(\{[\s\S]*?\})\s*```/gi, '');

        // 5. Strip raw unfenced JSON objects containing known tool keys
        cleanText = cleanText.replace(/\{\s*["'](?:type|path|command|chunks|query|action|url|content)["'][\s\S]*?\}/gi, '');

        // 6. Double-check and strip any remaining JSON objects representing tool arguments
        cleanText = cleanText.replace(/\{[\s\S]*?\}/g, (match) => {
            try {
                const p = JSON.parse(match);
                if (p && typeof p === 'object' && (p.command || p.path || p.type || p.chunks || p.query || p.action || p.url)) {
                    return '';
                }
            } catch {}
            return match;
        });

        // 7. Clean up excessive blank lines
        cleanText = cleanText.replace(/(\r?\n\s*){3,}/g, '\n\n');

        let escaped = this.escapeHtml(cleanText);

        // Check preferences to render or strip <think>...</think> blocks
        if (isThinkingEnabled) {
            const showThinking = localStorage.getItem('kai.showThinking') !== 'false';
            const keepThinkingExpanded = localStorage.getItem('kai.keepThinkingExpanded') !== 'false';
            const keepThinkingFinishedExpanded = localStorage.getItem('kai.keepThinkingFinishedExpanded') === 'true';

            const chevronUp = `<svg class="thinking-chevron" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>`;
            const chevronDown = `<svg class="thinking-chevron" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;

            const i18n = window.KAI_I18N || {};
            const thinkingProcessTitle = i18n.thinkingProcess || 'Thinking Process';
            const thinkingTextTitle = i18n.thinkingText || 'Thinking...';

            if (showThinking) {
                // Completed thinking block
                if (escaped.includes('&lt;/think&gt;')) {
                    escaped = escaped.replace(/&lt;think&gt;([\s\S]*?)&lt;\/think&gt;/g, (match, p1) => {
                        const cleanedContent = p1.trim().replace(/(\r?\n\s*){3,}/g, '\n');
                        const shouldRespectExistingState = forceThinkingCollapsed !== null && keepThinkingFinishedExpanded;
                        const isCollapsed = shouldRespectExistingState ? forceThinkingCollapsed : !keepThinkingFinishedExpanded;
                        const activeChevron = isCollapsed ? chevronDown : chevronUp;
                        const activeCollapsedClass = isCollapsed ? ' collapsed' : '';
                        return `<div class="thinking-block"><div class="thinking-header">${thinkingProcessTitle}${activeChevron}</div><div class="thinking-content${activeCollapsedClass}"><em>${cleanedContent}</em></div></div>`;
                    });
                }
                // Streaming thinking block
                else if (escaped.includes('&lt;think&gt;')) {
                    escaped = escaped.replace(/&lt;think&gt;([\s\S]*)$/g, (match, p1) => {
                        const cleanedContent = p1.trim().replace(/(\r?\n\s*){3,}/g, '\n');
                        const shouldRespectExistingState = forceThinkingCollapsed !== null && keepThinkingExpanded;
                        const isCollapsed = shouldRespectExistingState ? forceThinkingCollapsed : !keepThinkingExpanded;
                        const activeChevron = isCollapsed ? chevronDown : chevronUp;
                        const activeCollapsedClass = isCollapsed ? ' collapsed' : '';
                        return `<div class="thinking-block"><div class="thinking-header"><span class="thinking-spinner"></span>${thinkingTextTitle}${activeChevron}</div><div class="thinking-content${activeCollapsedClass}"><em>${cleanedContent}</em></div></div>`;
                    });
                }
            } else {
                if (escaped.includes('&lt;/think&gt;')) {
                    escaped = escaped.replace(/&lt;think&gt;([\s\S]*?)&lt;\/think&gt;/g, '');
                } else if (escaped.includes('&lt;think&gt;')) {
                    escaped = escaped.replace(/&lt;think&gt;([\s\S]*)$/g, () => {
                        return `<div class="thinking-loader"><span class="thinking-spinner"></span>${thinkingTextTitle}</div>`;
                    });
                }
            }
        } else {
            escaped = escaped.replace(/&lt;think&gt;([\s\S]*?)&lt;\/think&gt;/g, '');
            escaped = escaped.replace(/&lt;think&gt;([\s\S]*)$/g, '');
        }

        // Replace tool call placeholders
        escaped = escaped.replace(/\[\[\[TOOL_CALL_START\]\]\]([\s\S]*?)\[\[\[TOOL_CALL_END\]\]\]/g, '');

        // Triple backtick code blocks
        escaped = escaped.replace(/```(?:[a-zA-Z0-9\-]+)?\n([\s\S]*?)\n```/g, '<pre><code>$1</code></pre>');

        // Inline code
        escaped = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');

        // Bold formatting
        escaped = escaped.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');

        // Italic formatting
        escaped = escaped.replace(/\*([\s\S]+?)\*/g, '<em>$1</em>');

        // Headers formatting
        escaped = escaped.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
        escaped = escaped.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
        escaped = escaped.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

        // Bullet lists
        escaped = escaped.replace(/^[-\*]\s+(.+)$/gm, '• $1');

        return escaped;
    }
}

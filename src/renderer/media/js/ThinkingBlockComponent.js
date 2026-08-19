/**
 * ThinkingBlockComponent encapsulates rendering of collapsible reasoning blocks,
 * auto-scrolling during live thought streaming, and chevron toggles.
 */
class ThinkingBlockComponent {
    /**
     * Toggles collapsed state on a thinking block content container.
     * @param {HTMLElement} header The .thinking-header element that was clicked.
     */
    static toggle(header) {
        if (!header) return;
        const content = header.nextElementSibling;
        if (content && content.classList.contains('thinking-content')) {
            content.classList.toggle('collapsed');
            const chevron = header.querySelector('.thinking-chevron');
            if (chevron) {
                const isCollapsed = content.classList.contains('collapsed');
                chevron.innerHTML = isCollapsed 
                    ? '<polyline points="6 9 12 15 18 9"></polyline>'
                    : '<polyline points="18 15 12 9 6 15"></polyline>';
                if (!isCollapsed) {
                    content.scrollTop = content.scrollHeight;
                }
            }
        }
    }

    /**
     * Auto-scrolls the active streaming thinking container to bottom.
     * @param {HTMLElement} container The message container element.
     */
    static scrollStreaming(container) {
        if (!container) return;
        const thinkingContentEl = container.querySelector('.thinking-content');
        if (thinkingContentEl && !thinkingContentEl.classList.contains('collapsed')) {
            thinkingContentEl.scrollTop = thinkingContentEl.scrollHeight;
        }
    }
}

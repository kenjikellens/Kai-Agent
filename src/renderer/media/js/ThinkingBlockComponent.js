/**
 * ThinkingBlockComponent encapsulates rendering of collapsible reasoning blocks,
 * auto-scrolling during live thought streaming, and chevron toggles.
 */
class ThinkingBlockComponent {
    /**
     * Toggles collapsed state on a thinking block container.
     * @param {HTMLElement} header The .thinking-header element that was clicked.
     */
    static toggle(header) {
        if (!header) return;
        const block = header.closest('.thinking-block');
        if (block) {
            block.classList.toggle('collapsed');
            const isCollapsed = block.classList.contains('collapsed');
            const chevron = header.querySelector('.thinking-chevron');
            if (chevron) {
                chevron.innerHTML = isCollapsed 
                    ? '<polyline points="6 9 12 15 18 9"></polyline>'
                    : '<polyline points="18 15 12 9 6 15"></polyline>';
            }
        }
    }

    /**
     * Auto-scrolls the active streaming thinking container to bottom.
     * @param {HTMLElement} container The message container element.
     */
    static scrollStreaming(container) {
        if (!container) return;
        const block = container.querySelector('.thinking-block');
        const content = container.querySelector('.thinking-content');
        if (block && content && !block.classList.contains('collapsed')) {
            content.scrollTop = content.scrollHeight;
        }
    }
}

/**
 * AssistantMessageBubble encapsulates rendering of assistant response rows,
 * formatted markdown content, and bottom action bars (copy text, retry turn).
 */
class AssistantMessageBubble {
    /**
     * Renders an assistant message container DOM element.
     * @param {string} formattedHtml Formatted HTML string.
     * @param {string} rawText Raw assistant response text.
     * @param {object} [options] Bubble options and callbacks.
     * @param {Function} [options.onRetry] Callback when user clicks retry turn.
     * @returns {HTMLElement} The created assistant message DOM element.
     */
    static render(formattedHtml, rawText, options = {}) {
        const row = document.createElement('div');
        row.className = 'message assistant-message';
        row.dataset.rawContent = rawText || '';

        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.innerHTML = formattedHtml;
        row.appendChild(contentDiv);

        AssistantMessageBubble.attachActionBar(row, rawText, options.onRetry);
        return row;
    }

    /**
     * Attaches or updates the action bar at the bottom of an assistant message.
     * @param {HTMLElement} assistantRow The .message.assistant-message element.
     * @param {string} rawText Raw text of the assistant response.
     * @param {Function} [onRetry] Callback when retry is clicked.
     */
    static attachActionBar(assistantRow, rawText, onRetry = null) {
        if (!assistantRow) return;

        const existingActions = assistantRow.querySelector('.message-actions');
        if (existingActions) existingActions.remove();

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'message-actions assistant-actions';

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'msg-action-btn copy-msg-btn';
        copyBtn.title = 'Copy response';
        copyBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
        copyBtn.addEventListener('click', () => {
            const textToCopy = rawText || assistantRow.dataset.rawContent || assistantRow.innerText;
            navigator.clipboard.writeText(textToCopy);
            copyBtn.classList.add('copied');
            setTimeout(() => copyBtn.classList.remove('copied'), 1500);
        });
        actionsDiv.appendChild(copyBtn);

        if (typeof onRetry === 'function') {
            const retryBtn = document.createElement('button');
            retryBtn.type = 'button';
            retryBtn.className = 'msg-action-btn retry-msg-btn';
            retryBtn.title = 'Retry turn';
            retryBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>';
            retryBtn.addEventListener('click', () => onRetry(assistantRow));
            actionsDiv.appendChild(retryBtn);
        }

        assistantRow.appendChild(actionsDiv);
    }
}

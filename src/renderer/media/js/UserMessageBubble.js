/**
 * UserMessageBubble encapsulates rendering of user message rows, text content,
 * hover action bars (copy text, edit prompt), and attached file pills.
 */
class UserMessageBubble {
    /**
     * Renders a user message bubble DOM element.
     * @param {string} text Raw message text.
     * @param {object} [options] Bubble options and action callbacks.
     * @param {Function} [options.onEdit] Callback invoked when user clicks the edit button.
     * @param {Function} [options.onCopy] Callback invoked when user clicks copy button.
     * @returns {HTMLElement} The created user message DOM element.
     */
    static render(text, options = {}) {
        const row = document.createElement('div');
        const isMulti = text && (text.includes('\n') || text.length > 80);
        row.className = `message user-message${isMulti ? ' is-multiline' : ''}`;
        row.dataset.rawContent = text;

        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.textContent = text;
        row.appendChild(contentDiv);

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'message-actions user-actions';

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'msg-action-btn copy-msg-btn';
        copyBtn.title = 'Copy prompt';
        copyBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(text);
            copyBtn.classList.add('copied');
            setTimeout(() => copyBtn.classList.remove('copied'), 1500);
        });
        actionsDiv.appendChild(copyBtn);

        if (typeof options.onEdit === 'function') {
            const editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'msg-action-btn edit-msg-btn';
            editBtn.title = 'Edit prompt';
            editBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
            editBtn.addEventListener('click', () => options.onEdit(row, text));
            actionsDiv.appendChild(editBtn);
        }

        row.appendChild(actionsDiv);
        return row;
    }
}

/**
 * InlinePromptEditor mounts an interactive in-place textarea editor
 * onto a user message bubble with auto-resizing and keyboard shortcuts.
 */
class InlinePromptEditor {
    /**
     * Mounts inline editor onto target user message row.
     * @param {HTMLElement} userRowElement Target .message.user-message DOM element.
     * @param {string} initialText Initial prompt text.
     * @param {Function} onSave Callback invoked with updated text upon submission.
     * @param {Function} [onCancel] Callback invoked when editing is cancelled.
     */
    static mount(userRowElement, initialText, onSave, onCancel = null) {
        if (!userRowElement) return;

        const contentEl = userRowElement.querySelector('.message-content');
        const actionsEl = userRowElement.querySelector('.message-actions');
        if (!contentEl) return;

        const originalDisplay = contentEl.style.display;
        contentEl.style.display = 'none';
        if (actionsEl) actionsEl.style.display = 'none';

        const editorContainer = document.createElement('div');
        editorContainer.className = 'inline-prompt-editor-container';

        const textarea = document.createElement('textarea');
        textarea.className = 'inline-prompt-textarea';
        textarea.value = initialText || '';
        textarea.rows = 2;

        const btnGroup = document.createElement('div');
        btnGroup.className = 'inline-prompt-btn-group';

        const saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'inline-prompt-save-btn';
        saveBtn.textContent = 'Save & Resubmit';

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'inline-prompt-cancel-btn';
        cancelBtn.textContent = 'Cancel';

        const cleanup = () => {
            editorContainer.remove();
            contentEl.style.display = originalDisplay;
            if (actionsEl) actionsEl.style.display = '';
        };

        const doSave = () => {
            const newText = textarea.value.trim();
            if (newText && newText !== initialText) {
                cleanup();
                onSave(newText);
            } else {
                cleanup();
                if (typeof onCancel === 'function') onCancel();
            }
        };

        const doCancel = () => {
            cleanup();
            if (typeof onCancel === 'function') onCancel();
        };

        saveBtn.addEventListener('click', doSave);
        cancelBtn.addEventListener('click', doCancel);

        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                doSave();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                doCancel();
            }
        });

        textarea.addEventListener('input', () => {
            textarea.style.height = 'auto';
            textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
        });

        btnGroup.appendChild(cancelBtn);
        btnGroup.appendChild(saveBtn);
        editorContainer.appendChild(textarea);
        editorContainer.appendChild(btnGroup);

        userRowElement.appendChild(editorContainer);
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        textarea.style.height = 'auto';
        textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
}

/**
 * HistoryManager manages rendering the persistent chat history list in the Left Sidebar,
 * active item highlights, click navigation, and session deletion.
 */
class HistoryManager {
    /**
     * Initializes history DOM references and listeners.
     * @param {WebviewIPCBridge} ipcBridge IPC bridge instance.
     * @param {Function} onViewSwitch Callback to switch active content view.
     * @param {Function} [onSelectChat] Callback invoked when a chat session is selected.
     */
    constructor(ipcBridge, onViewSwitch, onSelectChat = null) {
        this.ipcBridge = ipcBridge;
        this.onViewSwitch = onViewSwitch;
        this.onSelectChat = onSelectChat;
        this.onDeleteActiveChat = null;
        this.activeChatId = null;

        this.historyList = document.getElementById('history-list');
        this.cachedChats = [];

        // Instant render from localStorage cache on boot if available
        try {
            const localSaved = JSON.parse(localStorage.getItem('kai.savedChatsSummary') || '[]');
            if (localSaved.length > 0) {
                this.renderHistoryList(localSaved.map(c => ({
                    id: c.id,
                    title: c.title || 'New Chat',
                    timestamp: c.timestamp || Date.now()
                })));
            }
        } catch (e) {}

        // Request initial history load on startup
        this.ipcBridge.loadChatHistory();
    }

    /**
     * Registers a callback triggered when the currently opened active chat is deleted.
     * @param {Function} callback Function receiving deleted chatId.
     */
    setOnDeleteActiveChat(callback) {
        this.onDeleteActiveChat = callback;
    }

    /**
     * Sets the active chat ID and updates row highlight in sidebar.
     * @param {string} chatId Unique chat identifier.
     */
    setActiveChatId(chatId) {
        this.activeChatId = chatId;
        if (this.historyList) {
            const rows = this.historyList.querySelectorAll('.history-item');
            rows.forEach(row => {
                if (row.dataset.chatId === chatId) {
                    row.classList.add('active');
                } else {
                    row.classList.remove('active');
                }
            });
        }
    }

    /**
     * Formats timestamp into a concise single-line string (e.g., "14:32" or "23 Jul").
     * @param {number} timestamp Date timestamp.
     * @returns {string} Formatted compact time string.
     */
    formatHistoryTime(timestamp) {
        if (!timestamp) return '';
        const date = new Date(timestamp);
        const now = new Date();
        const isToday = date.toDateString() === now.toDateString();
        if (isToday) {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }

    /**
     * Renders the list of previous chat sessions in the Left Sidebar.
     * @param {Array<object>} chats List of saved chat session records.
     * @param {boolean} isWaitingForResponse Active generation status.
     */
    renderHistoryList(chats, isWaitingForResponse) {
        this.cachedChats = chats || [];
        if (!this.historyList) return;
        this.historyList.innerHTML = '';

        if (!chats || chats.length === 0) {
            const i18n = window.KAI_I18N || {};
            const emptyDiv = document.createElement('div');
            emptyDiv.className = 'history-empty-state';
            emptyDiv.textContent = i18n.noPreviousChats || 'No previous chats';
            this.historyList.appendChild(emptyDiv);
            return;
        }

        const chatSvg = `<svg class="history-item-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`;

        chats.forEach(chat => {
            const item = document.createElement('div');
            item.className = 'history-item';
            if (chat.id === this.activeChatId) {
                item.classList.add('active');
            }
            item.dataset.chatId = chat.id;
            item.title = chat.title || 'New Chat';
            
            const content = document.createElement('div');
            content.className = 'history-item-content';

            const iconSpan = document.createElement('span');
            iconSpan.className = 'history-item-icon-wrapper';
            iconSpan.innerHTML = chatSvg;

            const title = document.createElement('span');
            title.className = 'history-item-title';
            title.textContent = chat.title || 'New Chat';

            const time = document.createElement('span');
            time.className = 'history-item-time';
            time.textContent = this.formatHistoryTime(chat.timestamp);

            content.appendChild(iconSpan);
            content.appendChild(title);
            content.appendChild(time);
            
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'history-item-delete-btn';
            deleteBtn.title = 'Delete Chat';
            deleteBtn.innerHTML = window.KAI_SVGS['delete_item'] || `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
            
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const chatIdToDelete = chat.id;
                const wasActive = (this.activeChatId === chatIdToDelete);

                try {
                    let localSaved = JSON.parse(localStorage.getItem('kai.savedChatsSummary') || '[]');
                    localSaved = localSaved.filter(c => c.id !== chatIdToDelete);
                    localStorage.setItem('kai.savedChatsSummary', JSON.stringify(localSaved));
                    this.renderHistoryList(localSaved.map(c => ({
                        id: c.id,
                        title: c.title || 'New Chat',
                        timestamp: c.timestamp || Date.now()
                    })));
                } catch (err) {}

                this.ipcBridge.deleteChat(chatIdToDelete);

                if (wasActive && typeof this.onDeleteActiveChat === 'function') {
                    this.onDeleteActiveChat(chatIdToDelete);
                }
            });
            
            item.addEventListener('click', (e) => {
                if (e.target && e.target.closest && e.target.closest('.history-item-delete-btn')) {
                    return;
                }
                if (typeof isWaitingForResponse !== 'undefined' && isWaitingForResponse) {
                    this.ipcBridge.abort();
                }
                this.setActiveChatId(chat.id);
                if (typeof this.onSelectChat === 'function') {
                    this.onSelectChat(chat.id);
                } else {
                    this.ipcBridge.loadChat(chat.id);
                }
            });
            
            item.appendChild(content);
            item.appendChild(deleteBtn);
            this.historyList.appendChild(item);
        });
    }
}

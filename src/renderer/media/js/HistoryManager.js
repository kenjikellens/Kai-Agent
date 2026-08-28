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
     * Builds a single history item DOM node.
     * @param {object} chat Chat record.
     * @param {number} index Index in history list.
     * @param {boolean} shouldAnimate True if entrance animation should be applied.
     * @param {boolean} [isWaitingForResponse] Active generation status.
     * @returns {HTMLElement} History item row.
     */
    createHistoryItemElement(chat, index, shouldAnimate = true, isWaitingForResponse = false) {
        const chatSvg = `<svg class="history-item-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`;

        const item = document.createElement('div');
        item.className = 'history-item';
        if (shouldAnimate) {
            item.classList.add('animate-zoom-in');
            item.style.setProperty('--anim-delay', `calc(var(--history-item-anim-stagger, 50ms) * ${index})`);
            item.addEventListener('animationend', () => {
                item.classList.remove('animate-zoom-in');
                item.style.removeProperty('--anim-delay');
            }, { once: true });
        }

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
        return item;
    }

    /**
     * Renders or updates the list of previous chat sessions in the Left Sidebar without glitching.
     * @param {Array<object>} chats List of saved chat session records.
     * @param {boolean} isWaitingForResponse Active generation status.
     */
    renderHistoryList(chats, isWaitingForResponse) {
        this.cachedChats = chats || [];
        if (!this.historyList) return;

        if (!chats || chats.length === 0) {
            this.historyList.innerHTML = '';
            const i18n = window.KAI_I18N || {};
            const emptyDiv = document.createElement('div');
            emptyDiv.className = 'history-empty-state';
            emptyDiv.textContent = i18n.noPreviousChats || 'No previous chats';
            this.historyList.appendChild(emptyDiv);
            return;
        }

        // Remove empty state if present
        const emptyState = this.historyList.querySelector('.history-empty-state');
        if (emptyState) emptyState.remove();

        const existingItemsMap = new Map();
        this.historyList.querySelectorAll('.history-item').forEach(el => {
            if (el.dataset.chatId) {
                existingItemsMap.set(el.dataset.chatId, el);
            }
        });

        const isInitialRender = (existingItemsMap.size === 0);
        const validChatIds = new Set(chats.map(c => c.id));

        // Remove elements that are no longer in chats
        existingItemsMap.forEach((el, id) => {
            if (!validChatIds.has(id)) {
                el.remove();
            }
        });

        // Add or update elements in order
        chats.forEach((chat, index) => {
            const existingEl = existingItemsMap.get(chat.id);
            if (existingEl) {
                // Update text and timestamp in-place without restarting animation
                const titleSpan = existingEl.querySelector('.history-item-title');
                if (titleSpan && titleSpan.textContent !== (chat.title || 'New Chat')) {
                    titleSpan.textContent = chat.title || 'New Chat';
                    existingEl.title = chat.title || 'New Chat';
                }
                const timeSpan = existingEl.querySelector('.history-item-time');
                if (timeSpan) {
                    timeSpan.textContent = this.formatHistoryTime(chat.timestamp);
                }
                if (chat.id === this.activeChatId) {
                    existingEl.classList.add('active');
                } else {
                    existingEl.classList.remove('active');
                }
            } else {
                // New item: create and animate
                const newEl = this.createHistoryItemElement(chat, index, isInitialRender || true, isWaitingForResponse);
                
                // Position element properly in order
                const currentChildren = Array.from(this.historyList.children);
                if (index < currentChildren.length) {
                    this.historyList.insertBefore(newEl, currentChildren[index]);
                } else {
                    this.historyList.appendChild(newEl);
                }
            }
        });
    }
}

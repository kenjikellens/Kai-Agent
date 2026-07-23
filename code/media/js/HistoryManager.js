/**
 * HistoryManager manages rendering the chat history list overlay,
 * history item click events, and session deletion.
 */
class HistoryManager {
    /**
     * Initializes history DOM references and button click handlers.
     * @param {WebviewIPCBridge} ipcBridge IPC bridge instance.
     * @param {Function} onViewSwitch Callback to switch active content view.
     */
    constructor(ipcBridge, onViewSwitch) {
        this.ipcBridge = ipcBridge;
        this.onViewSwitch = onViewSwitch;

        this.historyContainer = document.getElementById('history-container');
        this.historyList = document.getElementById('history-list');
        this.historyBtn = document.getElementById('history-btn');
        this.closeHistoryBtn = document.getElementById('close-history-btn');

        this.initEventListeners();
    }

    /**
     * Registers top bar history button and close button click events.
     */
    initEventListeners() {
        if (this.historyBtn) {
            this.historyBtn.addEventListener('click', () => {
                this.ipcBridge.loadChatHistory();
                if (this.onViewSwitch) {
                    this.onViewSwitch('history');
                }
            });
        }

        if (this.closeHistoryBtn) {
            this.closeHistoryBtn.addEventListener('click', () => {
                if (this.onViewSwitch) {
                    this.onViewSwitch('chat');
                }
            });
        }
    }

    /**
     * Renders the list of previous chat sessions in the history overlay panel.
     * @param {Array<object>} chats List of saved chat session records.
     * @param {boolean} isWaitingForResponse Active generation status.
     */
    renderHistoryList(chats, isWaitingForResponse) {
        if (!this.historyList) return;
        this.historyList.innerHTML = '';

        if (!chats || chats.length === 0) {
            const i18n = window.KAI_I18N || {};
            const emptyDiv = document.createElement('div');
            emptyDiv.className = 'system-message';
            emptyDiv.style.padding = '20px';
            emptyDiv.textContent = i18n.noPreviousChats || 'No previous chats found.';
            this.historyList.appendChild(emptyDiv);
            return;
        }

        chats.forEach(chat => {
            const item = document.createElement('div');
            item.className = 'history-item';
            
            const details = document.createElement('div');
            details.className = 'history-item-details';
            
            const title = document.createElement('div');
            title.className = 'history-item-title';
            title.textContent = chat.title || 'New Chat';
            title.title = chat.title || 'New Chat';
            
            const time = document.createElement('div');
            time.className = 'history-item-time';
            const date = new Date(chat.timestamp);
            time.textContent = date.toLocaleString();
            
            details.appendChild(title);
            details.appendChild(time);
            
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'history-item-delete-btn';
            deleteBtn.title = 'Delete Chat';
            deleteBtn.innerHTML = window.KAI_SVGS['delete'] || '';
            
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.ipcBridge.deleteChat(chat.id);
            });
            
            item.addEventListener('click', () => {
                if (isWaitingForResponse) {
                    this.ipcBridge.abort();
                }
                this.ipcBridge.loadChat(chat.id);
                if (this.onViewSwitch) {
                    this.onViewSwitch('chat');
                }
            });
            
            item.appendChild(details);
            item.appendChild(deleteBtn);
            this.historyList.appendChild(item);
        });
    }
}

/**
 * SessionRepository provides a repository interface for loading, saving,
 * and deleting chat session histories with localStorage cache and IPC synchronization.
 */
class SessionRepository {
    /**
     * Initializes repository with reference to WebviewIPCBridge and auto-save timers.
     * @param {WebviewIPCBridge} [ipcBridge] IPC bridge instance.
     */
    constructor(ipcBridge = null) {
        this.ipcBridge = ipcBridge;
        this.storageKey = 'kai.savedChats';
        this._isDirty = false;
        this._pendingSession = null;
        this._debounceTimer = null;
    }

    /**
     * Retrieves all saved chat sessions from localStorage cache.
     * @returns {Array<object>} List of saved session objects.
     */
    getAllSessions() {
        try {
            return JSON.parse(localStorage.getItem(this.storageKey) || '[]');
        } catch (e) {
            console.error('SessionRepository: failed to read saved chats', e);
            return [];
        }
    }

    /**
     * Finds a single session by its unique chat ID.
     * @param {string} chatId Unique session identifier.
     * @returns {object|null} Found session object or null.
     */
    getSessionById(chatId) {
        if (!chatId) return null;
        const all = this.getAllSessions();
        return all.find(c => c.id === chatId) || null;
    }

    /**
     * Alias for getSessionById to find a single session.
     * @param {string} chatId Unique session identifier.
     * @returns {object|null} Found session object or null.
     */
    getSession(chatId) {
        return this.getSessionById(chatId);
    }

    /**
     * Marks session as dirty and triggers a 500ms debounced save.
     * @param {object} session Current session state.
     */
    markDirty(session) {
        this._pendingSession = session;
        this._isDirty = true;
        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
        }
        this._debounceTimer = setTimeout(() => {
            if (this._isDirty && this._pendingSession) {
                this.saveSession(this._pendingSession);
                this._isDirty = false;
                this._pendingSession = null;
            }
        }, 500);
    }

    /**
     * Saves or updates a session in localStorage and notifies backend.
     * @param {object} session Session object to persist.
     */
    saveSession(session) {
        if (!session || !session.id) return;
        if (!session.messages || session.messages.length === 0) return;
        const all = this.getAllSessions();
        const index = all.findIndex(c => c.id === session.id);
        if (index >= 0) {
            all[index] = session;
        } else {
            all.unshift(session);
        }
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(all));
        } catch (e) {
            console.error('SessionRepository: failed to save session', e);
        }

        if (this.ipcBridge && typeof this.ipcBridge.saveChat === 'function') {
            this.ipcBridge.saveChat(session);
        }
    }

    /**
     * Deletes a session by ID from localStorage and backend.
     * @param {string} chatId Unique chat identifier to delete.
     */
    deleteSession(chatId) {
        if (!chatId) return;
        const all = this.getAllSessions();
        const filtered = all.filter(c => c.id !== chatId);
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(filtered));
        } catch (e) {
            console.error('SessionRepository: failed to delete session', e);
        }

        if (this.ipcBridge && typeof this.ipcBridge.deleteChat === 'function') {
            this.ipcBridge.deleteChat(chatId);
        }
    }
}

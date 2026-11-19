/**
 * WorkspacesController manages known workspaces, groups saved chat sessions per workspace folder,
 * and renders interactive workspace containers inside the `#workspaces-container` main view.
 */
class WorkspacesController {
    /**
     * Initializes DOM references, storage state, and event delegation for the Workspaces view.
     * Binds action buttons for browsing folders, opening chats, and launching chats inside workspaces.
     * @param {object} [options] Configuration dependencies and navigation callbacks.
     */
    constructor(options = {}) {
        this.ipcBridge = options.ipcBridge || null;
        this.appState = options.appState || null;
        this.sessionRepository = options.sessionRepository || null;
        this.historyManager = options.historyManager || null;
        this.onOpenChat = typeof options.onOpenChat === 'function' ? options.onOpenChat : null;
        this.onNewChatInWorkspace = typeof options.onNewChatInWorkspace === 'function' ? options.onNewChatInWorkspace : null;
        this.onSelectWorkspace = typeof options.onSelectWorkspace === 'function' ? options.onSelectWorkspace : null;
        this.onClose = typeof options.onClose === 'function' ? options.onClose : null;

        this.storageKey = 'kai.knownWorkspaces';
        this.container = document.getElementById('workspaces-container');
        this.listContainer = document.getElementById('workspaces-list-container');
        this.browseBtn = document.getElementById('workspaces-browse-btn');
        this.closeBtn = document.getElementById('close-workspaces-btn');

        this._initEventListeners();
    }

    /**
     * Attaches header button listeners and delegated click handlers for workspace container cards.
     * Routes user actions to folder browsing, chat switching, or known-workspace cleanup.
     */
    _initEventListeners() {
        if (this.browseBtn) {
            this.browseBtn.addEventListener('click', () => {
                if (this.ipcBridge && typeof this.ipcBridge.browseWorkspaceFolder === 'function') {
                    this.ipcBridge.browseWorkspaceFolder();
                }
            });
        }

        if (this.closeBtn) {
            this.closeBtn.addEventListener('click', () => {
                if (this.onClose) {
                    this.onClose();
                }
            });
        }

        if (this.listContainer) {
            this.listContainer.addEventListener('click', (e) => {
                const actionEl = e.target.closest('[data-ws-action]');
                if (!actionEl) return;

                const action = actionEl.dataset.wsAction;
                if (action === 'browse-ws') {
                    if (this.ipcBridge && typeof this.ipcBridge.browseWorkspaceFolder === 'function') {
                        this.ipcBridge.browseWorkspaceFolder();
                    }
                    return;
                }

                if (action === 'open-chat') {
                    const chatId = actionEl.dataset.chatId;
                    if (chatId && this.onOpenChat) {
                        this.onOpenChat(chatId);
                    }
                    return;
                }

                const wsPath = actionEl.dataset.workspacePath || '';
                if (!wsPath) return;

                if (action === 'new-chat-ws' && this.onNewChatInWorkspace) {
                    this.onNewChatInWorkspace(wsPath);
                } else if (action === 'activate-ws' && this.onSelectWorkspace) {
                    this.onSelectWorkspace(wsPath);
                } else if (action === 'remove-ws') {
                    this.removeKnownWorkspace(wsPath);
                }
            });
        }
    }

    /**
     * Normalizes a filesystem path into a canonical map key for grouping workspace containers.
     * Strips trailing separators and folds ASCII drive/folder casing on Windows hosts.
     * @param {string} workspacePath Raw workspace directory path.
     * @returns {string} Canonical grouping key or empty string.
     */
    normalizeWorkspaceKey(workspacePath) {
        if (!workspacePath || typeof workspacePath !== 'string') return '';
        let normalized = workspacePath.trim().replace(/\\/g, '/');
        if (!normalized) return '';
        while (normalized.length > 1 && normalized.endsWith('/')) {
            if (/^[a-zA-Z]:\/$/.test(normalized)) break;
            normalized = normalized.slice(0, -1);
        }
        const isWindowsPath = /^[a-zA-Z]:/.test(normalized) || workspacePath.includes('\\');
        return isWindowsPath ? normalized.toLowerCase() : normalized;
    }

    /**
     * Extracts a concise display name for a workspace directory from its full path.
     * Falls back to the full normalized string for filesystem or drive roots.
     * @param {string} workspacePath Raw workspace directory path.
     * @returns {string} Human-readable folder title.
     */
    extractFolderName(workspacePath) {
        if (!workspacePath || typeof workspacePath !== 'string') return '';
        const cleaned = workspacePath.trim().replace(/[\\/]+$/, '');
        if (!cleaned) return workspacePath.trim();
        const parts = cleaned.split(/[\\/]/).filter(Boolean);
        return parts.length > 0 ? parts[parts.length - 1] : cleaned;
    }

    /**
     * Reads previously opened workspace directories from `localStorage`.
     * Returns an empty list safely when storage is unavailable or malformed.
     * @returns {Array<{path: string, lastUsedAt: number}>} Known workspace metadata records.
     */
    getKnownWorkspaces() {
        try {
            const raw = localStorage.getItem(this.storageKey);
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed)
                ? parsed.filter(item => item && typeof item.path === 'string' && item.path.trim())
                : [];
        } catch (e) {
            return [];
        }
    }

    /**
     * Persists a non-empty workspace path into the known workspaces list in `localStorage`.
     * Refreshes the Workspaces view immediately if `#workspaces-container` is currently visible.
     * @param {string} workspacePath Active workspace directory path to remember.
     */
    recordKnownWorkspace(workspacePath) {
        const key = this.normalizeWorkspaceKey(workspacePath);
        if (!key) return;
        const trimmed = workspacePath.trim();
        const existing = this.getKnownWorkspaces().filter(item => this.normalizeWorkspaceKey(item.path) !== key);
        const updated = [{ path: trimmed, lastUsedAt: Date.now() }, ...existing].slice(0, 30);
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(updated));
        } catch (e) {}
        if (this.isOpen()) {
            this.render();
        }
    }

    /**
     * Removes a workspace entry from `kai.knownWorkspaces` and re-renders the view.
     * Affects only locally pinned empty workspaces while preserving chat session history.
     * @param {string} workspacePath Workspace path to forget.
     */
    removeKnownWorkspace(workspacePath) {
        const key = this.normalizeWorkspaceKey(workspacePath);
        if (!key) return;
        const remaining = this.getKnownWorkspaces().filter(item => this.normalizeWorkspaceKey(item.path) !== key);
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(remaining));
        } catch (e) {}
        this.render();
    }

    /**
     * Returns whether `#workspaces-container` is currently visible in the main pane.
     * Used by host event listeners to decide when to trigger live re-renders.
     * @returns {boolean} True when the Workspaces view is open.
     */
    isOpen() {
        return Boolean(this.container && !this.container.classList.contains('hidden'));
    }

    /**
     * Merges history summaries (or cold-boot cache), known workspaces, and the active workspace
     * into deduplicated workspace containers, excluding chats without a bound workspace.
     * @returns {Array<object>} Sorted workspace container descriptors.
     */
    _collectGroupedWorkspaces() {
        const chatMap = new Map();
        const mergeChat = (record) => {
            if (!record || !record.id) return;
            const prev = chatMap.get(record.id) || {};
            chatMap.set(record.id, {
                id: record.id,
                title: record.title || prev.title || 'New Chat',
                timestamp: Number(record.timestamp) || Number(prev.timestamp) || 0,
                workspacePath: (record.workspacePath !== undefined && record.workspacePath !== null && String(record.workspacePath).trim() !== '')
                    ? String(record.workspacePath).trim()
                    : (prev.workspacePath || ''),
                mode: record.mode || prev.mode || ''
            });
        };

        const hasHostHistory = Boolean(this.historyManager && this.historyManager.hasLoadedFromHost);
        if (this.historyManager && Array.isArray(this.historyManager.cachedChats)) {
            this.historyManager.cachedChats.forEach(mergeChat);
        }
        if (!hasHostHistory && this.sessionRepository && typeof this.sessionRepository.getAllSessions === 'function') {
            this.sessionRepository.getAllSessions().forEach(mergeChat);
        }

        const activeWsPath = this.appState && this.appState.workspacePath ? this.appState.workspacePath.trim() : '';
        const activeWsKey = this.normalizeWorkspaceKey(activeWsPath);
        const groupsMap = new Map();

        /**
         * Ensures a workspace group descriptor exists in `groupsMap` for a normalized path key.
         * @param {string} wsPath Raw workspace directory path.
         * @param {number} [lastUsedAt=0] Latest usage timestamp for sort ordering.
         * @returns {object|null} Existing or newly created workspace group object.
         */
        const ensureGroup = (wsPath, lastUsedAt = 0) => {
            const key = this.normalizeWorkspaceKey(wsPath);
            if (!key) return null;
            if (!groupsMap.has(key)) {
                groupsMap.set(key, {
                    key,
                    displayPath: wsPath.trim(),
                    folderName: this.extractFolderName(wsPath),
                    isActive: Boolean(activeWsKey && key === activeWsKey),
                    lastActivity: lastUsedAt || 0,
                    chats: []
                });
            } else if (lastUsedAt > groupsMap.get(key).lastActivity) {
                groupsMap.get(key).lastActivity = lastUsedAt;
            }
            return groupsMap.get(key);
        };

        if (activeWsPath) {
            ensureGroup(activeWsPath, Date.now());
        }
        this.getKnownWorkspaces().forEach(item => {
            ensureGroup(item.path, Number(item.lastUsedAt) || 0);
        });

        chatMap.forEach(chat => {
            const wsKey = this.normalizeWorkspaceKey(chat.workspacePath);
            if (!wsKey) return;
            const group = ensureGroup(chat.workspacePath, chat.timestamp);
            if (group) {
                group.chats.push(chat);
                if (chat.timestamp > group.lastActivity) {
                    group.lastActivity = chat.timestamp;
                }
            }
        });

        const groups = Array.from(groupsMap.values());
        groups.forEach(group => {
            group.chats.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        });
        groups.sort((a, b) => {
            if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
            return (b.lastActivity || 0) - (a.lastActivity || 0);
        });

        return groups;
    }

    /**
     * Formats a localized singular or plural chat count string for a workspace container badge.
     * Avoids bare numeric digits next to folder titles without modifying controller state.
     * @param {number} count Number of chats in the workspace container.
     * @param {object} i18n Active translation dictionary.
     * @returns {string} Localized count string such as `"1 chat"` or `"3 chats"`.
     */
    _createChatCountLabel(count, i18n) {
        if (count === 1) {
            return i18n.chatCountSingular || '1 chat';
        }
        const tpl = i18n.chatCountPlural || '{count} chats';
        return tpl.replace('{count}', String(count));
    }

    /**
     * Creates a single chat row button for rendering inside a workspace group container.
     * Escapes text via `textContent` and marks the currently active chat session.
     * @param {object} chat Normalized chat metadata object.
     * @param {object} i18n Active translation dictionary.
     * @returns {HTMLButtonElement} Interactive chat row element.
     */
    _createChatRowElement(chat, i18n) {
        const currentChatId = (this.historyManager && this.historyManager.activeChatId)
            || (this.appState && this.appState.currentChatId)
            || '';
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'workspace-chat-row';
        if (chat.id === currentChatId) {
            row.classList.add('is-current');
        }
        row.dataset.wsAction = 'open-chat';
        row.dataset.chatId = chat.id;
        row.title = chat.title || 'New Chat';

        const iconWrap = document.createElement('span');
        iconWrap.className = 'workspace-chat-icon';
        iconWrap.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';

        const titleSpan = document.createElement('span');
        titleSpan.className = 'workspace-chat-title';
        titleSpan.textContent = chat.title || (i18n.newChat || 'New Chat');

        const metaWrap = document.createElement('span');
        metaWrap.className = 'workspace-chat-meta';

        if (chat.mode && chat.mode !== 'chat' && chat.mode !== 'ask') {
            const modeSpan = document.createElement('span');
            modeSpan.className = 'workspace-chat-mode';
            modeSpan.textContent = chat.mode === 'planning' ? 'Plan' : 'Agent';
            metaWrap.appendChild(modeSpan);
        }

        const timeSpan = document.createElement('span');
        timeSpan.className = 'workspace-chat-time';
        if (this.historyManager && typeof this.historyManager.formatHistoryTime === 'function') {
            timeSpan.textContent = this.historyManager.formatHistoryTime(chat.timestamp);
        }
        metaWrap.appendChild(timeSpan);

        row.appendChild(iconWrap);
        row.appendChild(titleSpan);
        row.appendChild(metaWrap);
        return row;
    }

    /**
     * Renders a visual container card for a single workspace folder and its nested chats.
     * Includes workspace identity header, action controls, and grouped session list.
     * @param {object} group Workspace container metadata and nested chats array.
     * @param {object} i18n Active translation dictionary.
     * @returns {HTMLElement} Rendered workspace container card element.
     */
    _createWorkspaceCardElement(group, i18n) {
        const card = document.createElement('section');
        card.className = 'workspace-group-card';
        if (group.isActive) {
            card.classList.add('workspace-group-card--active');
        }

        const header = document.createElement('div');
        header.className = 'workspace-group-header';

        const identity = document.createElement('div');
        identity.className = 'workspace-group-identity';

        const iconBox = document.createElement('span');
        iconBox.className = 'workspace-group-icon';
        iconBox.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>';

        const titleBlock = document.createElement('div');
        titleBlock.className = 'workspace-group-titles';

        const titleLine = document.createElement('div');
        titleLine.className = 'workspace-group-title-line';

        const nameEl = document.createElement('h3');
        nameEl.className = 'workspace-group-name';
        nameEl.textContent = group.folderName;
        titleLine.appendChild(nameEl);

        if (group.isActive) {
            const badgeEl = document.createElement('span');
            badgeEl.className = 'workspace-active-badge';
            badgeEl.textContent = i18n.activeWorkspaceBadge || 'Active';
            titleLine.appendChild(badgeEl);
        }

        const countEl = document.createElement('span');
        countEl.className = 'workspace-count-badge';
        countEl.textContent = this._createChatCountLabel(group.chats.length, i18n);
        titleLine.appendChild(countEl);

        const pathEl = document.createElement('div');
        pathEl.className = 'workspace-group-path';
        pathEl.textContent = group.displayPath;
        pathEl.title = group.displayPath;

        titleBlock.appendChild(titleLine);
        titleBlock.appendChild(pathEl);
        identity.appendChild(iconBox);
        identity.appendChild(titleBlock);

        const actions = document.createElement('div');
        actions.className = 'workspace-group-actions';

        if (!group.isActive) {
            const switchBtn = document.createElement('button');
            switchBtn.type = 'button';
            switchBtn.className = 'btn btn--secondary btn--sm';
            switchBtn.dataset.wsAction = 'activate-ws';
            switchBtn.dataset.workspacePath = group.displayPath;
            switchBtn.textContent = i18n.switchToWorkspace || 'Use Here';
            actions.appendChild(switchBtn);
        }

        const newChatBtn = document.createElement('button');
        newChatBtn.type = 'button';
        newChatBtn.className = 'btn btn--primary btn--sm btn--auto';
        newChatBtn.dataset.wsAction = 'new-chat-ws';
        newChatBtn.dataset.workspacePath = group.displayPath;
        newChatBtn.textContent = i18n.newChatInWorkspace || 'New Chat';
        actions.appendChild(newChatBtn);

        if (!group.isActive && group.chats.length === 0) {
            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'icon-btn icon-btn--header';
            removeBtn.dataset.wsAction = 'remove-ws';
            removeBtn.dataset.workspacePath = group.displayPath;
            removeBtn.title = i18n.close || 'Remove';
            removeBtn.setAttribute('aria-label', i18n.close || 'Remove');
            removeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
            actions.appendChild(removeBtn);
        }

        header.appendChild(identity);
        header.appendChild(actions);
        card.appendChild(header);

        const chatsList = document.createElement('div');
        chatsList.className = 'workspace-chats-list';
        if (group.chats.length > 0) {
            group.chats.forEach(chat => {
                chatsList.appendChild(this._createChatRowElement(chat, i18n));
            });
        } else {
            const emptyMsg = document.createElement('div');
            emptyMsg.className = 'workspace-chats-empty';
            emptyMsg.textContent = i18n.noChatsInWorkspace || 'No saved chats in this workspace yet';
            chatsList.appendChild(emptyMsg);
        }

        card.appendChild(chatsList);
        return card;
    }

    /**
     * Rebuilds the Workspaces container DOM from merged session and workspace records.
     * Renders only genuine workspace containers inside `#workspaces-list-container`.
     */
    render() {
        if (!this.listContainer) return;
        const i18n = window.KAI_I18N || {};
        const groups = this._collectGroupedWorkspaces();
        this.listContainer.innerHTML = '';

        if (groups.length === 0) {
            const emptyState = document.createElement('div');
            emptyState.className = 'workspaces-empty-state';

            const emptyText = document.createElement('p');
            emptyText.className = 'workspaces-empty-text';
            emptyText.textContent = i18n.noWorkspacesEmpty || 'No workspaces selected yet. Choose a folder to group your project chats.';

            const ctaBtn = document.createElement('button');
            ctaBtn.type = 'button';
            ctaBtn.className = 'btn btn--primary btn--sm btn--auto';
            ctaBtn.dataset.wsAction = 'browse-ws';
            ctaBtn.textContent = i18n.openWorkspaceFolder || 'Open Workspace';

            emptyState.appendChild(emptyText);
            emptyState.appendChild(ctaBtn);
            this.listContainer.appendChild(emptyState);
            return;
        }

        groups.forEach(group => {
            this.listContainer.appendChild(this._createWorkspaceCardElement(group, i18n));
        });
    }
}

import * as vscode from 'vscode';

/**
 * Interface representing a chat session record stored in Memento persistence.
 */
export interface ChatSessionRecord {
    /** Unique session identifier. */
    id: string;
    /** Display title for the session. */
    title: string;
    /** Array of stored chat message objects. */
    messages: any[];
    /** Array of stored UI event logs. */
    uiEvents?: any[];
    /** Active model identifier used in session. */
    model?: string;
    /** Reasoning thinking toggle flag. */
    thinking?: boolean;
    /** Timestamp of last interaction in milliseconds. */
    timestamp: number;
}

/**
 * SessionStore encapsulates reading, writing, and deleting persistent chat history
 * records in VS Code workspaceState / Memento storage.
 */
export class SessionStore {
    private static readonly STORAGE_KEY = 'kai.chats';

    /**
     * Initializes a new instance of SessionStore.
     * @param memento The VS Code Memento storage instance (workspaceState or globalState).
     */
    constructor(private readonly memento: vscode.Memento) {}

    /**
     * Retrieves the sorted array of all saved chat session records.
     * @returns Array of chat sessions sorted by timestamp descending.
     */
    public getHistoryList(): ChatSessionRecord[] {
        const chatsMap = this.memento.get<Record<string, ChatSessionRecord>>(SessionStore.STORAGE_KEY) || {};
        return Object.values(chatsMap).sort((a, b) => b.timestamp - a.timestamp);
    }

    /**
     * Retrieves a specific chat session record by its unique ID.
     * @param chatId The unique chat session ID.
     * @returns The ChatSessionRecord if found, or undefined.
     */
    public getChat(chatId: string): ChatSessionRecord | undefined {
        const chatsMap = this.memento.get<Record<string, ChatSessionRecord>>(SessionStore.STORAGE_KEY) || {};
        return chatsMap[chatId];
    }

    /**
     * Saves or updates a chat session record in persistent storage.
     * @param chat The ChatSessionRecord object to persist.
     */
    public async saveChat(chat: any): Promise<void> {
        if (!chat || !chat.id) {
            return;
        }
        const chatsMap = this.memento.get<Record<string, ChatSessionRecord>>(SessionStore.STORAGE_KEY) || {};
        chatsMap[chat.id] = {
            id: chat.id,
            title: chat.title || 'New Chat',
            messages: chat.messages || [],
            uiEvents: chat.uiEvents || [],
            model: chat.model || '',
            thinking: chat.thinking !== false,
            timestamp: chat.timestamp || Date.now()
        };
        await this.memento.update(SessionStore.STORAGE_KEY, chatsMap);
    }

    /**
     * Deletes a chat session record by its unique ID from persistent storage.
     * @param chatId The ID of the chat session to remove.
     * @returns Updated sorted array of remaining chat session records.
     */
    public async deleteChat(chatId: string): Promise<ChatSessionRecord[]> {
        if (!chatId) {
            return this.getHistoryList();
        }
        const chatsMap = this.memento.get<Record<string, ChatSessionRecord>>(SessionStore.STORAGE_KEY) || {};
        if (chatsMap[chatId]) {
            delete chatsMap[chatId];
            await this.memento.update(SessionStore.STORAGE_KEY, chatsMap);
        }
        return this.getHistoryList();
    }
}

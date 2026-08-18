import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Interface representing a chat session record stored in disk persistence.
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
 * records from a local JSON file in `~/.kai-agent/sessions.json`.
 */
export class SessionStore {
    private storagePath: string;
    private cache: Record<string, ChatSessionRecord> = {};

    /**
     * Initializes a new instance of SessionStore.
     */
    constructor() {
        const homeDir = os.homedir();
        const baseDir = path.join(homeDir, '.kai-agent');
        if (!fs.existsSync(baseDir)) {
            fs.mkdirSync(baseDir, { recursive: true });
        }
        this.storagePath = path.join(baseDir, 'sessions.json');
        this.load();
    }

    /**
     * Reads all sessions from disk into memory cache.
     */
    private load(): void {
        try {
            if (fs.existsSync(this.storagePath)) {
                const data = fs.readFileSync(this.storagePath, 'utf8');
                this.cache = JSON.parse(data);
            }
        } catch (e) {
            console.error('Failed to load sessions.json:', e);
            this.cache = {};
        }
    }

    /**
     * Writes memory cache back to disk.
     */
    private save(): void {
        try {
            fs.writeFileSync(this.storagePath, JSON.stringify(this.cache, null, 2), 'utf8');
        } catch (e) {
            console.error('Failed to save sessions.json:', e);
        }
    }

    /**
     * Retrieves the sorted array of all saved chat session records.
     * @returns Array of chat sessions sorted by timestamp descending.
     */
    public getHistoryList(): ChatSessionRecord[] {
        return Object.values(this.cache).sort((a, b) => b.timestamp - a.timestamp);
    }

    /**
     * Retrieves a specific chat session record by its unique ID.
     * @param chatId The unique chat session ID.
     * @returns The ChatSessionRecord if found, or undefined.
     */
    public getChat(chatId: string): ChatSessionRecord | undefined {
        return this.cache[chatId];
    }

    /**
     * Saves or updates a chat session record in persistent storage.
     * @param chat The ChatSessionRecord object to persist.
     */
    public async saveChat(chat: any): Promise<void> {
        if (!chat || !chat.id) {
            return;
        }
        this.cache[chat.id] = {
            id: chat.id,
            title: chat.title || 'New Chat',
            messages: chat.messages || [],
            uiEvents: chat.uiEvents || [],
            model: chat.model || '',
            thinking: chat.thinking !== false,
            timestamp: chat.timestamp || Date.now()
        };
        this.save();
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
        if (this.cache[chatId]) {
            delete this.cache[chatId];
            this.save();
        }
        return this.getHistoryList();
    }
}

import * as fs from 'fs';
import * as path from 'path';

/**
 * Snapshot record capturing pre-mutation file state for a specific turn.
 */
export interface FileSnapshot {
    type: 'modify' | 'create' | 'delete';
    path: string;
    originalContent: string | null;
    timestamp: number;
}

/**
 * TurnSnapshotManager tracks pre-mutation file states across tool execution turns
 * and provides safe in-order rollback when a turn is retried or an earlier prompt is edited.
 */
export class TurnSnapshotManager {
    private static instance: TurnSnapshotManager;
    /** Map of turnId -> Array of FileSnapshot records in execution order */
    private snapshotsByTurn: Map<string, FileSnapshot[]> = new Map();

    private constructor() {}

    /**
     * Returns the singleton TurnSnapshotManager instance.
     */
    public static getInstance(): TurnSnapshotManager {
        if (!TurnSnapshotManager.instance) {
            TurnSnapshotManager.instance = new TurnSnapshotManager();
        }
        return TurnSnapshotManager.instance;
    }

    /**
     * Records a file's pre-mutation state before a write or edit tool runs.
     * Preserves the earliest snapshot if the file is modified multiple times in the same turn.
     * @param turnId The active turn or chat ID.
     * @param targetPath Absolute path to the file.
     */
    public async recordBeforeMutation(turnId: string, targetPath: string): Promise<void> {
        if (!turnId || !targetPath) return;

        let turnList = this.snapshotsByTurn.get(turnId);
        if (!turnList) {
            turnList = [];
            this.snapshotsByTurn.set(turnId, turnList);
        }

        // Only store the original baseline if this file hasn't been captured in this turn yet
        const normalizedPath = path.normalize(targetPath);
        if (turnList.some(s => path.normalize(s.path) === normalizedPath)) {
            return;
        }

        try {
            if (fs.existsSync(normalizedPath)) {
                const stat = await fs.promises.stat(normalizedPath);
                if (stat.isFile()) {
                    const content = await fs.promises.readFile(normalizedPath, 'utf8');
                    turnList.push({
                        type: 'modify',
                        path: normalizedPath,
                        originalContent: content,
                        timestamp: Date.now()
                    });
                }
            } else {
                turnList.push({
                    type: 'create',
                    path: normalizedPath,
                    originalContent: null,
                    timestamp: Date.now()
                });
            }
        } catch (e) {
            console.error(`[TurnSnapshotManager] Failed to record snapshot for ${normalizedPath}:`, e);
        }
    }

    /**
     * Records a file's content before it is deleted by delete_item.
     * @param turnId The active turn ID.
     * @param targetPath Absolute path to the file to be deleted.
     */
    public async recordBeforeDeletion(turnId: string, targetPath: string): Promise<void> {
        if (!turnId || !targetPath) return;

        let turnList = this.snapshotsByTurn.get(turnId);
        if (!turnList) {
            turnList = [];
            this.snapshotsByTurn.set(turnId, turnList);
        }

        const normalizedPath = path.normalize(targetPath);
        try {
            if (fs.existsSync(normalizedPath)) {
                const stat = await fs.promises.stat(normalizedPath);
                if (stat.isFile()) {
                    const content = await fs.promises.readFile(normalizedPath, 'utf8');
                    turnList.push({
                        type: 'delete',
                        path: normalizedPath,
                        originalContent: content,
                        timestamp: Date.now()
                    });
                }
            }
        } catch (e) {
            console.error(`[TurnSnapshotManager] Failed to record deletion snapshot for ${normalizedPath}:`, e);
        }
    }

    /**
     * Rolls back all recorded file mutations for the specified turn ID(s) in reverse order.
     * @param turnIds Single turn ID or array of turn IDs to revert.
     * @returns Object with list of reverted files and status.
     */
    public async rollbackTurn(turnIds: string | string[]): Promise<{ status: string; reverted: string[] }> {
        const ids = Array.isArray(turnIds) ? turnIds : [turnIds];
        const revertedFiles: string[] = [];

        for (const id of ids.reverse()) {
            const snapshots = this.snapshotsByTurn.get(id);
            if (!snapshots || snapshots.length === 0) continue;

            // Revert operations in reverse order
            for (let i = snapshots.length - 1; i >= 0; i--) {
                const snap = snapshots[i];
                try {
                    if (snap.type === 'create') {
                        // File was created during this turn -> delete it
                        if (fs.existsSync(snap.path)) {
                            await fs.promises.unlink(snap.path);
                            revertedFiles.push(snap.path);
                        }
                    } else if (snap.type === 'modify' || snap.type === 'delete') {
                        // File was modified or deleted -> restore original content
                        if (snap.originalContent !== null) {
                            const parentDir = path.dirname(snap.path);
                            if (!fs.existsSync(parentDir)) {
                                await fs.promises.mkdir(parentDir, { recursive: true });
                            }
                            await fs.promises.writeFile(snap.path, snap.originalContent, 'utf8');
                            revertedFiles.push(snap.path);
                        }
                    }
                } catch (e) {
                    console.error(`[TurnSnapshotManager] Failed to rollback ${snap.path}:`, e);
                }
            }

            this.snapshotsByTurn.delete(id);
        }

        return {
            status: 'ok',
            reverted: Array.from(new Set(revertedFiles))
        };
    }

    /**
     * Clears snapshot records for a deleted chat session.
     * @param turnId The chat/turn ID to clear.
     */
    public clearTurn(turnId: string): void {
        this.snapshotsByTurn.delete(turnId);
    }
}

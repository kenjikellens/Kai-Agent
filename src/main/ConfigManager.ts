import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { KaiConfig, DEFAULT_CONFIG } from './types/config';

/**
 * ConfigManager manages reading, updating, and saving user configuration
 * to a local JSON file in the user's home directory (`~/.kai-agent/config.json`).
 */
export class ConfigManager {
    private static instance: ConfigManager;
    private configPath: string;
    private config: KaiConfig;

    private static readonly SECRET_KEYS: (keyof KaiConfig)[] = [
        'apiKey',
        'mistralApiKey',
        'cohereApiKey',
        'cerebrasApiKey',
        'zhipuApiKey',
        'openrouterApiKey',
        'omnirouteApiKey'
    ];
    private static readonly ENC_PREFIX = 'enc:v1:';

    /**
     * Initializes config directory and loads existing config file or defaults.
     */
    private constructor() {
        const homeDir = os.homedir();
        const baseDir = path.join(homeDir, '.kai-agent');
        if (!fs.existsSync(baseDir)) {
            fs.mkdirSync(baseDir, { recursive: true, mode: 0o700 });
        }
        this.configPath = path.join(baseDir, 'config.json');
        this.config = this.loadConfig();
    }

    /** Returns Electron safeStorage when running inside Electron Main, otherwise null. */
    private getSafeStorage(): { isEncryptionAvailable: () => boolean; encryptString: (s: string) => Buffer; decryptString: (b: Buffer) => string } | null {
        try {
            const electron = require('electron');
            if (electron && electron.safeStorage && electron.safeStorage.isEncryptionAvailable()) {
                return electron.safeStorage;
            }
        } catch {}
        return null;
    }

    /** Decrypts enc:v1: secret fields in memory when safeStorage is available. */
    private decryptSecrets(cfg: KaiConfig): KaiConfig {
        const safe = this.getSafeStorage();
        const out: any = { ...cfg };
        for (const key of ConfigManager.SECRET_KEYS) {
            const val = out[key];
            if (typeof val === 'string' && val.startsWith(ConfigManager.ENC_PREFIX)) {
                if (safe) {
                    try {
                        const raw = Buffer.from(val.slice(ConfigManager.ENC_PREFIX.length), 'base64');
                        out[key] = safe.decryptString(raw);
                    } catch {
                        out[key] = '';
                    }
                } else {
                    out[key] = '';
                }
            }
        }
        return out as KaiConfig;
    }

    /** Encrypts secret fields before persisting config.json to disk. */
    private encryptSecrets(cfg: KaiConfig): KaiConfig {
        const safe = this.getSafeStorage();
        if (!safe) return { ...cfg };
        const out: any = { ...cfg };
        for (const key of ConfigManager.SECRET_KEYS) {
            const val = out[key];
            if (typeof val === 'string' && val.length > 0 && !val.startsWith(ConfigManager.ENC_PREFIX)) {
                try {
                    out[key] = ConfigManager.ENC_PREFIX + safe.encryptString(val).toString('base64');
                } catch {}
            }
        }
        return out as KaiConfig;
    }

    /**
     * Singleton instance accessor.
     */
    public static getInstance(): ConfigManager {
        if (!ConfigManager.instance) {
            ConfigManager.instance = new ConfigManager();
        }
        return ConfigManager.instance;
    }

    /**
     * Reads config file from disk.
     */
    private loadConfig(): KaiConfig {
        try {
            if (fs.existsSync(this.configPath)) {
                const raw = fs.readFileSync(this.configPath, 'utf8');
                return this.decryptSecrets({ ...DEFAULT_CONFIG, ...JSON.parse(raw) });
            }
        } catch (e) {
            console.error('Failed to parse config.json, using defaults:', e);
        }
        return { ...DEFAULT_CONFIG };
    }

    /**
     * Retrieves the entire active configuration object.
     */
    public getConfig(): KaiConfig {
        return { ...this.config };
    }

    /**
     * Retrieves a specific configuration property by key.
     * @param key Config key name.
     */
    public get<K extends keyof KaiConfig>(key: K): KaiConfig[K] {
        return this.config[key];
    }

    /**
     * Updates one or multiple configuration values and persists them to disk.
     * @param updates Partial configuration object.
     */
    public update(updates: Partial<KaiConfig>): void {
        this.config = { ...this.config, ...updates };
        try {
            const toPersist = this.encryptSecrets(this.config);
            fs.writeFileSync(this.configPath, JSON.stringify(toPersist, null, 2), { encoding: 'utf8', mode: 0o600 });
        } catch (e) {
            console.error('Failed to write config.json:', e);
        }
    }
}

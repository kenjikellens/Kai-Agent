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

    /**
     * Initializes config directory and loads existing config file or defaults.
     */
    private constructor() {
        const homeDir = os.homedir();
        const baseDir = path.join(homeDir, '.kai-agent');
        if (!fs.existsSync(baseDir)) {
            fs.mkdirSync(baseDir, { recursive: true });
        }
        this.configPath = path.join(baseDir, 'config.json');
        this.config = this.loadConfig();
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
                return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
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
            fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');
        } catch (e) {
            console.error('Failed to write config.json:', e);
        }
    }
}

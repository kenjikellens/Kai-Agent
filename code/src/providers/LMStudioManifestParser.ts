import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Represents a single configurable UI field defined in an LM Studio model manifest.
 */
export interface ManifestField {
    displayName: string;
    type: 'boolean' | 'select';
    variable: string;
    defaultValue: any;
    options?: Array<{ label: string; value: string }>;
}

/**
 * Model capabilities extracted 100% from LM Studio's native manifest cache.
 */
export interface ModelCapabilities {
    modelId: string;
    displayName: string;
    domain: string;
    fields: ManifestField[];
    isReasoning: boolean;
}

/**
 * Cache validation report containing status, path, and model count.
 */
export interface CacheValidationResult {
    valid: boolean;
    path: string;
    modelCount: number;
    error?: string;
}

/**
 * Dedicated service class for parsing LM Studio model manifests, index caches, and capability definitions.
 */
export class LMStudioManifestParser {
    /**
     * Returns an ordered list of candidate directory paths where LM Studio may store cache and configuration.
     * @param customDir Optional custom directory specified by the user.
     * @returns Array of candidate absolute directory paths.
     */
    public static getCandidateCachePaths(customDir?: string): string[] {
        const candidates: string[] = [];
        if (customDir && customDir.trim().length > 0) {
            candidates.push(customDir.trim());
        }

        const homeDir = os.homedir();
        // Modern LM Studio 0.3+ directory on Windows & Linux
        candidates.push(path.join(homeDir, '.cache', 'lm-studio'));
        // Legacy / macOS LM Studio directory
        candidates.push(path.join(homeDir, '.lmstudio'));

        // Windows LocalAppData / AppData locations
        if (process.env.LOCALAPPDATA) {
            candidates.push(path.join(process.env.LOCALAPPDATA, 'LM Studio'));
            candidates.push(path.join(process.env.LOCALAPPDATA, 'lm-studio'));
        }
        if (process.env.APPDATA) {
            candidates.push(path.join(process.env.APPDATA, 'LM Studio'));
        }

        return candidates;
    }

    /**
     * Resolves the active LM Studio home directory by checking candidates in priority order.
     * @param customDir Optional custom base directory.
     * @returns Absolute path to the resolved LM Studio directory.
     */
    public static resolveDefaultCachePath(customDir?: string): string {
        const candidates = LMStudioManifestParser.getCandidateCachePaths(customDir);
        for (const candidate of candidates) {
            try {
                if (fs.existsSync(candidate)) {
                    const cacheFileDirect = candidate.endsWith('model-index-cache.json')
                        ? candidate
                        : (candidate.endsWith('.internal')
                            ? path.join(candidate, 'model-index-cache.json')
                            : path.join(candidate, '.internal', 'model-index-cache.json'));
                    if (fs.existsSync(cacheFileDirect)) {
                        return candidate;
                    }
                }
            } catch {
                // continue to next candidate
            }
        }

        for (const candidate of candidates) {
            try {
                if (fs.existsSync(candidate)) {
                    return candidate;
                }
            } catch {
                // continue
            }
        }

        return candidates[0] || path.join(os.homedir(), '.cache', 'lm-studio');
    }

    /**
     * Resolves the full path to the model-index-cache.json file across known candidate paths.
     * @param cacheDir Optional custom base directory path.
     * @returns Absolute path to model-index-cache.json.
     */
    public static resolveIndexCacheFilePath(cacheDir?: string): string {
        if (cacheDir && cacheDir.trim().length > 0) {
            const trimmed = cacheDir.trim();
            if (trimmed.endsWith('model-index-cache.json')) {
                return trimmed;
            }
            if (trimmed.endsWith('.internal')) {
                return path.join(trimmed, 'model-index-cache.json');
            }
            return path.join(trimmed, '.internal', 'model-index-cache.json');
        }

        const candidates = LMStudioManifestParser.getCandidateCachePaths();
        for (const candidate of candidates) {
            try {
                const targetPath = candidate.endsWith('model-index-cache.json')
                    ? candidate
                    : (candidate.endsWith('.internal')
                        ? path.join(candidate, 'model-index-cache.json')
                        : path.join(candidate, '.internal', 'model-index-cache.json'));
                if (fs.existsSync(targetPath)) {
                    return targetPath;
                }
            } catch {
                // continue searching
            }
        }

        const defaultDir = LMStudioManifestParser.resolveDefaultCachePath();
        return path.join(defaultDir, '.internal', 'model-index-cache.json');
    }

    /**
     * Resolves the full path to the LM Studio CLI executable (lms.exe or lms).
     * @param customDir Optional custom cache directory path.
     * @returns Executable path or default 'lms' command name.
     */
    public static resolveLmsExecutablePath(customDir?: string): string {
        const exeName = process.platform === 'win32' ? 'lms.exe' : 'lms';
        const candidates = LMStudioManifestParser.getCandidateCachePaths(customDir);

        for (const candidate of candidates) {
            try {
                const binPath = path.join(candidate, 'bin', exeName);
                if (fs.existsSync(binPath)) {
                    return binPath;
                }
            } catch {
                // continue
            }
        }

        return 'lms';
    }

    /**
     * Validates whether the LM Studio cache index exists and contains valid JSON models.
     * @param cacheDir Base directory or custom path.
     * @returns Validation result with model count and status.
     */
    public static validateCache(cacheDir?: string): CacheValidationResult {
        const filePath = LMStudioManifestParser.resolveIndexCacheFilePath(cacheDir);
        try {
            if (!fs.existsSync(filePath)) {
                return {
                    valid: false,
                    path: filePath,
                    modelCount: 0,
                    error: `Cache index niet gevonden op: ${filePath}`
                };
            }

            const rawContent = fs.readFileSync(filePath, 'utf8');
            const data = JSON.parse(rawContent);

            if (!data || !Array.isArray(data.models)) {
                return {
                    valid: false,
                    path: filePath,
                    modelCount: 0,
                    error: 'Ongeldig JSON-formaat in model-index-cache.json'
                };
            }

            // Count unique LLM (chat) models by distinct displayName/identifier
            const chatModels = data.models.filter((m: any) => m.domain !== 'embedding');
            const uniqueModels = new Set(chatModels.map((m: any) => m.displayName || m.indexedModelIdentifier));

            return {
                valid: true,
                path: filePath,
                modelCount: uniqueModels.size
            };
        } catch (err: any) {
            return {
                valid: false,
                path: filePath,
                modelCount: 0,
                error: err?.message || 'Onbekende fout bij inlezen van LM Studio cache'
            };
        }
    }

    /**
     * Parses all model capabilities from the LM Studio model index cache.
     * Maps capabilities across all aliases (indexedModelIdentifier, defaultIdentifier).
     * @param cacheDir Base directory or custom path.
     * @returns Map of model identifier strings to ModelCapabilities.
     */
    public static parseModelCapabilities(cacheDir?: string): Record<string, ModelCapabilities> {
        const capabilitiesMap: Record<string, ModelCapabilities> = {};
        const filePath = LMStudioManifestParser.resolveIndexCacheFilePath(cacheDir);

        try {
            if (!fs.existsSync(filePath)) {
                return capabilitiesMap;
            }

            const rawContent = fs.readFileSync(filePath, 'utf8');
            const data = JSON.parse(rawContent);

            if (!data || !Array.isArray(data.models)) {
                return capabilitiesMap;
            }

            for (const modelEntry of data.models) {
                const domain = modelEntry.domain || 'llm';
                const displayName = modelEntry.displayName || modelEntry.indexedModelIdentifier || '';
                const isReasoning = Boolean(modelEntry.virtual?.metadataOverridesReasoning);

                const fields: ManifestField[] = [];
                const rawCustomFields = modelEntry.virtual?.customFieldDefinitions;

                if (Array.isArray(rawCustomFields)) {
                    for (const cf of rawCustomFields) {
                        const type = cf.type === 'select' ? 'select' : 'boolean';
                        let variable = '';

                        if (Array.isArray(cf.effects) && cf.effects.length > 0) {
                            variable = cf.effects[0].variable || '';
                        }

                        // Skip fields without a mapped Jinja variable or preserveThinking
                        if (!variable || variable === 'preserve_thinking' || variable === 'preserveThinking' || (cf.key && cf.key.includes('preserveThinking'))) {
                            continue;
                        }

                        const manifestField: ManifestField = {
                            displayName: cf.displayName || variable,
                            type: type,
                            variable: variable,
                            defaultValue: cf.defaultValue !== undefined ? cf.defaultValue : (type === 'boolean' ? true : 'xhigh')
                        };

                        if (type === 'select' && Array.isArray(cf.options)) {
                            manifestField.options = cf.options.map((opt: any) => ({
                                label: opt.label || opt.value || '',
                                value: opt.value || opt.label || ''
                            }));
                        }

                        fields.push(manifestField);
                    }
                }

                const cap: ModelCapabilities = {
                    modelId: modelEntry.indexedModelIdentifier,
                    displayName: displayName,
                    domain: domain,
                    fields: fields,
                    isReasoning: isReasoning
                };

                // Index under all known identifiers and aliases (case-insensitive keys for robust lookup)
                const aliases: string[] = [
                    modelEntry.indexedModelIdentifier,
                    modelEntry.defaultIdentifier,
                    modelEntry.originalIndexedModelIdentifier,
                    modelEntry.altIndexedModelIdentifier
                ].filter(Boolean);

                if (modelEntry.indexedModelIdentifier && modelEntry.indexedModelIdentifier.includes('@')) {
                    aliases.push(modelEntry.indexedModelIdentifier.split('@')[0]);
                }

                for (const alias of aliases) {
                    if (alias) {
                        capabilitiesMap[alias] = cap;
                        capabilitiesMap[alias.toLowerCase()] = cap;
                    }
                }
            }

            return capabilitiesMap;
        } catch {
            return capabilitiesMap;
        }
    }
}

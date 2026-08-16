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
     * Resolves the default LM Studio home directory (~/.lmstudio).
     * @returns Absolute path to ~/.lmstudio directory.
     */
    public static resolveDefaultCachePath(): string {
        return path.join(os.homedir(), '.lmstudio');
    }

    /**
     * Resolves the full path to the model-index-cache.json file.
     * @param cacheDir Optional custom base directory path.
     * @returns Absolute path to model-index-cache.json.
     */
    public static resolveIndexCacheFilePath(cacheDir?: string): string {
        const baseDir = (cacheDir && cacheDir.trim().length > 0)
            ? cacheDir.trim()
            : LMStudioManifestParser.resolveDefaultCachePath();
        
        // If user directly selected the .internal directory or the json file itself
        if (baseDir.endsWith('model-index-cache.json')) {
            return baseDir;
        }
        if (baseDir.endsWith('.internal')) {
            return path.join(baseDir, 'model-index-cache.json');
        }
        return path.join(baseDir, '.internal', 'model-index-cache.json');
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

            // Count LLM (chat) models
            const chatModels = data.models.filter((m: any) => m.domain !== 'embedding');

            return {
                valid: true,
                path: filePath,
                modelCount: chatModels.length
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

                        // Skip fields without a mapped Jinja variable
                        if (!variable) {
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

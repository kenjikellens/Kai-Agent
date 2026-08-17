import * as vscode from 'vscode';
import { ModelCapabilities } from './LMStudioManifestParser';

/**
 * Model reasoning profile configuration interface for custom overrides.
 */
export interface LMStudioModelProfile {
    reasoningType?: 'qwen_template' | 'gemma_flag' | 'mistral_effort' | 'deepseek_tokens' | 'custom' | 'none';
    customParamsOn?: Record<string, any>;
    customParamsOff?: Record<string, any>;
}

/**
 * LMStudioReasoningEngine manages model capability detection, thinking parameter injection,
 * reasoning effort configuration, and embedding model filtering for local LM Studio instances.
 */
export class LMStudioReasoningEngine {
    /**
     * Determines whether a given model ID represents an embedding model rather than a chat completion model.
     * @param modelId Model identifier string.
     * @returns True if model is an embedding model.
     */
    public static isEmbeddingModel(modelId: string): boolean {
        if (!modelId) return false;
        const lower = modelId.toLowerCase();
        return (
            lower.includes('embed') ||
            lower.includes('embedding') ||
            lower.includes('nomic-embed') ||
            lower.includes('bge-') ||
            lower.includes('e5-') ||
            lower.includes('gte-') ||
            lower.includes('minilm')
        );
    }

    /**
     * Filters out non-chat models (such as embedding models) from a list of model IDs.
     * @param models List of model ID strings.
     * @returns Filtered array of chat model IDs.
     */
    public static filterChatModels(models: string[]): string[] {
        if (!Array.isArray(models)) return [];
        return models.filter(m => m && !LMStudioReasoningEngine.isEmbeddingModel(m));
    }

    /**
     * Retrieves user-defined model profiles from VS Code workspace configuration.
     * @returns Map of model IDs to custom reasoning profiles.
     */
    public static getUserProfiles(): Record<string, LMStudioModelProfile> {
        try {
            const config = vscode.workspace.getConfiguration('kai');
            return config.get<Record<string, LMStudioModelProfile>>('lmStudioModelProfiles') || {};
        } catch {
            return {};
        }
    }

    /**
     * Checks whether a model is capable of reasoning or thinking toggles.
     * @param modelId Target model ID string.
     * @returns True if model supports reasoning parameters.
     */
    public static isThinkingCapable(modelId: string): boolean {
        if (!modelId) return false;
        const lower = modelId.toLowerCase();

        // Muse Glimmer has baked-in reasoning which cannot be toggled at parameter level
        if (lower.includes('muse') || lower.includes('glimmer')) {
            return false;
        }

        const userProfiles = LMStudioReasoningEngine.getUserProfiles();
        if (userProfiles[modelId]) {
            return userProfiles[modelId].reasoningType !== 'none';
        }

        // Qwen, GLM, Gemma, Mistral, DeepSeek, and generic thinking models
        return (
            lower.includes('qwen') ||
            lower.includes('qwq') ||
            lower.includes('glm') ||
            lower.includes('gemma') ||
            lower.includes('mistral') ||
            lower.includes('codestral') ||
            lower.includes('magistral') ||
            lower.includes('ministral') ||
            lower.includes('deepseek') ||
            lower.includes('r1') ||
            lower.includes('thinking') ||
            lower.includes('reasoning')
        );
    }

    /**
     * Applies dynamic thinking/reasoning parameters to the target HTTP request payload.
     * @param requestParams Target HTTP payload object.
     * @param modelId Target model ID string.
     * @param thinking Whether thinking phase is enabled.
     * @param reasoningEffort Configured reasoning effort ('xhigh', 'medium', 'low', 'none').
     */
    public static applyThinkingParameters(
        requestParams: any,
        modelId: string,
        thinking: boolean,
        reasoningEffort: string = 'xhigh'
    ): void {
        const lower = (modelId || '').toLowerCase();
        const userProfiles = LMStudioReasoningEngine.getUserProfiles();

        // Map effort string (normalize 'high' to 'xhigh' or keep 'xhigh'/'medium'/'low')
        const effortVal = reasoningEffort === 'high' ? 'xhigh' : (reasoningEffort || 'xhigh');

        // 1. Check for user-defined configuration override
        const customProfile = userProfiles[modelId] || userProfiles[lower];
        if (customProfile) {
            if (thinking && customProfile.customParamsOn) {
                Object.assign(requestParams, customProfile.customParamsOn);
                return;
            } else if (!thinking && customProfile.customParamsOff) {
                Object.assign(requestParams, customProfile.customParamsOff);
                return;
            }
        }

        // 2. Muse Glimmer (baked-in reasoning; output is parsed via stream transformer)
        if (lower.includes('muse') || lower.includes('glimmer')) {
            if (thinking) {
                requestParams.thinking = true;
            } else {
                requestParams.thinking = false;
                requestParams.reasoning_effort = 'none';
                requestParams.reasoning = 'off';
            }
            return;
        }

        // 3. Qwen & GLM Architecture (e.g. Qwen 3.8 27B, Qwen 3.6, Qwen 3.5, Qwen 3 Coder, GLM 4.7 Flash, QwQ)
        if (lower.includes('qwen') || lower.includes('glm') || lower.includes('qwq')) {
            requestParams.reasoning_effort = effortVal;
            if (thinking) {
                requestParams.thinking = true;
                requestParams.enable_thinking = true;
                requestParams.chat_template_kwargs = { enable_thinking: true };
            } else {
                requestParams.thinking = false;
                requestParams.enable_thinking = false;
                requestParams.chat_template_kwargs = { enable_thinking: false };
            }
            return;
        }

        // 4. Mistral & Codestral Architecture (e.g. Magistral, Codestral, Mistral Small 3)
        if (lower.includes('mistral') || lower.includes('codestral') || lower.includes('magistral') || lower.includes('ministral')) {
            requestParams.reasoning_effort = effortVal;
            return;
        }

        // 5. Gemma Architecture (e.g. Gemma 4 E4B, Gemma 4 E2B, Gemma 4 31B, Gemma 4 26B, Gemma 2)
        if (lower.includes('gemma')) {
            requestParams.reasoning_effort = effortVal;
            if (thinking) {
                requestParams.thinking = true;
            } else {
                requestParams.thinking = false;
            }
            return;
        }

        // 6. DeepSeek-R1 and General Thinking Models (e.g. DeepSeek-R1 Distill)
        if (lower.includes('deepseek') || lower.includes('r1') || lower.includes('thinking') || lower.includes('reasoning')) {
            requestParams.reasoning_effort = effortVal;
            if (thinking) {
                requestParams.thinking = true;
                requestParams.enable_thinking = true;
                requestParams.chat_template_kwargs = { enable_thinking: true };
            } else {
                requestParams.thinking = false;
                requestParams.enable_thinking = false;
                requestParams.chat_template_kwargs = { enable_thinking: false };
            }
            return;
        }

        // 7. Generic Fallback for unspecified local models
        requestParams.reasoning_effort = effortVal;
        if (thinking) {
            requestParams.thinking = true;
            requestParams.enable_thinking = true;
            requestParams.chat_template_kwargs = { enable_thinking: true };
        } else {
            requestParams.thinking = false;
            requestParams.enable_thinking = false;
            requestParams.chat_template_kwargs = { enable_thinking: false };
        }
    }

    /**
     * Applies dynamic thinking/reasoning parameters purely based on the extracted ModelCapabilities manifest.
     * Uses the exact Jinja variable names defined in effects[].variable without hardcoding model names.
     * @param requestParams Target HTTP payload object.
     * @param capabilities Extracted ModelCapabilities for this model.
     * @param thinking Whether thinking is toggled on.
     * @param reasoningEffort Selected reasoning effort value (e.g. 'xhigh', 'medium', 'low').
     * @returns True if manifest parameters were applied.
     */
    public static applyManifestParameters(
        requestParams: any,
        capabilities?: ModelCapabilities,
        thinking: boolean = true,
        reasoningEffort: string = 'xhigh'
    ): boolean {
        if (!capabilities || !Array.isArray(capabilities.fields) || capabilities.fields.length === 0) {
            return false;
        }

        for (const field of capabilities.fields) {
            if (field.type === 'boolean') {
                requestParams[field.variable] = thinking;
                if (field.variable === 'enable_thinking') {
                    requestParams.chat_template_kwargs = {
                        ...(requestParams.chat_template_kwargs || {}),
                        enable_thinking: thinking
                    };
                }
            } else if (field.type === 'select') {
                requestParams[field.variable] = thinking ? (reasoningEffort || field.defaultValue || 'xhigh') : 'none';
            }
        }

        if (capabilities.isReasoning) {
            requestParams.thinking = thinking;
        }

        return true;
    }
}

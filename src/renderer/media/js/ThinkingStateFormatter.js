/**
 * ThinkingStateFormatter provides a clean OOP service for inspecting model reasoning states
 * and rendering thinking labels & battery SVG icons in the order requested (Text first, Icon second).
 * Dynamically utilizes LM Studio ModelCapabilities manifest definitions.
 */
class ThinkingStateFormatter {
    static lmStudioCapabilities = {};

    /**
     * Updates the active LM Studio model capabilities map.
     * @param {Record<string, object>} capabilities Map of model identifiers to ModelCapabilities.
     */
    static setLMStudioCapabilities(capabilities) {
        ThinkingStateFormatter.lmStudioCapabilities = capabilities || {};
    }

    /**
     * Inspects capabilities and localStorage to return a unified reasoning state object.
     * @param {string} modelId Active or raw model ID string.
     * @returns {object} Reasoning state metadata object.
     */
    static getThinkingState(modelId) {
        if (!modelId) {
            return { isThinkingCapable: false, isMultiLevel: false, level: 'off', isOn: false, labelText: '', rawModel: '' };
        }

        const lower = String(modelId).toLowerCase();
        const isThinkingSuffix = lower.endsWith(' (thinking)');
        const rawModel = isThinkingSuffix ? modelId.slice(0, -11) : modelId;
        const lowerRaw = rawModel.toLowerCase();

        // 1. Check dynamic LM Studio manifest capabilities first
        const cap = ThinkingStateFormatter.lmStudioCapabilities[rawModel] ||
                    ThinkingStateFormatter.lmStudioCapabilities[lowerRaw] ||
                    ThinkingStateFormatter.lmStudioCapabilities[modelId] ||
                    ThinkingStateFormatter.lmStudioCapabilities[lower];

        if (cap) {
            const fields = Array.isArray(cap.fields) ? cap.fields : [];
            if (fields.length > 0) {
                const hasSelectField = fields.some(f => f.type === 'select');
                const hasBooleanField = fields.some(f => f.type === 'boolean');
                const isLmThinkingOn = localStorage.getItem(`kai.lmStudioThinking.${rawModel}`) !== 'false';
                const storedEffort = localStorage.getItem(`kai.lmStudioReasoningLevel.${rawModel}`) ||
                                     localStorage.getItem(`kai.lmStudioReasoningLevel.${modelId}`) || 'xhigh';

                const effortLabels = { xhigh: 'X-High', high: 'X-High', medium: 'Medium', low: 'Low' };
                const effortKey = (storedEffort in effortLabels) ? storedEffort : 'xhigh';

                if (hasSelectField || hasBooleanField) {
                    return {
                        isThinkingCapable: true,
                        isMultiLevel: hasSelectField,
                        level: effortKey,
                        isOn: isLmThinkingOn,
                        labelText: isLmThinkingOn ? 'thinking' : '',
                        rawModel: rawModel
                    };
                }
            }
        }

        // 2. Gemini Multi-level models
        if (lowerRaw.includes('gemini')) {
            const level = localStorage.getItem(`kai.geminiThinkingLevel.${modelId}`) ||
                          localStorage.getItem(`kai.geminiThinkingLevel.${rawModel}`) ||
                          localStorage.getItem('kai.geminiThinkingLevel') || 'high';
            const levelLabels = { high: 'High', medium: 'Medium', low: 'Low', minimal: 'Off' };
            const labelText = levelLabels[level] || 'High';
            const isOn = level !== 'minimal' && level !== 'off';

            return {
                isThinkingCapable: true,
                isMultiLevel: true,
                level: level,
                isOn: isOn,
                labelText: labelText,
                rawModel: rawModel
            };
        }

        // 3. Qwen, GLM, Gemma, DeepSeek, and other reasoning local models (Fallback when no manifest)
        const isReasoningLocal = lowerRaw.includes('qwen') || lowerRaw.includes('qwq') || lowerRaw.includes('glm') ||
                                 lowerRaw.includes('gemma') || lowerRaw.includes('deepseek') || lowerRaw.includes('r1');
        if (isReasoningLocal) {
            const isLmThinkingOn = localStorage.getItem(`kai.lmStudioThinking.${rawModel}`) !== 'false';
            const storedEffort = localStorage.getItem(`kai.lmStudioReasoningLevel.${rawModel}`) ||
                                 localStorage.getItem(`kai.lmStudioReasoningLevel.${modelId}`) || 'xhigh';
            const effortLabels = { xhigh: 'X-High', high: 'X-High', medium: 'Medium', low: 'Low' };
            const effortKey = (storedEffort in effortLabels) ? storedEffort : 'xhigh';

            return {
                isThinkingCapable: true,
                isMultiLevel: true,
                level: effortKey,
                isOn: isLmThinkingOn,
                labelText: isLmThinkingOn ? 'thinking' : '',
                rawModel: rawModel
            };
        }

        // 4. Mistral Reasoning models (Binary On/Off)
        const isMistralReasoning = lowerRaw.includes('magistral') || lowerRaw.includes('mistral-small') || lowerRaw.includes('mistral-medium') || lowerRaw.includes('codestral');
        if (isMistralReasoning) {
            const stored = localStorage.getItem(`kai.mistralThinking.${rawModel}`);
            const isOn = stored !== 'false';
            return {
                isThinkingCapable: true,
                isMultiLevel: false,
                level: isOn ? 'high' : 'minimal',
                isOn: isOn,
                labelText: isOn ? 'Thinking' : '',
                rawModel: rawModel
            };
        }

        // 5. Muse Glimmer (Reasoning is baked-in and cannot be toggled off)
        const isMuseGlimmer = lowerRaw.includes('muse') || lowerRaw.includes('glimmer');
        if (isMuseGlimmer) {
            return {
                isThinkingCapable: false,
                isMultiLevel: false,
                level: 'high',
                isOn: true,
                labelText: '',
                rawModel: rawModel
            };
        }

        return { isThinkingCapable: false, isMultiLevel: false, level: 'minimal', isOn: false, labelText: '', rawModel: rawModel };
    }

    /**
     * Renders model display text, text suffix, and battery SVG icon into a target container.
     * Order specified by user: Base Model Name -> Text Suffix -> Battery SVG Icon.
     * @param {object} params Rendering parameters.
     * @param {string} params.modelId Active model ID.
     * @param {HTMLElement} params.container Target DOM container element.
     * @param {object} params.formatter Formatter instance for base model name formatting.
     * @param {string} [params.displayStyle] User display preference ('both', 'icon', 'text').
     */
    static renderTriggerLabel({ modelId, container, formatter, displayStyle = null }) {
        if (!container) return;
        const style = displayStyle || localStorage.getItem('kai.thinkingDisplayStyle') || 'both';
        const state = ThinkingStateFormatter.getThinkingState(modelId);
        const formattedBaseName = formatter ? formatter.formatModelName(state.rawModel) : state.rawModel;

        container.innerHTML = '';

        const baseSpan = document.createElement('span');
        baseSpan.textContent = formattedBaseName;
        container.appendChild(baseSpan);

        if (state.isThinkingCapable) {
            // 1. Text Suffix first
            if ((style === 'text' || style === 'both') && state.labelText) {
                const spaceText = document.createTextNode(` (${state.labelText})`);
                container.appendChild(spaceText);
            }

            // 2. Battery SVG Icon second
            if (style === 'icon' || style === 'both') {
                const spaceIcon = document.createTextNode(' ');
                container.appendChild(spaceIcon);
                const batterySvg = DOMUtils.createBatteryIcon(state.isMultiLevel ? state.level : state.isOn, 'thinking-battery-icon');
                container.appendChild(batterySvg);
            }
        }
    }

    /**
     * Appends text label and battery SVG icon to flyout option elements in user-specified order.
     * Order specified by user: Text label first -> Battery SVG icon second.
     * @param {HTMLElement} element Flyout option button or row element.
     * @param {string} labelText Option display text.
     * @param {string|boolean} level Reasoning level string or boolean.
     * @param {string} [displayStyle] User display preference ('both', 'icon', 'text').
     */
    static renderFlyoutOptionContent(element, labelText, level, displayStyle = null) {
        if (!element) return;
        const style = displayStyle || localStorage.getItem('kai.thinkingDisplayStyle') || 'both';

        // 1. Text label first
        if (style === 'text' || style === 'both') {
            const labelSpan = document.createElement('span');
            labelSpan.textContent = labelText;
            element.appendChild(labelSpan);
        }

        // 2. Battery SVG Icon second
        if (style === 'icon' || style === 'both') {
            const batterySvg = DOMUtils.createBatteryIcon(level, 'flyout-battery-icon');
            element.appendChild(batterySvg);
        }
    }
}

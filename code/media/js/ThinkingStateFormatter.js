/**
 * ThinkingStateFormatter provides a clean OOP service for inspecting model reasoning states
 * and rendering thinking labels & battery SVG icons in the order requested (Text first, Icon second).
 */
class ThinkingStateFormatter {
    /**
     * Inspects localStorage and model ID parameters to return a unified reasoning state object.
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

        // 1. Gemini Multi-level models
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

        // 2. Mistral Reasoning models (Binary On/Off)
        const isMistralReasoning = lowerRaw.includes('magistral') || lowerRaw.includes('mistral-small') || lowerRaw.includes('mistral-medium') || lowerRaw.includes('codestral');
        if (isMistralReasoning) {
            const stored = localStorage.getItem(`kai.mistralThinking.${rawModel}`);
            const isOn = stored !== 'false';
            return {
                isThinkingCapable: true,
                isMultiLevel: false,
                level: isOn ? 'high' : 'off',
                isOn: isOn,
                labelText: isOn ? 'thinking' : '',
                rawModel: rawModel
            };
        }

        // 3. Muse Glimmer (Reasoning is baked-in and cannot be toggled off)
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

        // 4. LM Studio / Local / General Reasoning models (Binary On/Off)
        const isLmThinkingOn = localStorage.getItem(`kai.lmStudioThinking.${rawModel}`) === 'true' || isThinkingSuffix;
        const isKnownLocalReasoning =
            lowerRaw.includes('qwen') ||
            lowerRaw.includes('qwq') ||
            lowerRaw.includes('glm') ||
            lowerRaw.includes('gemma') ||
            lowerRaw.includes('mistral') ||
            lowerRaw.includes('codestral') ||
            lowerRaw.includes('magistral') ||
            lowerRaw.includes('ministral') ||
            lowerRaw.includes('deepseek') ||
            lowerRaw.includes('r1') ||
            lowerRaw.includes('thinking') ||
            lowerRaw.includes('reasoning') ||
            lowerRaw.includes('lmstudio') ||
            lowerRaw.includes('local') ||
            isThinkingSuffix;

        if (isKnownLocalReasoning) {
            return {
                isThinkingCapable: true,
                isMultiLevel: false,
                level: isLmThinkingOn ? 'high' : 'off',
                isOn: isLmThinkingOn,
                labelText: isLmThinkingOn ? 'thinking' : '',
                rawModel: rawModel
            };
        }

        return { isThinkingCapable: false, isMultiLevel: false, level: 'off', isOn: false, labelText: '', rawModel: rawModel };
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

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
     * Inspects dynamic manifest and settings to return detailed capability state.
     * @param {string} modelId Active or raw model ID string.
     * @returns {object} Full capability state object.
     */
    static getCapabilitiesState(modelId) {
        if (!modelId) {
            return {
                rawModel: '',
                hasThinkingToggle: false,
                isThinkingOn: false,
                hasReasoningEffort: false,
                reasoningLevel: 'off',
                effortOptions: [],
                effortDisplayName: 'Reasoning Effort'
            };
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

        if (cap && Array.isArray(cap.fields) && cap.fields.length > 0) {
            const booleanField = cap.fields.find(f => f.type === 'boolean');
            const selectField = cap.fields.find(f => f.type === 'select');

            let hasThinkingToggle = !!booleanField;
            let isThinkingOn = true;
            if (hasThinkingToggle) {
                const stored = localStorage.getItem(`kai.lmStudioThinking.${rawModel}`) ??
                    localStorage.getItem(`kai.lmStudioThinking.${lowerRaw}`) ??
                    localStorage.getItem(`kai.lmStudioThinking.${modelId}`);
                isThinkingOn = stored !== 'false';
            }

            let hasReasoningEffort = !!selectField;
            let reasoningLevel = 'xhigh';
            let effortOptions = [];
            let effortDisplayName = 'Reasoning Effort';

            if (hasReasoningEffort) {
                effortDisplayName = selectField.displayName || 'Reasoning Effort';
                effortOptions = (selectField.options || []).map(o => ({
                    label: o.label || o.value,
                    value: o.value || o.label
                }));
                const defaultVal = selectField.defaultValue || (effortOptions[0]?.value) || 'xhigh';
                const storedEffort = localStorage.getItem(`kai.lmStudioReasoningLevel.${rawModel}`) ??
                    localStorage.getItem(`kai.lmStudioReasoningLevel.${lowerRaw}`) ??
                    localStorage.getItem(`kai.lmStudioReasoningLevel.${modelId}`);
                reasoningLevel = storedEffort || defaultVal;
            }

            return {
                rawModel: rawModel,
                hasThinkingToggle: hasThinkingToggle,
                isThinkingOn: isThinkingOn,
                hasReasoningEffort: hasReasoningEffort,
                reasoningLevel: reasoningLevel,
                effortOptions: effortOptions,
                effortDisplayName: effortDisplayName
            };
        }

        // 2. Google Gemini cloud models
        if (lowerRaw.includes('gemini')) {
            const level = localStorage.getItem(`kai.geminiThinkingLevel.${modelId}`) ||
                localStorage.getItem(`kai.geminiThinkingLevel.${rawModel}`) ||
                localStorage.getItem('kai.geminiThinkingLevel') || 'high';
            return {
                rawModel: rawModel,
                hasThinkingToggle: false,
                isThinkingOn: level !== 'off' && level !== 'minimal',
                hasReasoningEffort: true,
                reasoningLevel: level,
                effortOptions: [
                    { label: 'High', value: 'high' },
                    { label: 'Medium', value: 'medium' },
                    { label: 'Low', value: 'low' },
                    { label: 'Off', value: 'minimal' }
                ],
                effortDisplayName: 'Thinking Level'
            };
        }

        // 3. Mistral cloud reasoning models
        const isMistralReasoning = lowerRaw.includes('magistral') || lowerRaw.includes('codestral');
        if (isMistralReasoning) {
            const stored = localStorage.getItem(`kai.mistralThinking.${rawModel}`);
            const isOn = stored !== 'false';
            return {
                rawModel: rawModel,
                hasThinkingToggle: true,
                isThinkingOn: isOn,
                hasReasoningEffort: false,
                reasoningLevel: 'off',
                effortOptions: [],
                effortDisplayName: 'Reasoning Effort'
            };
        }

        // 4. Standard non-thinking models (no hardcoded fallback assumptions)
        return {
            rawModel: rawModel,
            hasThinkingToggle: false,
            isThinkingOn: false,
            hasReasoningEffort: false,
            reasoningLevel: 'off',
            effortOptions: [],
            effortDisplayName: 'Reasoning Effort'
        };
    }

    /**
     * Inspects capabilities and localStorage to return a unified reasoning state object.
     * @param {string} modelId Active or raw model ID string.
     * @returns {object} Reasoning state metadata object.
     */
    static getThinkingState(modelId) {
        const caps = ThinkingStateFormatter.getCapabilitiesState(modelId);
        const isCapable = caps.hasThinkingToggle || caps.hasReasoningEffort;

        let labelText = '';
        if (caps.hasReasoningEffort && caps.reasoningLevel !== 'off' && caps.reasoningLevel !== 'minimal') {
            labelText = caps.reasoningLevel;
        } else if (caps.hasThinkingToggle && caps.isThinkingOn) {
            labelText = 'thinking';
        }

        return {
            isThinkingCapable: isCapable,
            isMultiLevel: caps.hasReasoningEffort,
            level: caps.reasoningLevel,
            isOn: caps.isThinkingOn,
            labelText: labelText,
            dropdownText: labelText,
            hasReasoning: caps.hasReasoningEffort,
            reasoningLevel: caps.reasoningLevel,
            rawModel: caps.rawModel
        };
    }

    /**
     * Resolves info metadata for the Help/Info modal with separated Thinking and Reasoning rows.
     * @param {string} modelId Model ID string.
     * @returns {{ thinking: string|null, reasoning: string|null }} Info status object.
     */
    static getInfoState(modelId) {
        const state = ThinkingStateFormatter.getThinkingState(modelId);
        if (!state.isThinkingCapable) {
            return { thinking: null, reasoning: null };
        }

        return {
            thinking: state.isOn ? 'on' : 'off',
            reasoning: state.hasReasoning ? (state.isOn ? state.level : 'off') : null
        };
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

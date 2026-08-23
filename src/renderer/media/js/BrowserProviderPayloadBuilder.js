/**
 * BrowserProviderPayloadBuilder: Generates target endpoints, authentication headers, and request payloads
 * for all supported local and cloud AI providers in browser preview mode.
 */
class BrowserProviderPayloadBuilder {
    /**
     * Builds request parameters for a specific provider turn.
     * @param {object} params Configuration parameters.
     * @returns {{ targetUrl: string, fetchHeaders: object, payload: object, isGemini: boolean, isCloudProvider: boolean }}
     */
    static build(params) {
        const { model = '', messagesToSend = [], serverUrl = 'http://localhost:1234/v1', message = {} } = params;
        const modelLower = (model || '').toLowerCase();
        const fetchHeaders = { 'Content-Type': 'application/json' };

        const isGemini = modelLower.startsWith('gemini');
        const isMistral = modelLower.startsWith('mistral/');
        const isOpenRouter = modelLower.startsWith('openrouter/');
        const isZhipu = modelLower.startsWith('zhipu/');
        const isCohere = modelLower.startsWith('cohere/');
        const isCerebras = modelLower.startsWith('cerebras/');
        const isOmniRoute = modelLower.startsWith('omniroute/');
        const isCloudProvider = isGemini || isMistral || isOpenRouter || isZhipu || isCohere || isCerebras || isOmniRoute;

        let targetUrl = '';
        let payload = {};

        if (isGemini) {
            const apiKey = (localStorage.getItem('kai.geminiApiKey') || '').trim();
            if (!apiKey) throw new Error('Gemini API-sleutel ontbreekt. Voer je Gemini API key in via Instellingen.');
            targetUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
            const isThinkingOn = message.thinking === true;
            const geminiThinkingLevel = message.geminiThinkingLevel || 'high';

            let thinkingConfig = undefined;
            if (model.includes('gemini-2.5') || model.includes('gemini-3')) {
                thinkingConfig = {
                    thinkingLevel: isThinkingOn ? geminiThinkingLevel.toUpperCase() : 'LOW',
                    includeThoughts: isThinkingOn
                };
            } else if (model.includes('gemini-2')) {
                thinkingConfig = {
                    thinkingBudget: isThinkingOn ? 8192 : 0,
                    includeThoughts: isThinkingOn
                };
            }

            payload = {
                contents: messagesToSend.map(m => ({
                    role: m.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: m.content }]
                })),
                generationConfig: {
                    temperature: 0.2,
                    ...(thinkingConfig ? { thinkingConfig } : {})
                }
            };
        } else if (isMistral) {
            const mistralKey = (localStorage.getItem('kai.mistralApiKey') || '').trim();
            if (!mistralKey) throw new Error('Mistral API-sleutel ontbreekt. Voer je Mistral API key in via Instellingen.');
            targetUrl = 'https://api.mistral.ai/v1/chat/completions';
            fetchHeaders['Authorization'] = `Bearer ${mistralKey}`;
            payload = {
                model: model.replace(/^mistral\//i, ''),
                messages: messagesToSend.map(m => ({ role: m.role, content: m.content })),
                stream: true
            };
        } else if (isOpenRouter) {
            const openRouterKey = (localStorage.getItem('kai.openRouterApiKey') || '').trim();
            if (!openRouterKey) throw new Error('OpenRouter API-sleutel ontbreekt. Voer je OpenRouter API key in via Instellingen.');
            targetUrl = 'https://openrouter.ai/api/v1/chat/completions';
            fetchHeaders['Authorization'] = `Bearer ${openRouterKey}`;
            fetchHeaders['HTTP-Referer'] = 'https://github.com/KAI-Agent';
            fetchHeaders['X-Title'] = 'KAI Agent Desktop';

            payload = {
                model: model.replace(/^openrouter\//i, ''),
                messages: messagesToSend.map(m => ({ role: m.role, content: m.content })),
                stream: true
            };

            const isThinkingOn = message.thinking === true;
            if (isThinkingOn) {
                payload.reasoning = { effort: 'high', exclude: false };
            }
        } else if (isZhipu) {
            const zhipuKey = (localStorage.getItem('kai.zhipuApiKey') || '').trim();
            if (!zhipuKey) throw new Error('Zhipu AI API-sleutel ontbreekt. Voer je Zhipu API key in via Instellingen.');
            targetUrl = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
            fetchHeaders['Authorization'] = `Bearer ${zhipuKey}`;
            payload = {
                model: model.replace(/^zhipu\//i, ''),
                messages: messagesToSend.map(m => ({ role: m.role, content: m.content })),
                stream: true
            };
        } else if (isCohere) {
            const cohereKey = (localStorage.getItem('kai.cohereApiKey') || '').trim();
            if (!cohereKey) throw new Error('Cohere API-sleutel ontbreekt. Voer je Cohere API key in via Instellingen.');
            targetUrl = 'https://api.cohere.com/v1/chat';
            fetchHeaders['Authorization'] = `Bearer ${cohereKey}`;
            payload = {
                model: model.replace(/^cohere\//i, ''),
                message: messagesToSend[messagesToSend.length - 1]?.content || '',
                stream: true
            };
        } else if (isCerebras) {
            const cerebrasKey = (localStorage.getItem('kai.cerebrasApiKey') || '').trim();
            if (!cerebrasKey) throw new Error('Cerebras API-sleutel ontbreekt. Voer je Cerebras API key in via Instellingen.');
            targetUrl = 'https://api.cerebras.ai/v1/chat/completions';
            fetchHeaders['Authorization'] = `Bearer ${cerebrasKey}`;
            payload = {
                model: model.replace(/^cerebras\//i, ''),
                messages: messagesToSend.map(m => ({ role: m.role, content: m.content })),
                stream: true
            };
        } else if (isOmniRoute) {
            targetUrl = 'http://127.0.0.1:8000/v1/chat/completions';
            const omniKey = (localStorage.getItem('kai.omnirouteApiKey') || '').trim();
            if (omniKey) fetchHeaders['Authorization'] = `Bearer ${omniKey}`;
            payload = {
                model: model.replace(/^omniroute\//i, ''),
                messages: messagesToSend.map(m => ({ role: m.role, content: m.content })),
                stream: true
            };
        } else {
            // Local LM Studio
            targetUrl = serverUrl.replace(/\/$/, '') + '/chat/completions';
            const cleanModel = (model || '').endsWith(' (thinking)') ? model.slice(0, -11) : model;
            payload = {
                model: cleanModel,
                messages: messagesToSend.map(m => ({ role: m.role, content: m.content })),
                stream: true
            };

            const isThinkingOn = message.thinking === true;
            payload.thinking = isThinkingOn;
            payload.enable_thinking = isThinkingOn;
            payload.chat_template_kwargs = payload.chat_template_kwargs || {};
            payload.chat_template_kwargs.enable_thinking = isThinkingOn;

            const reasoningEffort = message.reasoningEffort || localStorage.getItem('kai.reasoningEffort') || (isThinkingOn ? 'xhigh' : 'none');
            let effortVal = reasoningEffort;
            if (effortVal === 'high' || effortVal === 'on') effortVal = 'xhigh';
            if (effortVal === 'off' || effortVal === 'minimal' || !isThinkingOn) effortVal = 'none';

            if (effortVal && effortVal !== 'none' && effortVal !== 'off') {
                payload.reasoning_effort = effortVal;
                payload.chat_template_kwargs.reasoning_effort = effortVal;
            }

            const caps = (window.KAI_LMSTUDIO_CAPABILITIES && window.KAI_LMSTUDIO_CAPABILITIES[cleanModel]) || null;
            if (caps && Array.isArray(caps.fields)) {
                for (const field of caps.fields) {
                    if (field.type === 'boolean') {
                        payload[field.variable] = isThinkingOn;
                        payload.chat_template_kwargs[field.variable] = isThinkingOn;
                    } else if (field.type === 'select') {
                        if (effortVal && effortVal !== 'none' && effortVal !== 'off') {
                            payload[field.variable] = effortVal;
                            payload.chat_template_kwargs[field.variable] = effortVal;
                        }
                    }
                }
            }
        }

        return {
            targetUrl,
            fetchHeaders,
            payload,
            isGemini,
            isCloudProvider
        };
    }
}

if (typeof window !== 'undefined') {
    window.BrowserProviderPayloadBuilder = BrowserProviderPayloadBuilder;
}

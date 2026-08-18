import type { FunctionDeclaration } from '../tools/Tool';

/** A provider-neutral chat message, optionally carrying native tool metadata. */
export interface ChatMessage {
    role: string;
    content: string;
    tool_calls?: NativeToolCall[];
    tool_call_id?: string;
    name?: string;
}

/** An OpenAI-compatible representation of a native function call. */
export interface NativeToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
    thoughtSignature?: string;
}

/** Result returned by a provider that executed a request with native tools. */
export interface NativeToolCallResult {
    type: 'text' | 'tool_call';
    text: string;
    toolCall?: {
        id: string;
        name: string;
        args: Record<string, any>;
        thoughtSignature?: string;
    };
}

/** Standard interface contract for all LLM Provider strategy implementations. */
export interface ILLMProvider {
    /**
     * Retrieves list of available model IDs for this provider.
     * @returns A promise resolving to an array of model ID strings.
     */
    getModels(): Promise<string[]>;

    /**
     * Executes a non-streaming chat completion request.
     * @param messages Array of chat message objects with role and content.
     * @param model Target model identifier string.
     * @param temperature Sampling temperature.
     * @param signal AbortSignal instance to cancel pending requests.
     * @param thinking Boolean flag to enable or disable model reasoning phase.
     * @param geminiThinkingLevel Thinking budget level for reasoning-capable Gemini models.
     * @returns A promise resolving to the completed text response.
     */
    chatCompletion(
        messages: { role: string; content: string }[],
        model: string,
        temperature?: number,
        signal?: any,
        thinking?: boolean,
        geminiThinkingLevel?: string
    ): Promise<string>;

    /**
     * Executes a streaming chat completion request.
     * @param messages Array of chat message objects with role and content.
     * @param model Target model identifier string.
     * @param temperature Sampling temperature.
     * @param onToken Token chunk callback function.
     * @param signal AbortSignal instance to cancel pending requests.
     * @param thinking Boolean flag to enable or disable model reasoning phase.
     * @param geminiThinkingLevel Thinking budget level for reasoning-capable Gemini models.
     * @returns A promise resolving to the final concatenated text response.
     */
    chatCompletionStream(
        messages: { role: string; content: string }[],
        model: string,
        temperature: number,
        onToken: (token: string) => void,
        signal?: any,
        thinking?: boolean,
        geminiThinkingLevel?: string
    ): Promise<string>;

    /** Indicates whether this provider can receive and return native function calls. */
    supportsNativeFunctionCalling?(): boolean;

    /**
     * Streams a response with native function schemas. Providers without this capability
     * continue to use chatCompletionStream and the legacy text parser.
     */
    chatCompletionStreamWithTools?(
        messages: ChatMessage[],
        model: string,
        temperature: number,
        tools: FunctionDeclaration[],
        onToken: (token: string) => void,
        signal?: any,
        thinking?: boolean,
        geminiThinkingLevel?: string
    ): Promise<NativeToolCallResult>;
}

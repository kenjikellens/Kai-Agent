/**
 * Standard interface contract for all LLM Provider strategy implementations.
 */
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
}

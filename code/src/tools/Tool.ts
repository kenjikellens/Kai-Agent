import * as path from 'path';

/**
 * Interface representing the context provided to each tool during execution.
 */
export interface ToolContext {
    /** The absolute path of the workspace. */
    workspacePath: string;
}

/**
 * Interface for OpenAI-compatible function declaration schema.
 */
export interface FunctionDeclaration {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: {
            type: string;
            properties: Record<string, any>;
            required?: string[];
        };
    };
}

/**
 * Abstract base class that all agent tools must extend.
 * Provides OOP structure, schema generation for function calling, and output truncation utilities.
 */
export abstract class Tool {
    /** The name of the tool, matching the tool type in system instructions. */
    abstract readonly name: string;

    /** Description of what the tool does. */
    abstract readonly description: string;

    /**
     * Generates the OpenAI-compatible function declaration schema for this tool.
     */
    abstract getFunctionDeclaration(): FunctionDeclaration;

    /**
     * Executes the tool's action.
     * @param args The arguments passed to the tool.
     * @param context The execution context of the tool.
     * @returns A promise that resolves to the string representation of the tool output.
     */
    abstract execute(args: any, context: ToolContext): Promise<string>;

    /**
     * Truncates large tool execution output to save context window tokens.
     * Keeps head and tail lines with a clear truncation marker.
     */
    protected truncateOutput(output: string, maxLines: number = 150, maxBytes: number = 8000): string {
        if (!output) {
            return output;
        }

        let result = output;
        if (Buffer.byteLength(result, 'utf8') > maxBytes) {
            result = result.slice(0, maxBytes);
        }

        const lines = result.split('\n');
        if (lines.length > maxLines) {
            const headCount = Math.floor(maxLines / 2);
            const tailCount = maxLines - headCount;
            const head = lines.slice(0, headCount).join('\n');
            const tail = lines.slice(-tailCount).join('\n');
            const omitted = lines.length - maxLines;
            return `${head}\n\n... [Output truncated: ${omitted} lines omitted to optimize context window] ...\n\n${tail}`;
        }

        return result;
    }
}

/**
 * Resolves a relative path to an absolute path inside the active workspace directory.
 * Throws an error if the path tries to traverse outside of the workspace directory.
 * @param relativePath The relative path supplied by the LLM.
 * @param workspacePath The absolute path to the workspace directory.
 * @returns The resolved absolute path.
 */
export function resolveSafePath(relativePath: string, workspacePath: string): string {
    const resolved = path.resolve(workspacePath, relativePath);
    if (!resolved.startsWith(workspacePath)) {
        throw new Error(`Path traversal violation: Access to path "${relativePath}" outside the workspace is denied.`);
    }
    return resolved;
}

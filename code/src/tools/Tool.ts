import * as path from 'path';

/**
 * Interface representing the context provided to each tool during execution.
 */
export interface ToolContext {
    /** The absolute path of the workspace. */
    workspacePath: string;
}

/**
 * Interface that all agent tools must implement.
 */
export interface Tool {
    /** The name of the tool, matching the tool type in system instructions. */
    name: string;

    /**
     * Executes the tool's action.
     * @param args The arguments passed to the tool.
     * @param context The execution context of the tool.
     * @returns A promise that resolves to the string representation of the tool output.
     */
    execute(args: any, context: ToolContext): Promise<string>;
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

import { Tool } from './Tool';
import { ReadFileTool } from './read_file';
import { WriteFileTool } from './write_file';
import { EditFileTool } from './edit_file';
import { ListDirTool } from './list_dir';
import { RunCommandTool } from './run_command';

export * from './Tool';
export * from './read_file';
export * from './write_file';
export * from './edit_file';
export * from './list_dir';
export * from './run_command';

/**
 * Returns a list of all instanced tools available for execution.
 * @returns An array of Tool instances.
 */
export function getRegisteredTools(): Tool[] {
    return [
        new ReadFileTool(),
        new WriteFileTool(),
        new EditFileTool(),
        new ListDirTool(),
        new RunCommandTool()
    ];
}

import { Tool } from './Tool';
import { ReadFileTool } from './read_file';
import { WriteFileTool } from './write_file';
import { EditFileTool } from './edit_file';
import { ListDirTool } from './list_dir';
import { RunCommandTool } from './run_command';
import { ReplaceFileContentTool } from './replace_file_content';
import { MultiReplaceFileContentTool } from './multi_replace_file_content';
import { GrepSearchTool } from './grep_search';
import { GetDiagnosticsTool } from './get_diagnostics';
import { SymbolSearchTool } from './symbol_search';
import { FetchUrlTool } from './fetch_url';

export * from './Tool';
export * from './read_file';
export * from './write_file';
export * from './edit_file';
export * from './list_dir';
export * from './run_command';
export * from './replace_file_content';
export * from './multi_replace_file_content';
export * from './grep_search';
export * from './get_diagnostics';
export * from './symbol_search';
export * from './fetch_url';

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
        new RunCommandTool(),
        new ReplaceFileContentTool(),
        new MultiReplaceFileContentTool(),
        new GrepSearchTool(),
        new GetDiagnosticsTool(),
        new SymbolSearchTool(),
        new FetchUrlTool()
    ];
}

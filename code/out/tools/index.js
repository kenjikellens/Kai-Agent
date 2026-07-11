"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRegisteredTools = void 0;
const read_file_1 = require("./read_file");
const write_file_1 = require("./write_file");
const list_dir_1 = require("./list_dir");
const run_command_1 = require("./run_command");
const replace_file_content_1 = require("./replace_file_content");
const multi_replace_file_content_1 = require("./multi_replace_file_content");
const grep_search_1 = require("./grep_search");
__exportStar(require("./Tool"), exports);
__exportStar(require("./read_file"), exports);
__exportStar(require("./write_file"), exports);
__exportStar(require("./list_dir"), exports);
__exportStar(require("./run_command"), exports);
__exportStar(require("./replace_file_content"), exports);
__exportStar(require("./multi_replace_file_content"), exports);
__exportStar(require("./grep_search"), exports);
/**
 * Returns a list of all instanced tools available for execution.
 * @returns An array of Tool instances.
 */
function getRegisteredTools() {
    return [
        new read_file_1.ReadFileTool(),
        new write_file_1.WriteFileTool(),
        new list_dir_1.ListDirTool(),
        new run_command_1.RunCommandTool(),
        new replace_file_content_1.ReplaceFileContentTool(),
        new multi_replace_file_content_1.MultiReplaceFileContentTool(),
        new grep_search_1.GrepSearchTool()
    ];
}
exports.getRegisteredTools = getRegisteredTools;
//# sourceMappingURL=index.js.map
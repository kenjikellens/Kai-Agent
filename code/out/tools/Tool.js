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
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveSafePath = void 0;
const path = __importStar(require("path"));
/**
 * Resolves a relative path to an absolute path inside the active workspace directory.
 * Throws an error if the path tries to traverse outside of the workspace directory.
 * @param relativePath The relative path supplied by the LLM.
 * @param workspacePath The absolute path to the workspace directory.
 * @returns The resolved absolute path.
 */
function resolveSafePath(relativePath, workspacePath) {
    const resolved = path.resolve(workspacePath, relativePath);
    if (!resolved.startsWith(workspacePath)) {
        throw new Error(`Path traversal violation: Access to path "${relativePath}" outside the workspace is denied.`);
    }
    return resolved;
}
exports.resolveSafePath = resolveSafePath;
//# sourceMappingURL=Tool.js.map
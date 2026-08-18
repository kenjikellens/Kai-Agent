import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload script exposing a secure `electronAPI` bridge to the Renderer Webview.
 */
contextBridge.exposeInMainWorld('electronAPI', {
    /**
     * Sends a message payload to the Main process.
     * @param message Payload object.
     */
    postMessage: (message: any) => {
        ipcRenderer.send('kai-message', message);
    },

    /**
     * Subscribes a callback to receive messages from the Main process.
     * @param callback Message handler function.
     */
    onMessage: (callback: (message: any) => void) => {
        ipcRenderer.on('kai-message', (_event, data) => {
            callback(data);
        });
    }
});

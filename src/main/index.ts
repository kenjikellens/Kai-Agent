import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { WorkspaceManager } from './WorkspaceManager';
import { AppHost } from './AppHost';

let mainWindow: BrowserWindow | null = null;
let appHost: AppHost | null = null;

/**
 * Creates and initializes the main desktop application window.
 */
function createWindow(): void {
    const workspaceManager = new WorkspaceManager(process.cwd());

    const iconPath = path.resolve(__dirname, '../../src/renderer/media/svg/kai_icon.png');

    mainWindow = new BrowserWindow({
        width: 1200,
        height: 850,
        minWidth: 800,
        minHeight: 600,
        title: 'KAI Agent',
        icon: iconPath,
        backgroundColor: '#1e1e1e',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false
        },
        autoHideMenuBar: true
    });

    appHost = new AppHost(mainWindow, workspaceManager);

    ipcMain.on('kai-message', async (_event, data) => {
        if (appHost) {
            await appHost.handleMessage(data);
        }
    });

    // Load renderer HTML file
    const rendererPath = path.join(__dirname, '../../src/renderer/index.html');
    mainWindow.loadFile(rendererPath);

    mainWindow.webContents.on('did-finish-load', () => {
        if (appHost) {
            appHost.handleCheckConnection();
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
        appHost = null;
    });
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

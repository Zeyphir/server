import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deleteMessage,
  markConversationRead,
  openLocalStore,
  reactToMessage,
  saveConversation,
  saveLocalUser,
  saveMessage,
  setSetting,
  getBootstrap,
  updateMessage,
  upsertProfile
} from './localStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function registerIpc() {
  ipcMain.handle('db:get-bootstrap', () => getBootstrap());
  ipcMain.handle('db:save-local-user', (_event, profile) => saveLocalUser(profile));
  ipcMain.handle('db:upsert-profile', (_event, profile) => upsertProfile(profile));
  ipcMain.handle('db:save-conversation', (_event, conversation) => saveConversation(conversation));
  ipcMain.handle('db:save-message', (_event, message) => saveMessage(message));
  ipcMain.handle('db:update-message', (_event, messageId, patch) => updateMessage(messageId, patch));
  ipcMain.handle('db:delete-message', (_event, messageId) => deleteMessage(messageId));
  ipcMain.handle('db:react-message', (_event, messageId, userId, emoji) => reactToMessage(messageId, userId, emoji));
  ipcMain.handle('db:mark-read', (_event, conversationId) => markConversationRead(conversationId));
  ipcMain.handle('db:set-setting', (_event, key, value) => setSetting(key, value));
}

async function createWindow() {
  await openLocalStore(app.getPath('userData'));
  registerIpc();

  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1040,
    minHeight: 680,
    title: 'Secure Messenger',
    backgroundColor: '#111318',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Si l'application est buildée (production)
  if (app.isPackaged || process.env.NODE_ENV === 'production') {
    // Charge le fichier HTML compilé par Vite
    await win.loadFile(path.join(__dirname, '../../dist/index.html'));
  } else {
    // Mode dev (Vite dev server)
    await win.loadURL('http://127.0.0.1:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
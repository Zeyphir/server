const { contextBridge, ipcRenderer } = require('electron');

const api = {
  getBootstrap: () => ipcRenderer.invoke('db:get-bootstrap'),
  saveLocalUser: (profile) => ipcRenderer.invoke('db:save-local-user', profile),
  upsertProfile: (profile) => ipcRenderer.invoke('db:upsert-profile', profile),
  saveConversation: (conversation) => ipcRenderer.invoke('db:save-conversation', conversation),
  saveMessage: (message) => ipcRenderer.invoke('db:save-message', message),
  updateMessage: (messageId, patch) => ipcRenderer.invoke('db:update-message', messageId, patch),
  deleteMessage: (messageId) => ipcRenderer.invoke('db:delete-message', messageId),
  reactToMessage: (messageId, userId, emoji) => ipcRenderer.invoke('db:react-message', messageId, userId, emoji),
  markConversationRead: (conversationId) => ipcRenderer.invoke('db:mark-read', conversationId),
  setSetting: (key, value) => ipcRenderer.invoke('db:set-setting', key, value)
};

contextBridge.exposeInMainWorld('secureLocal', api);
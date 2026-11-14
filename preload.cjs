const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  getToken: () => ipcRenderer.invoke('auth:get-token'),
  setToken: (token) => ipcRenderer.invoke('auth:set-token', token),
  clearToken: () => ipcRenderer.invoke('auth:clear-token'),
  version: () => ipcRenderer.invoke('app:version'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  openFile: () => ipcRenderer.invoke('dialog:open-file'),
  request: (options) => ipcRenderer.invoke('api:request', options),
  stream: (options) => ipcRenderer.invoke('api:stream', options)
});

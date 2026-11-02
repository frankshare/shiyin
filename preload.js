'use strict';
// 渲染层安全桥
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('melody', {
  search: (p) => ipcRenderer.invoke('music:search', p),
  resolve: (track) => ipcRenderer.invoke('music:resolve', track),
  lyric: (track) => ipcRenderer.invoke('music:lyric', track),
  storeGet: () => ipcRenderer.invoke('store:get'),
  storeSet: (key, value) => ipcRenderer.invoke('store:set', { key, value }),
  win: (action) => ipcRenderer.invoke('win:' + action),
  onMaximized: (cb) => ipcRenderer.on('win:maximized', (e, v) => cb(v)),
  // 下载队列
  downloadEnqueue: (payload) => ipcRenderer.invoke('download:enqueue', payload),
  downloadList: () => ipcRenderer.invoke('download:list'),
  downloadCancel: (id) => ipcRenderer.invoke('download:cancel', id),
  downloadRetry: (id) => ipcRenderer.invoke('download:retry', id),
  downloadClearFinished: () => ipcRenderer.invoke('download:clearFinished'),
  downloadInfo: () => ipcRenderer.invoke('download:info'),
  downloadChooseDir: () => ipcRenderer.invoke('download:chooseDir'),
  downloadOpenDir: () => ipcRenderer.invoke('download:openDir'),
  downloadShowItem: (p) => ipcRenderer.invoke('download:showItem', p),
  onDownloadState: (cb) => ipcRenderer.on('download:state', (e, items) => cb(items)),
});

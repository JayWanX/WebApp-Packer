'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('packer', {
  pickDirectory: (defaultPath) => ipcRenderer.invoke('dialog:pickDirectory', defaultPath),
  pickFile: (opts) => ipcRenderer.invoke('dialog:pickFile', opts),
  pickIcon: () => ipcRenderer.invoke('dialog:pickIcon'),
  pickOutput: () => ipcRenderer.invoke('dialog:pickOutput'),

  getEnvInfo: () => ipcRenderer.invoke('env:info'),

  runPack: (inputs) => ipcRenderer.invoke('pack:run', inputs),
  exportSource: (inputs) => ipcRenderer.invoke('export:source', inputs),

  openFolder: (folder) => ipcRenderer.invoke('shell:openFolder', folder),
  openItem: (item) => ipcRenderer.invoke('shell:openItem', item),

  // 拖入文件时，Electron 32+ 已移除 File.path，需要用 webUtils.getPathForFile()
  getDroppedPath: (file) => {
    try { return webUtils.getPathForFile(file); } catch (err) { return null; }
  },

  onLog: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('pack:log', handler);
    return () => ipcRenderer.removeListener('pack:log', handler);
  },
  onProgress: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('pack:progress', handler);
    return () => ipcRenderer.removeListener('pack:progress', handler);
  }
});

'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'app-config.json'), 'utf8'));
  } catch (err) {
    return {};
  }
}

const cfg = readConfig();
const fileApiEnabled = cfg.fileApi !== false;

const api = {
  isDesktop: true,
  runtime: 'webapp-packer',

  getInfo: () => ipcRenderer.invoke('desktop:info'),

  window: {
    minimize: () => ipcRenderer.invoke('desktop:window', 'minimize'),
    toggleMaximize: () => ipcRenderer.invoke('desktop:window', 'maximize'),
    close: () => ipcRenderer.invoke('desktop:window', 'close'),
    hide: () => ipcRenderer.invoke('desktop:window', 'hide'),
    toggleFullscreen: () => ipcRenderer.invoke('desktop:window', 'fullscreen'),
    toggleDevTools: () => ipcRenderer.invoke('desktop:window', 'devtools')
  },

  shell: {
    openExternal: (url) => ipcRenderer.invoke('desktop:shell', 'openExternal', url),
    showItemInFolder: (p) => ipcRenderer.invoke('desktop:shell', 'showItemInFolder', p),
    openPath: (p) => ipcRenderer.invoke('desktop:shell', 'openPath', p)
  },

  store: {
    get: (key) => ipcRenderer.invoke('desktop:store', 'get', key),
    set: (key, value) => ipcRenderer.invoke('desktop:store', 'set', key, value),
    delete: (key) => ipcRenderer.invoke('desktop:store', 'delete', key),
    all: () => ipcRenderer.invoke('desktop:store', 'all'),
    clear: () => ipcRenderer.invoke('desktop:store', 'clear')
  }
};

if (fileApiEnabled) {
  api.dialog = {
    openFile: (options) => ipcRenderer.invoke('desktop:dialog', 'open', options),
    saveFile: (options) => ipcRenderer.invoke('desktop:dialog', 'save', options),
    selectDirectory: (options) => ipcRenderer.invoke('desktop:dialog', 'directory', options),
    message: (options) => ipcRenderer.invoke('desktop:dialog', 'message', options)
  };

  api.fs = {
    readText: (p, encoding) => ipcRenderer.invoke('desktop:fs', 'read', p, null, { encoding: encoding || 'utf8' }),
    readBytes: (p) => ipcRenderer.invoke('desktop:fs', 'readBytes', p),
    writeText: (p, content) => ipcRenderer.invoke('desktop:fs', 'write', p, String(content)),
    writeBytes: (p, bytes) => ipcRenderer.invoke('desktop:fs', 'write', p, bytes),
    append: (p, content) => ipcRenderer.invoke('desktop:fs', 'append', p, String(content)),
    exists: (p) => ipcRenderer.invoke('desktop:fs', 'exists', p),
    stat: (p) => ipcRenderer.invoke('desktop:fs', 'stat', p),
    list: (p) => ipcRenderer.invoke('desktop:fs', 'list', p),
    mkdir: (p) => ipcRenderer.invoke('desktop:fs', 'mkdir', p),
    remove: (p, recursive) => ipcRenderer.invoke('desktop:fs', 'remove', p, null, { recursive: !!recursive }),
    join: (...parts) => ipcRenderer.invoke('desktop:fs', 'join', null, parts),
    getPath: (name) => ipcRenderer.invoke('desktop:fs', 'appPath', name)
  };

  // 便捷方法：弹出保存对话框并直接写入
  api.saveAs = async (defaultName, content, filters) => {
    const target = await api.dialog.saveFile({
      defaultPath: defaultName,
      filters: filters || [{ name: '所有文件', extensions: ['*'] }]
    });
    if (!target) return null;
    if (content instanceof Uint8Array) {
      await api.fs.writeBytes(target, content);
    } else {
      await api.fs.writeText(target, content);
    }
    return target;
  };

  // 便捷方法：弹出打开对话框并直接读取文本
  api.openAs = async (filters) => {
    const target = await api.dialog.openFile({
      filters: filters || [{ name: '所有文件', extensions: ['*'] }]
    });
    if (!target) return null;
    return { path: target, content: await api.fs.readText(target) };
  };
}

contextBridge.exposeInMainWorld('desktopAPI', api);
contextBridge.exposeInMainWorld('__IS_DESKTOP_APP__', true);

'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { scaffold } = require('./core/scaffold.js');
const { build: runBuild } = require('./core/builder.js');
const { generateWorkflow } = require('./core/workflow.js');
const { resolveSource } = require('./core/source.js');

let mainWindow = null;

const DEFAULT_OUTPUT_BASE = path.join(os.homedir(), 'webapp-packer-output');

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 880,
    minHeight: 620,
    title: 'WebApp Packer',
    backgroundColor: '#0f1115',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (process.env.WEBAPP_PACKER_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools({ mode: 'right' });
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 阻止导航到外部 URL
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  return mainWindow;
}

/* ---------------- IPC ---------------- */

function makeWorkDir(inputs) {
  const base = inputs.outputBase || DEFAULT_OUTPUT_BASE;
  const safe = (inputs.productName || 'webapp')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'webapp';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace(/T/, '_').slice(0, 19);
  return path.join(base, `${safe}_${stamp}`);
}

ipcMain.handle('dialog:pickDirectory', async (_e, defaultPath) => {
  const win = BrowserWindow.fromWebContents(_e.sender) || mainWindow;
  const res = await dialog.showOpenDialog(win, {
    title: '选择网页目录',
    defaultPath: defaultPath || os.homedir(),
    properties: ['openDirectory']
  });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('dialog:pickFile', async (_e, opts) => {
  const win = BrowserWindow.fromWebContents(_e.sender) || mainWindow;
  const res = await dialog.showOpenDialog(win, {
    title: (opts && opts.title) || '选择文件',
    defaultPath: (opts && opts.defaultPath) || os.homedir(),
    filters: (opts && opts.filters) || [
      { name: '网页文件', extensions: ['html', 'htm'] },
      { name: '所有文件', extensions: ['*'] }
    ],
    properties: ['openFile']
  });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('dialog:pickIcon', async () => {
  const win = BrowserWindow.fromWebContents(_e.sender) || mainWindow;
  const res = await dialog.showOpenDialog(win, {
    title: '选择图标（PNG 512x512 或 ICO）',
    filters: [
      { name: '图标', extensions: ['png', 'ico'] },
      { name: 'PNG', extensions: ['png'] },
      { name: 'ICO', extensions: ['ico'] }
    ],
    properties: ['openFile']
  });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('dialog:pickOutput', async () => {
  const win = BrowserWindow.fromWebContents(_e.sender) || mainWindow;
  const res = await dialog.showOpenDialog(win, {
    title: '选择输出目录',
    defaultPath: DEFAULT_OUTPUT_BASE,
    properties: ['openDirectory', 'createDirectory']
  });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('env:info', () => ({
  platform: process.platform,
  arch: process.arch,
  node: process.versions.node,
  electron: process.versions.electron,
  defaultOutputBase: DEFAULT_OUTPUT_BASE,
  home: os.homedir()
}));

ipcMain.handle('pack:run', async (event, inputs) => {
  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  const workDir = makeWorkDir(inputs);
  const log = (msg) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('pack:log', { type: 'log', message: String(msg) });
    }
  };
  const progress = (data) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('pack:progress', data);
    }
  };

  let cleanup = () => {};
  try {
    log('=== 开始打包 ===');

    const resolved = resolveSource(inputs, log);
    inputs.sourceDir = resolved.sourceDir;
    cleanup = resolved.cleanup || (() => {});
    log('源目录: ' + inputs.sourceDir);

    const scaffoldResult = scaffold(workDir, inputs, log);
    log(`脚手架完成: ${scaffoldResult.fileCount} 个网页文件`);

    const buildResult = await runBuild(workDir, {
      platforms: inputs.platforms
    }, log, progress);

    log('=== 打包完成 ===');
    return {
      success: true,
      workDir,
      outputs: buildResult.outputs || [],
      outDir: buildResult.outDir,
      fileCount: scaffoldResult.fileCount
    };
  } catch (err) {
    log('错误: ' + (err && err.message ? err.message : String(err)));
    return { success: false, error: err && err.message ? err.message : String(err), workDir };
  } finally {
    cleanup();
  }
});

ipcMain.handle('export:source', async (_e, inputs) => {
  const win = BrowserWindow.fromWebContents(_e.sender) || mainWindow;
  const workDir = makeWorkDir({ ...inputs, exportOnly: true });
  const log = (msg) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('pack:log', { type: 'log', message: String(msg) });
    }
  };

  let cleanup = () => {};
  try {
    log('=== 导出可移植源项目 ===');

    const resolved = resolveSource(inputs, log);
    inputs.sourceDir = resolved.sourceDir;
    cleanup = resolved.cleanup || (() => {});
    log('源目录: ' + inputs.sourceDir);

    const scaffoldResult = scaffold(workDir, inputs, log);
    const wf = generateWorkflow(workDir, inputs.productName || 'WebApp');
    log('GitHub Actions workflow: ' + wf.workflowPath);
    return { success: true, workDir };
  } catch (err) {
    log('错误: ' + (err && err.message ? err.message : String(err)));
    return { success: false, error: err && err.message ? err.message : String(err), workDir };
  } finally {
    cleanup();
  }
});

ipcMain.handle('shell:openFolder', async (_e, folder) => {
  if (!folder) return false;
  if (!fs.existsSync(folder)) {
    await shell.openPath(path.dirname(folder));
  } else {
    shell.openPath(folder);
  }
  return true;
});

ipcMain.handle('shell:openItem', async (_e, item) => {
  if (!item || !fs.existsSync(item)) return false;
  shell.showItemInFolder(item);
  return true;
});

/* ---------------- 生命周期 ---------------- */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', createMainWindow);

  app.whenReady().then(() => {
    createMainWindow();
    app.on('activate', createMainWindow);
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

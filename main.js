'use strict';

const {
  app, BrowserWindow, Menu, Tray, dialog, shell,
  ipcMain, protocol, nativeImage, screen
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { Readable } = require('node:stream');

const APP_ROOT = __dirname;
const WWW_DIR = path.join(APP_ROOT, 'www');
const SCHEME = 'app';
const BASE_URL = `${SCHEME}://local/`;

const DEFAULTS = {
  productName: 'WebApp',
  entry: 'index.html',
  width: 1200,
  height: 800,
  minWidth: 400,
  minHeight: 300,
  resizable: true,
  fullscreen: false,
  maximized: false,
  frameless: false,
  showMenuBar: false,
  rememberWindowState: true,
  backgroundColor: '#ffffff',
  singleInstance: true,
  tray: false,
  minimizeToTray: false,
  fileApi: true,
  externalLinksInBrowser: true,
  devTools: false,
  spaFallback: false,
  zoomEnabled: true
};

function loadConfig() {
  try {
    const raw = fs.readFileSync(path.join(APP_ROOT, 'app-config.json'), 'utf8');
    return Object.assign({}, DEFAULTS, JSON.parse(raw));
  } catch (err) {
    return Object.assign({}, DEFAULTS);
  }
}

const cfg = loadConfig();

let mainWindow = null;
let tray = null;
let isQuitting = false;

/* ---------------- 窗口状态持久化 ---------------- */

function statePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function readWindowState() {
  if (!cfg.rememberWindowState) return null;
  try {
    const s = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    if (!Number.isFinite(s.width) || !Number.isFinite(s.height)) return null;
    return s;
  } catch (err) {
    return null;
  }
}

function isVisibleOnSomeDisplay(bounds) {
  if (!Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) return false;
  return screen.getAllDisplays().some((display) => {
    const wa = display.workArea;
    return bounds.x < wa.x + wa.width
      && bounds.x + bounds.width > wa.x
      && bounds.y < wa.y + wa.height
      && bounds.y + bounds.height > wa.y;
  });
}

function saveWindowState() {
  if (!cfg.rememberWindowState || !mainWindow || mainWindow.isDestroyed()) return;
  try {
    const normal = mainWindow.getNormalBounds
      ? mainWindow.getNormalBounds()
      : mainWindow.getBounds();
    const state = {
      x: normal.x,
      y: normal.y,
      width: normal.width,
      height: normal.height,
      maximized: mainWindow.isMaximized(),
      fullscreen: mainWindow.isFullScreen()
    };
    fs.mkdirSync(path.dirname(statePath()), { recursive: true });
    fs.writeFileSync(statePath(), JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    // 状态保存失败不应影响退出流程
  }
}

/* ---------------- 简易键值存储 ---------------- */

function storePath() {
  return path.join(app.getPath('userData'), 'store.json');
}

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(storePath(), 'utf8'));
  } catch (err) {
    return {};
  }
}

function writeStore(data) {
  fs.mkdirSync(path.dirname(storePath()), { recursive: true });
  fs.writeFileSync(storePath(), JSON.stringify(data, null, 2), 'utf8');
}

/* ---------------- app:// 协议 ---------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
  '.wasm': 'application/wasm',
  '.zip': 'application/zip'
};

function mimeOf(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function resolveWithinWww(urlPath) {
  const clean = decodeURIComponent(urlPath).split('?')[0].split('#')[0];
  const target = path.resolve(path.join(WWW_DIR, clean));
  const root = path.resolve(WWW_DIR);
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}

function statSafe(p) {
  try {
    return fs.statSync(p);
  } catch (err) {
    return null;
  }
}

function pickFile(requestPath) {
  let target = resolveWithinWww(requestPath);
  if (!target) return null;

  let st = statSafe(target);
  if (st && st.isDirectory()) {
    target = path.join(target, 'index.html');
    st = statSafe(target);
  }
  if (st && st.isFile()) return target;

  if (cfg.spaFallback) {
    const fallback = path.join(WWW_DIR, cfg.entry);
    if (statSafe(fallback)) return fallback;
  }
  return null;
}

function buildResponse(filePath, rangeHeader) {
  const st = fs.statSync(filePath);
  const type = mimeOf(filePath);

  if (rangeHeader) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (m) {
      const size = st.size;
      let start = m[1] === '' ? null : parseInt(m[1], 10);
      let end = m[2] === '' ? null : parseInt(m[2], 10);

      if (start === null && end !== null) {
        start = Math.max(0, size - end);
        end = size - 1;
      } else {
        if (start === null) start = 0;
        if (end === null || end >= size) end = size - 1;
      }

      if (start <= end && start < size) {
        const stream = fs.createReadStream(filePath, { start, end });
        return new Response(Readable.toWeb(stream), {
          status: 206,
          headers: {
            'content-type': type,
            'content-length': String(end - start + 1),
            'content-range': `bytes ${start}-${end}/${size}`,
            'accept-ranges': 'bytes'
          }
        });
      }
    }
  }

  const stream = fs.createReadStream(filePath);
  return new Response(Readable.toWeb(stream), {
    status: 200,
    headers: {
      'content-type': type,
      'content-length': String(st.size),
      'accept-ranges': 'bytes'
    }
  });
}

protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true
  }
}]);

function registerProtocol() {
  protocol.handle(SCHEME, (request) => {
    let urlPath = '/';
    try {
      urlPath = new URL(request.url).pathname;
    } catch (err) {
      return new Response('Bad Request', { status: 400 });
    }

    const filePath = pickFile(urlPath);
    if (!filePath) {
      return new Response('Not Found: ' + urlPath, {
        status: 404,
        headers: { 'content-type': 'text/plain; charset=utf-8' }
      });
    }

    try {
      return buildResponse(filePath, request.headers.get('range'));
    } catch (err) {
      return new Response('Read Error: ' + String(err && err.message), { status: 500 });
    }
  });
}

/* ---------------- 图标 ---------------- */

function appIcon() {
  for (const name of ['icon.png', 'icon.ico']) {
    const p = path.join(APP_ROOT, 'assets', name);
    if (statSafe(p)) {
      const img = nativeImage.createFromPath(p);
      if (!img.isEmpty()) return img;
    }
  }
  return null;
}

/* ---------------- 菜单 ---------------- */

function applyMenu() {
  if (cfg.showMenuBar) return;

  if (process.platform === 'darwin') {
    // macOS 移除菜单会导致复制/粘贴等快捷键失效，保留最小可用菜单
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      {
        label: '窗口',
        submenu: [
          { role: 'minimize' },
          { role: 'zoom' },
          { role: 'close' }
        ]
      }
    ]));
  } else {
    Menu.setApplicationMenu(null);
  }
}

/* ---------------- 主窗口 ---------------- */

function createWindow() {
  const saved = readWindowState();
  const useSaved = saved && isVisibleOnSomeDisplay({
    x: saved.x, y: saved.y, width: saved.width, height: saved.height
  });

  const options = {
    width: useSaved ? saved.width : cfg.width,
    height: useSaved ? saved.height : cfg.height,
    minWidth: cfg.minWidth,
    minHeight: cfg.minHeight,
    resizable: cfg.resizable,
    frame: !cfg.frameless,
    backgroundColor: cfg.backgroundColor,
    show: false,
    autoHideMenuBar: !cfg.showMenuBar,
    title: cfg.productName,
    webPreferences: {
      preload: path.join(APP_ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: !!cfg.devTools,
      spellcheck: false
    }
  };

  if (useSaved) {
    options.x = saved.x;
    options.y = saved.y;
  }

  const icon = appIcon();
  if (icon) options.icon = icon;

  mainWindow = new BrowserWindow(options);

  if (useSaved && saved.maximized) mainWindow.maximize();
  if (cfg.maximized && !useSaved) mainWindow.maximize();
  if (cfg.fullscreen || (useSaved && saved.fullscreen)) mainWindow.setFullScreen(true);

  applyMenu();

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (cfg.devTools && process.env.WEBAPP_OPEN_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools({ mode: 'right' });
    }
  });

  if (!cfg.zoomEnabled) {
    mainWindow.webContents.on('did-finish-load', () => {
      mainWindow.webContents.setVisualZoomLevelLimits(1, 1);
    });
  }

  // 外部链接处理
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`${SCHEME}://`)) return { action: 'allow' };
    if (cfg.externalLinksInBrowser && /^https?:/i.test(url)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(`${SCHEME}://`)) return;
    event.preventDefault();
    if (cfg.externalLinksInBrowser && /^https?:/i.test(url)) shell.openExternal(url);
  });

  // 快捷键
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = (input.key || '').toLowerCase();

    if (cfg.devTools && (key === 'f12' || (input.control && input.shift && key === 'i'))) {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
      return;
    }
    if (key === 'f5' || (input.control && key === 'r')) {
      mainWindow.webContents.reload();
      event.preventDefault();
      return;
    }
    if (key === 'f11' && cfg.resizable) {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
      event.preventDefault();
    }
  });

  let saveTimer = null;
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveWindowState, 400);
  };
  mainWindow.on('resize', scheduleSave);
  mainWindow.on('move', scheduleSave);

  mainWindow.on('close', (event) => {
    if (cfg.tray && cfg.minimizeToTray && !isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      return;
    }
    saveWindowState();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadURL(BASE_URL + cfg.entry);
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

/* ---------------- 托盘 ---------------- */

function createTray() {
  if (!cfg.tray) return;

  const icon = appIcon();
  tray = new Tray(icon || nativeImage.createEmpty());
  tray.setToolTip(cfg.productName);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主窗口', click: showWindow },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        saveWindowState();
        app.quit();
      }
    }
  ]));
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
}

/* ---------------- IPC ---------------- */

function registerIpc() {
  ipcMain.handle('desktop:info', () => ({
    productName: cfg.productName,
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    locale: app.getLocale(),
    userDataPath: app.getPath('userData'),
    fileApiEnabled: !!cfg.fileApi
  }));

  ipcMain.handle('desktop:window', (event, action) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return false;
    switch (action) {
      case 'minimize': win.minimize(); return true;
      case 'maximize': win.isMaximized() ? win.unmaximize() : win.maximize(); return true;
      case 'close': win.close(); return true;
      case 'fullscreen': win.setFullScreen(!win.isFullScreen()); return true;
      case 'hide': win.hide(); return true;
      case 'devtools': if (cfg.devTools) win.webContents.toggleDevTools(); return true;
      default: return false;
    }
  });

  ipcMain.handle('desktop:shell', async (event, action, target) => {
    if (action === 'openExternal') {
      if (!/^https?:/i.test(String(target))) throw new Error('仅允许打开 http/https 链接');
      await shell.openExternal(target);
      return true;
    }
    if (action === 'showItemInFolder') {
      shell.showItemInFolder(String(target));
      return true;
    }
    if (action === 'openPath') {
      return shell.openPath(String(target));
    }
    throw new Error('未知 shell 操作: ' + action);
  });

  ipcMain.handle('desktop:store', (event, action, key, value) => {
    const data = readStore();
    if (action === 'get') return key in data ? data[key] : null;
    if (action === 'all') return data;
    if (action === 'set') {
      data[key] = value;
      writeStore(data);
      return true;
    }
    if (action === 'delete') {
      delete data[key];
      writeStore(data);
      return true;
    }
    if (action === 'clear') {
      writeStore({});
      return true;
    }
    throw new Error('未知 store 操作: ' + action);
  });

  if (!cfg.fileApi) return;

  ipcMain.handle('desktop:dialog', async (event, action, options) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const opts = options || {};

    if (action === 'open') {
      const res = await dialog.showOpenDialog(win, {
        title: opts.title,
        defaultPath: opts.defaultPath,
        filters: opts.filters,
        properties: undefined,
        buttonLabel: opts.buttonLabel,
        ...(opts.multiple
          ? { properties: ['openFile', 'multiSelections'] }
          : { properties: ['openFile'] })
      });
      return res.canceled ? null : (opts.multiple ? res.filePaths : res.filePaths[0]);
    }

    if (action === 'save') {
      const res = await dialog.showSaveDialog(win, {
        title: opts.title,
        defaultPath: opts.defaultPath,
        filters: opts.filters,
        buttonLabel: opts.buttonLabel
      });
      return res.canceled ? null : res.filePath;
    }

    if (action === 'directory') {
      const res = await dialog.showOpenDialog(win, {
        title: opts.title,
        defaultPath: opts.defaultPath,
        properties: ['openDirectory', 'createDirectory']
      });
      return res.canceled ? null : res.filePaths[0];
    }

    if (action === 'message') {
      const res = await dialog.showMessageBox(win, {
        type: opts.type || 'info',
        title: opts.title || cfg.productName,
        message: String(opts.message || ''),
        detail: opts.detail,
        buttons: opts.buttons || ['确定']
      });
      return res.response;
    }

    throw new Error('未知 dialog 操作: ' + action);
  });

  ipcMain.handle('desktop:fs', async (event, action, target, payload, options) => {
    const p = String(target || '');
    const opts = options || {};

    switch (action) {
      case 'read':
        return fs.promises.readFile(p, opts.encoding === null ? undefined : (opts.encoding || 'utf8'));
      case 'readBytes': {
        const buf = await fs.promises.readFile(p);
        return new Uint8Array(buf);
      }
      case 'write': {
        await fs.promises.mkdir(path.dirname(p), { recursive: true });
        const data = payload instanceof Uint8Array ? Buffer.from(payload) : String(payload);
        await fs.promises.writeFile(p, data);
        return true;
      }
      case 'append':
        await fs.promises.mkdir(path.dirname(p), { recursive: true });
        await fs.promises.appendFile(p, String(payload));
        return true;
      case 'exists':
        return !!statSafe(p);
      case 'stat': {
        const st = statSafe(p);
        if (!st) return null;
        return {
          size: st.size,
          isFile: st.isFile(),
          isDirectory: st.isDirectory(),
          mtimeMs: st.mtimeMs
        };
      }
      case 'list': {
        const items = await fs.promises.readdir(p, { withFileTypes: true });
        return items.map((it) => ({
          name: it.name,
          path: path.join(p, it.name),
          isDirectory: it.isDirectory()
        }));
      }
      case 'mkdir':
        await fs.promises.mkdir(p, { recursive: true });
        return true;
      case 'remove':
        await fs.promises.rm(p, { recursive: !!opts.recursive, force: true });
        return true;
      case 'join':
        return path.join(...[].concat(payload));
      case 'appPath':
        return app.getPath(p || 'userData');
      default:
        throw new Error('未知 fs 操作: ' + action);
    }
  });
}

/* ---------------- 生命周期 ---------------- */

function bootstrap() {
  registerProtocol();
  registerIpc();
  createTray();
  createWindow();
}

if (cfg.singleInstance && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  if (cfg.singleInstance) {
    app.on('second-instance', showWindow);
  }

  app.whenReady().then(bootstrap);

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !(cfg.tray && cfg.minimizeToTray)) {
      app.quit();
    }
  });

  app.on('activate', showWindow);

  app.on('before-quit', () => {
    isQuitting = true;
    saveWindowState();
  });
}

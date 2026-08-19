'use strict';

const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

const FIELD_IDS = [
  'productName', 'appId', 'version', 'author', 'entry',
  'iconPath', 'accentColor', 'accentColorText',
  'width', 'height', 'minWidth', 'minHeight', 'backgroundColor', 'backgroundColorText',
  'windowState', 'resizable', 'frameless', 'showMenuBar', 'rememberWindowState', 'zoomEnabled',
  'singleInstance', 'tray', 'minimizeToTray',
  'fileApi', 'externalLinksInBrowser', 'devTools', 'spaFallback',
  'platWin', 'platMac', 'platLinux',
  'winFormat', 'macFormat', 'linuxFormat',
  'outputBase', 'sourceDir',
  'repoUrl', 'repoRef', 'repoSubpath'
];

// 当前源模式：'local'（本地目录）| 'git'（Git 仓库）
let currentSourceMode = 'local';

const STORAGE_KEY = 'webapp-packer:state';

/* ===== State ===== */
let envInfo = null;
let lastResult = null;

function getInputs() {
  const platforms = [];
  if ($('platWin').checked) platforms.push('win');
  if ($('platMac').checked) platforms.push('mac');
  if ($('platLinux').checked) platforms.push('linux');

  const isGit = (currentSourceMode === 'git');
  return {
    sourceDir: isGit ? '' : $('sourceDir').value.trim(),
    repo: isGit ? ($('repoUrl').value.trim() || undefined) : undefined,
    ref: isGit ? ($('repoRef').value.trim() || undefined) : undefined,
    subpath: isGit ? ($('repoSubpath').value.trim() || undefined) : undefined,
    productName: $('productName').value.trim() || 'WebApp',
    appId: $('appId').value.trim() || undefined,
    version: $('version').value.trim() || '1.0.0',
    author: $('author').value.trim() || undefined,
    entry: $('entry').value.trim() || 'index.html',
    iconPath: $('iconPath').value.trim() || undefined,
    accentColor: $('accentColorText').value.trim() || '#2d5bff',
    backgroundColor: $('backgroundColorText').value.trim() || '#ffffff',
    width: Number($('width').value) || 1200,
    height: Number($('height').value) || 800,
    minWidth: Number($('minWidth').value) || 400,
    minHeight: Number($('minHeight').value) || 300,
    resizable: $('resizable').checked,
    fullscreen: $('windowState').value === 'fullscreen',
    maximized: $('windowState').value === 'maximized',
    frameless: $('frameless').checked,
    showMenuBar: $('showMenuBar').checked,
    rememberWindowState: $('rememberWindowState').checked,
    zoomEnabled: $('zoomEnabled').checked,
    singleInstance: $('singleInstance').checked,
    tray: $('tray').checked,
    minimizeToTray: $('minimizeToTray').checked,
    fileApi: $('fileApi').checked,
    externalLinksInBrowser: $('externalLinksInBrowser').checked,
    devTools: $('devTools').checked,
    spaFallback: $('spaFallback').checked,
    platforms,
    winFormat: $('winFormat').value,
    macFormat: $('macFormat').value,
    linuxFormat: $('linuxFormat').value,
    outputBase: $('outputBase').value.trim() || undefined
  };
}

function setInputs(state) {
  if (!state) return;
  for (const id of FIELD_IDS) {
    const el = $(id);
    if (!el) continue;
    if (state[id] === undefined) continue;
    if (el.type === 'checkbox') el.checked = !!state[id];
    else el.value = state[id];
  }
  updatePlatformVisibility();
}

function saveState() {
  const state = {};
  for (const id of FIELD_IDS) {
    const el = $(id);
    if (!el) continue;
    state[id] = el.type === 'checkbox' ? el.checked : el.value;
  }
  try {
    state.__sourceMode = currentSourceMode;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    // localStorage 满或不可用时静默忽略
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

/* ===== Tabs ===== */
function setupTabs() {
  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      $$('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      $$('.tab-panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === target));
    });
  });
}

/* ===== Color sync ===== */
function setupColorPair(colorId, textId) {
  const c = $(colorId);
  const t = $(textId);
  c.addEventListener('input', () => { t.value = c.value; saveState(); });
  t.addEventListener('change', () => {
    if (/^#[0-9a-fA-F]{6}$/.test(t.value)) c.value = t.value;
    saveState();
  });
}

/* ===== Source picker ===== */
async function pickSource() {
  const dir = await window.packer.pickDirectory();
  if (dir) $('sourceDir').value = dir;
  saveState();
}

function setupDropZone() {
  const dz = $('dropZone');
  dz.addEventListener('click', pickSource);

  ['dragenter', 'dragover'].forEach((evt) => {
    dz.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dz.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach((evt) => {
    dz.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dz.classList.remove('dragover');
    });
  });

  dz.addEventListener('drop', (e) => {
    const files = e.dataTransfer && e.dataTransfer.files;
    if (!files || files.length === 0) return;
    // Electron 会把拖入的第一个文件路径暴露在 path 属性
    const first = files[0];
    if (first.path) {
      $('sourceDir').value = first.path;
      saveState();
    }
  });
}

/* ===== Source mode toggle ===== */
function setSourceMode(mode) {
  if (mode !== 'local' && mode !== 'git') return;
  currentSourceMode = mode;
  $$('.seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.srcMode === mode));
  $$('.src-mode').forEach((m) => { m.hidden = (m.dataset.mode !== mode); });
  saveState();
}

/* ===== Platform visibility ===== */
function updatePlatformVisibility() {
  $('winFormatField').style.display = $('platWin').checked ? '' : 'none';
  $('macFormatField').style.display = $('platMac').checked ? '' : 'none';
  $('linuxFormatField').style.display = $('platLinux').checked ? '' : 'none';

  // 平台能力提示
  const cur = envInfo ? envInfo.platform : '';
  const parts = [];
  if ($('platWin').checked) parts.push('Windows');
  if ($('platMac').checked) parts.push('macOS');
  if ($('platLinux').checked) parts.push('Linux');
  if (parts.length === 0) {
    $('platformHint').textContent = '请至少选择一个目标平台';
  } else {
    let note = `将产出: ${parts.join(' / ')}`;
    if (cur === 'win32' && $('platMac').checked) {
      note += '  ·  macOS 需 Mac 才能正确签名，当前 Windows 端为占位生成，';
      note += '建议「导出源项目」后用 GitHub Actions 或 Mac 完成签名构建';
    }
    if (cur === 'win32' && $('platLinux').checked) {
      note += '  ·  Windows 上亦可构建 Linux AppImage';
    }
    $('platformHint').textContent = note;
  }
}

/* ===== Validation ===== */
function validate(inputs) {
  if (currentSourceMode === 'git') {
    if (!inputs.repo) return '请填写 Git 仓库地址';
  } else {
    if (!inputs.sourceDir) return '请先选择源目录';
  }
  if (!inputs.productName) return '请填写应用名称';
  if (inputs.platforms.length === 0) return '请至少选择一个目标平台';
  if (inputs.width < 320) return '宽度不能小于 320';
  if (inputs.height < 240) return '高度不能小于 240';
  return null;
}

/* ===== Logging ===== */
function appendLog(message, type) {
  const console_ = $('console');
  const line = document.createElement('div');
  line.className = 'log-line' + (type ? ' ' + type : '');
  line.textContent = message;
  console_.appendChild(line);
  console_.scrollTop = console_.scrollHeight;
}

function clearLog() {
  $('console').innerHTML = '';
}

function setProgress(percent, phase) {
  const wrap = $('progressWrap');
  if (percent === null || percent === undefined) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  $('progressFill').style.width = Math.max(0, Math.min(100, percent)) + '%';
  $('progressText').textContent = Math.round(percent) + '%' + (phase ? '  ' + phase : '');
}

function showOutputs(outputs, workDir) {
  const panel = $('resultPanel');
  if (!outputs || outputs.length === 0) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const ul = $('outputs');
  ul.innerHTML = '';
  for (const out of outputs) {
    const li = document.createElement('li');
    const name = out.split(/[\\/]/).pop();
    li.appendChild(document.createTextNode(name + '   '));
    const meta = document.createElement('span');
    meta.style.color = 'var(--text-3)';
    meta.textContent = out;
    li.appendChild(meta);

    const btn = document.createElement('button');
    btn.className = 'btn ghost open';
    btn.textContent = '定位';
    btn.addEventListener('click', () => window.packer.openItem(out));
    li.appendChild(btn);

    ul.appendChild(li);
  }
  $('openFolderBtn').onclick = () => {
    // 优先打开 dist 输出目录
    const out = lastResult && lastResult.outDir;
    if (out) window.packer.openFolder(out);
    else if (workDir) window.packer.openFolder(path_join(workDir, 'dist'));
  };
  $('openWorkDirBtn').onclick = () => window.packer.openFolder(workDir);
}

function path_join(a, b) {
  // 浏览器内没有 path 模块，简易 join
  if (!a) return b || '';
  const sep = a.includes('\\') ? '\\' : '/';
  return a.replace(/[\\/]+$/, '') + sep + String(b).replace(/^[\\/]+/, '').replace(/[\\/]+$/, '');
}

/* ===== Actions ===== */
function setBusy(busy) {
  $('packBtn').disabled = busy;
  $('exportBtn').disabled = busy;
  $('packBtn').textContent = busy ? '处理中…' : '开始打包';
}

async function runPack() {
  if (!window.packer) {
    appendLog('内部错误: IPC 不可用', 'err');
    return;
  }
  const inputs = getInputs();
  const err = validate(inputs);
  if (err) {
    appendLog('校验失败: ' + err, 'err');
    return;
  }

  lastResult = null;
  setBusy(true);
  clearLog();
  setProgress(0, '准备');
  $('resultPanel').hidden = true;
  $('resultTitle').textContent = '正在打包…';
  $('resultSubtitle').textContent = inputs.productName + ' → ' + inputs.platforms.join(' / ');

  try {
    const result = await window.packer.runPack(inputs);
    if (result.success) {
      appendLog('打包成功 ✓', 'ok');
      appendLog('工作目录: ' + result.workDir);
      appendLog('产物数量: ' + (result.outputs ? result.outputs.length : 0));
      setProgress(100, '完成');
      $('resultTitle').textContent = '打包完成';
      $('resultSubtitle').textContent = `${result.outputs.length} 个产物 · ${result.workDir}`;
      showOutputs(result.outputs, result.workDir);
    } else {
      appendLog('打包失败: ' + (result.error || '未知错误'), 'err');
      setProgress(null);
      $('resultTitle').textContent = '打包失败';
      $('resultSubtitle').textContent = result.error || '';
    }
    lastResult = result;
  } catch (err) {
    appendLog('未捕获错误: ' + (err && err.message ? err.message : String(err)), 'err');
    setProgress(null);
  } finally {
    setBusy(false);
  }
}

async function runExport() {
  if (!window.packer) return;
  const inputs = getInputs();
  const err = validate(inputs);
  if (err) {
    appendLog('校验失败: ' + err, 'err');
    return;
  }

  setBusy(true);
  clearLog();
  $('resultPanel').hidden = true;
  $('resultTitle').textContent = '正在导出源项目…';

  try {
    const result = await window.packer.exportSource(inputs);
    if (result.success) {
      appendLog('源项目已导出: ' + result.workDir, 'ok');
      appendLog('可直接 cd 进入后 npm install && npm start 运行');
      appendLog('或推送到 GitHub 触发 Actions 云构建');
      $('resultTitle').textContent = '源项目已导出';
      $('resultSubtitle').textContent = result.workDir;
      showOutputs([result.workDir], result.workDir);
    } else {
      appendLog('导出失败: ' + (result.error || '未知错误'), 'err');
    }
  } catch (err) {
    appendLog('未捕获错误: ' + (err && err.message ? err.message : String(err)), 'err');
  } finally {
    setBusy(false);
  }
}

/* ===== Wire events ===== */
function wireEvents() {
  setupTabs();
  setupColorPair('accentColor', 'accentColorText');
  setupColorPair('backgroundColor', 'backgroundColorText');
  setupDropZone();

  $$('.seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => setSourceMode(btn.dataset.srcMode));
  });

  $('pickSourceBtn').addEventListener('click', pickSource);
  $('pickIconBtn').addEventListener('click', async () => {
    const p = await window.packer.pickIcon();
    if (p) $('iconPath').value = p;
    saveState();
  });
  $('clearIconBtn').addEventListener('click', () => {
    $('iconPath').value = '';
    saveState();
  });
  $('pickOutputBtn').addEventListener('click', async () => {
    const p = await window.packer.pickOutput();
    if (p) $('outputBase').value = p;
    saveState();
  });

  ['platWin', 'platMac', 'platLinux'].forEach((id) => {
    $(id).addEventListener('change', () => { updatePlatformVisibility(); saveState(); });
  });

  FIELD_IDS.forEach((id) => {
    const el = $(id);
    if (!el) return;
    const ev = el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(ev, saveState);
  });

  $('packBtn').addEventListener('click', runPack);
  $('exportBtn').addEventListener('click', runExport);

  // IPC events
  if (window.packer && window.packer.onLog) {
    window.packer.onLog((data) => {
      if (data.type === 'log') {
        const msg = data.message || '';
        let type = '';
        if (/失败|错误|Error|error/i.test(msg)) type = 'err';
        else if (/警告|Warn|warn/i.test(msg)) type = 'warn';
        else if (/完成|成功|✓/.test(msg)) type = 'ok';
        else if (/^===/.test(msg)) type = 'head';
        appendLog(msg, type);
      }
    });
  }
  if (window.packer && window.packer.onProgress) {
    window.packer.onProgress((data) => {
      if (typeof data.percent === 'number') setProgress(data.percent, data.phase);
    });
  }
}

/* ===== Boot ===== */
async function boot() {
  wireEvents();
  const saved = loadState();
  if (saved) setInputs(saved);
  if (saved && saved.__sourceMode) setSourceMode(saved.__sourceMode);

  try {
    envInfo = await window.packer.getEnvInfo();
    $('outputBase').value = envInfo.defaultOutputBase;
  } catch (err) {
    appendLog('无法读取环境信息: ' + (err && err.message), 'err');
  }

  updatePlatformVisibility();
  appendLog('WebApp Packer 已就绪', 'head');
  appendLog('当前平台: ' + (envInfo ? envInfo.platform + ' / ' + envInfo.arch : '未知'));
  appendLog('选择源目录后即可开始打包', 'ok');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

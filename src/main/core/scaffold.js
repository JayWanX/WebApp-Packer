'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { prepareIcon } = require('./icon.js');

const EXCLUDE_NAMES = new Set([
  'node_modules', '.git', '.svn', '.hg', '.DS_Store',
  'Thumbs.db', '.env', '.env.local', '.cache', '.npm',
  '__pycache__', '.idea', '.vscode', '.vite', '.next',
  'dist', 'build', 'webapp-packer-cache'
]);

const EXCLUDE_SUFFIX = ['.log', '.tmp', '.bak', '.swp', '.lock'];

const TEMPLATE_FILES = {
  'main.js': 'runtime-main.js',
  'preload.js': 'runtime-preload.js'
};

const ASSETS_TEMPLATE_FILES = [];

function copyRecursive(src, dest, baseSrc, log) {
  const st = fs.statSync(src);
  if (st.isFile()) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    return;
  }
  if (!st.isDirectory()) return;

  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  let copied = 0;

  for (const entry of entries) {
    const rel = path.relative(baseSrc, path.join(src, entry.name));
    if (EXCLUDE_NAMES.has(entry.name) || EXCLUDE_NAMES.has(rel.split(path.sep)[0])) {
      log(`  跳过 ${path.relative(baseSrc, path.join(src, entry.name)) || entry.name}`);
      continue;
    }
    if (EXCLUDE_SUFFIX.some((suf) => entry.name.toLowerCase().endsWith(suf))) {
      log(`  跳过 ${path.relative(baseSrc, path.join(src, entry.name)) || entry.name}`);
      continue;
    }
    copyRecursive(path.join(src, entry.name), path.join(dest, entry.name), baseSrc, log);
    copied++;
  }
  if (copied === 0 && st.isDirectory()) {
    // 保留空目录以避免有些网站依赖空目录约定
  }
}

function getFiles(root, base = root) {
  const result = [];
  const st = fs.statSync(root);
  if (st.isFile()) {
    result.push(path.relative(base, root));
    return result;
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (EXCLUDE_NAMES.has(entry.name)) continue;
    if (EXCLUDE_SUFFIX.some((suf) => entry.name.toLowerCase().endsWith(suf))) continue;
    result.push(...getFiles(path.join(root, entry.name), base));
  }
  return result;
}

function appConfigFromInputs(inputs) {
  return {
    productName: inputs.productName || 'WebApp',
    entry: inputs.entry || 'index.html',
    width: Number(inputs.width) || 1200,
    height: Number(inputs.height) || 800,
    minWidth: Number(inputs.minWidth) || 400,
    minHeight: Number(inputs.minHeight) || 300,
    resizable: inputs.resizable !== false,
    fullscreen: !!inputs.fullscreen,
    maximized: !!inputs.maximized,
    frameless: !!inputs.frameless,
    showMenuBar: !!inputs.showMenuBar,
    rememberWindowState: inputs.rememberWindowState !== false,
    backgroundColor: inputs.backgroundColor || '#ffffff',
    singleInstance: inputs.singleInstance !== false,
    tray: !!inputs.tray,
    minimizeToTray: !!inputs.minimizeToTray,
    fileApi: inputs.fileApi !== false,
    externalLinksInBrowser: inputs.externalLinksInBrowser !== false,
    devTools: !!inputs.devTools,
    spaFallback: !!inputs.spaFallback,
    zoomEnabled: inputs.zoomEnabled !== false
  };
}

function buildTargetPackageJson(cfg) {
  return {
    name: (cfg.productName || 'webapp')
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'webapp',
    version: cfg.version || '1.0.0',
    description: cfg.description || '由 WebApp Packer 生成',
    main: 'main.js',
    author: cfg.author || 'WebApp Packer',
    license: 'MIT',
    private: true,
    scripts: {
      start: 'electron .',
      'pack:win': 'electron-builder --win --x64',
      'pack:mac': 'electron-builder --mac',
      'pack:linux': 'electron-builder --linux'
    },
    devDependencies: {
      electron: cfg.electronVersion || '33.2.1',
      'electron-builder': '25.1.8'
    }
  };
}

function buildBuildConfig(cfg, target, iconInfo) {
  const result = {
    appId: cfg.appId || `com.webapp.${target.productName.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
    productName: target.productName,
    copyright: target.copyright,
    files: [
      'main.js',
      'preload.js',
      'app-config.json',
      'www/**/*',
      'assets/**/*',
      'build/icon.png',
      'build/icon.ico',
      'package.json'
    ],
    directories: {
      output: target.outputDir
    },
    publish: null,
    // 跳过 node_modules 重装（只装我们声明的 electron 即可，dev 时间省 1-3 分钟）
    npmRebuild: false,
    // 跳过电子依赖预下载（已在脚本里处理过）
    electronDownload: { cache: '~/.cache/electron' }
  };

  // 目标应用本身的 asar 包含目标 www
  result.asar = true;

  if (target.platforms.includes('win')) {
    const winTarget = target.winFormat === 'portable' ? 'portable' : 'nsis';
    result.win = {
      target: [winTarget],   // 必须是数组，字符串会被按字符迭代
      icon: 'build/icon.png'
    };
    if (winTarget === 'nsis') {
      result.nsis = {
        oneClick: false,
        allowToChangeInstallationDirectory: true,
        perMachine: false,
        createDesktopShortcut: true,
        createStartMenuShortcut: true
      };
    }
  }

  if (target.platforms.includes('mac')) {
    result.mac = {
      target: [target.macFormat === 'dmg' ? 'dmg' : 'zip'],
      category: 'public.app-category.productivity',
      icon: 'build/icon.png'
    };
  }

  if (target.platforms.includes('linux')) {
    const linuxTarget = target.linuxFormat || 'AppImage';
    result.linux = {
      target: [linuxTarget],
      category: 'Utility',
      icon: 'build/icon.png'
    };
  }

  return result;
}

function scaffold(workDir, inputs, log) {
  log = log || (() => {});
  if (!workDir) throw new Error('workDir 不能为空');
  if (!inputs.sourceDir) throw new Error('sourceDir 不能为空');

  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });

  log(`工作目录: ${workDir}`);

  // 1. 复制用户源目录到 www/
  const sourceStat = fs.statSync(inputs.sourceDir);
  const sourceRoot = sourceStat.isFile()
    ? path.dirname(inputs.sourceDir)
    : inputs.sourceDir;
  const entryName = sourceStat.isFile() ? path.basename(inputs.sourceDir) : null;

  log('复制源文件到 www/...');
  if (sourceStat.isFile()) {
    fs.mkdirSync(path.join(workDir, 'www'), { recursive: true });
    fs.copyFileSync(inputs.sourceDir, path.join(workDir, 'www', entryName));
    log(`  ${entryName}`);
  } else {
    copyRecursive(inputs.sourceDir, path.join(workDir, 'www'), inputs.sourceDir, log);
  }

  // 2. 拷贝运行时模板
  log('写入 main.js / preload.js / app-config.json...');
  const templateDir = path.join(__dirname, 'templates');
  for (const [destName, tplName] of Object.entries(TEMPLATE_FILES)) {
    const src = path.join(templateDir, tplName);
    if (!fs.existsSync(src)) {
      throw new Error(`模板缺失: ${src}`);
    }
    fs.copyFileSync(src, path.join(workDir, destName));
  }
  const appConfig = appConfigFromInputs(inputs);
  fs.writeFileSync(
    path.join(workDir, 'app-config.json'),
    JSON.stringify(appConfig, null, 2),
    'utf8'
  );

  // 3. 准备图标
  log('准备图标...');
  const iconInfo = prepareIcon(
    inputs.iconPath,
    workDir,
    inputs.accentColor || '#2d5bff',
    log
  );

  // 4. 生成 package.json + build 配置
  const pkg = buildTargetPackageJson({
    productName: appConfig.productName,
    version: inputs.version,
    description: inputs.description,
    author: inputs.author,
    electronVersion: inputs.electronVersion || '33.2.1'
  });
  const target = {
    productName: appConfig.productName,
    copyright: inputs.copyright,
    outputDir: 'dist',
    platforms: inputs.platforms || ['win'],
    winFormat: inputs.winFormat || 'portable',
    macFormat: inputs.macFormat || 'dmg',
    linuxFormat: inputs.linuxFormat || 'AppImage',
    appId: inputs.appId
  };
  const buildConfig = buildBuildConfig(appConfig, target, iconInfo);

  // 把 build 配置写进 package.json 而非独立 electron-builder.yml，
  // 这样用户在目标目录直接 npm run pack:win 也能跑
  pkg.build = buildConfig;
  fs.writeFileSync(
    path.join(workDir, 'package.json'),
    JSON.stringify(pkg, null, 2),
    'utf8'
  );

  log('脚手架完成');

  return {
    workDir,
    iconInfo,
    appConfig,
    fileCount: getFiles(path.join(workDir, 'www')).length
  };
}

module.exports = {
  scaffold,
  appConfigFromInputs,
  buildTargetPackageJson,
  buildBuildConfig,
  getFiles
};

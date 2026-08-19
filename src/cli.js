#!/usr/bin/env node
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { scaffold } = require('./main/core/scaffold.js');
const { build: runBuild } = require('./main/core/builder.js');
const { generateWorkflow } = require('./main/core/workflow.js');
const { resolveSource, isGitUrl } = require('./main/core/source.js');

const HELP = `webapp-packer CLI — 将离线网页打包为桌面应用

用法:
  webapp-packer pack   --source <dir>  [选项]
  webapp-packer export --source <dir>  [选项]
  webapp-packer help

pack 选项:
  --source <dir>          源网页目录（与 --repo 二选一）
  --repo <url>            外部 git 仓库地址（与 --source 二选一）
  --ref <branch|tag|commit>  指定分支/标签/提交（默认取默认分支）
  --subpath <path>        仅打包仓库内子目录（如 dist/，默认整仓）
  --name <name>           应用名称（默认 WebApp）
  --entry <file>          入口文件（默认 index.html）
  --icon <path>           图标 PNG/ICO
  --platforms <list>      逗号分隔: win,mac,linux
  --win-format <type>     portable | nsis（默认 portable）
  --mac-format <type>     dmg | zip（默认 dmg）
  --linux-format <type>   AppImage（默认 AppImage）
  --out <dir>             输出根目录
  --author <name>         作者
  --version <ver>         版本号
  --no-single-instance    允许多实例
  --no-file-api           禁用本地文件 API
  --devtools              启用开发者工具
  --spa-fallback          启用 SPA 路由回退

export 选项:
  --source <dir> | --repo <url>   必填（二选一）
  --ref / --subpath / --name / --out 等同上

示例:
  webapp-packer pack --source ./my-site --name "My App" --platforms win
  webapp-packer pack --repo https://github.com/user/site.git --name "My App" --platforms win
  webapp-packer pack --repo https://github.com/user/site.git --ref main --subpath dist --platforms win,mac,linux
  webapp-packer export --repo https://github.com/user/site.git --name "My App"
`;

function parseArgs(argv) {
  const result = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (key === 'no-single-instance') result.singleInstance = false;
      else if (key === 'no-file-api') result.fileApi = false;
      else if (key === 'devtools') result.devTools = true;
      else if (key === 'spa-fallback') result.spaFallback = true;
      else if (key === 'help') result.help = true;
      else {
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) {
          result[key] = true;
        } else {
          result[key] = next;
          i++;
        }
      }
    } else {
      result._.push(a);
    }
  }
  return result;
}

function buildInputsFromArgs(args) {
  const isRepo = !!(args.repo || (args.source && isGitUrl(args.source)));
  if (!args.source && !args.repo) throw new Error('--source 或 --repo 必填');

  let sourceDir;
  if (isRepo) {
    sourceDir = undefined; // 由 resolveSource 克隆后填充
  } else {
    sourceDir = path.resolve(String(args.source));
    if (!fs.existsSync(sourceDir)) throw new Error('源目录不存在: ' + sourceDir);
  }

  const platforms = args.platforms
    ? String(args.platforms).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    : ['win'];

  const outBase = args.out ? path.resolve(String(args.out)) : path.join(os.homedir(), 'webapp-packer-output');

  return {
    sourceDir,
    repo: args.repo || (isRepo ? String(args.source) : undefined),
    ref: args.ref || undefined,
    subpath: args.subpath || undefined,
    productName: args.name || 'WebApp',
    entry: args.entry || 'index.html',
    iconPath: args.icon ? path.resolve(String(args.icon)) : undefined,
    accentColor: '#2d5bff',
    author: args.author,
    version: args.version || '1.0.0',
    platforms,
    winFormat: args['win-format'] || 'portable',
    macFormat: args['mac-format'] || 'dmg',
    linuxFormat: args['linux-format'] || 'AppImage',
    outputBase: outBase,
    singleInstance: args.singleInstance !== false,
    fileApi: args.fileApi !== false,
    devTools: !!args.devTools,
    spaFallback: !!args.spaFallback,
    backgroundColor: '#ffffff',
    resizable: true,
    fullscreen: false,
    maximized: false,
    frameless: false,
    showMenuBar: false,
    rememberWindowState: true,
    externalLinksInBrowser: true,
    tray: false,
    minimizeToTray: false,
    zoomEnabled: true
  };
}

function makeWorkDir(inputs) {
  const safe = (inputs.productName || 'webapp')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'webapp';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace(/T/, '_').slice(0, 19);
  return path.join(inputs.outputBase, `${safe}_${stamp}`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(HELP);
    return;
  }

  const cmd = argv[0];
  const args = parseArgs(argv.slice(1));
  const inputs = buildInputsFromArgs(args);
  const workDir = makeWorkDir(inputs);

  if (cmd !== 'pack' && cmd !== 'export') {
    process.stderr.write('未知命令: ' + cmd + '\n\n' + HELP);
    process.exit(1);
  }

  const log = (msg) => process.stdout.write(msg + '\n');
  const progress = (d) => {
    if (typeof d.percent === 'number') {
      process.stdout.write(`[${String(Math.round(d.percent)).padStart(3, ' ')}%] ${d.phase || ''}\n`);
    }
  };

  log('=== webapp-packer ' + cmd + ' ===');
  log('源: ' + (inputs.repo ? inputs.repo + (inputs.ref ? ' @ ' + inputs.ref : '') : inputs.sourceDir));
  log('应用: ' + inputs.productName);
  log('平台: ' + inputs.platforms.join(', '));
  log('工作目录: ' + workDir);

  let cleanup = () => {};
  try {
    const resolved = resolveSource(inputs, log);
    inputs.sourceDir = resolved.sourceDir;
    cleanup = resolved.cleanup || (() => {});

    const scaffoldResult = scaffold(workDir, inputs, log);
    log('脚手架完成: ' + scaffoldResult.fileCount + ' 个文件');

    if (cmd === 'export') {
      const wf = generateWorkflow(workDir, inputs.productName);
      log('Workflow: ' + wf.workflowPath);
      log('=== 导出完成 ===');
      log('下一步: cd ' + workDir);
      log('  npm install');
      log('  npm start           # 在开发模式下运行');
      log('  npm run pack:win    # 在当前平台构建 Windows 安装包');
      return;
    }

    const buildResult = await runBuild(workDir, { platforms: inputs.platforms }, log, progress);
    log('=== 打包完成 ===');
    log('输出目录: ' + (buildResult.outDir || path.join(workDir, 'dist')));
    for (const out of (buildResult.outputs || [])) {
      log('  产物: ' + out);
    }
  } catch (err) {
    process.stderr.write('错误: ' + (err && err.message ? err.message : String(err)) + '\n');
    if (err && err.stack) process.stderr.write(err.stack + '\n');
    process.exitCode = 1;
  } finally {
    cleanup();
  }
}

main().catch((err) => {
  process.stderr.write('致命错误: ' + (err && err.message ? err.message : String(err)) + '\n');
  if (err && err.stack) process.stderr.write(err.stack + '\n');
  process.exit(1);
});

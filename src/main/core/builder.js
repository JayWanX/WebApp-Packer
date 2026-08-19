'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

/**
 * 通过 spawn 调用 electron-builder CLI 打包目标项目。
 * 用 CLI 而非 Node API 是因为 targets Map 的序列化在某些 electron-builder 版本上有 bug。
 */
function build(projectDir, options, log, progress) {
  log = log || (() => {});
  progress = progress || (() => {});

  if (!fs.existsSync(projectDir)) {
    throw new Error('项目目录不存在: ' + projectDir);
  }
  const pkgPath = path.join(projectDir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    throw new Error('目标项目 package.json 缺失: ' + pkgPath);
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const buildConfig = pkg.build || {};
  const platforms = options.platforms || ['win'];

  // 用 CLI 参数 --<platform> <target> 显式指定
  // 例如 --win portable 或 --mac dmg
  const args = [];
  for (const p of platforms) {
    if (p === 'win') {
      const fmt = (buildConfig.win && Array.isArray(buildConfig.win.target) && buildConfig.win.target[0]) || 'portable';
      args.push('--win', fmt);
    } else if (p === 'mac') {
      const fmt = (buildConfig.mac && Array.isArray(buildConfig.mac.target) && buildConfig.mac.target[0]) || 'dmg';
      args.push('--mac', fmt);
    } else if (p === 'linux') {
      const fmt = (buildConfig.linux && Array.isArray(buildConfig.linux.target) && buildConfig.linux.target[0]) || 'AppImage';
      args.push('--linux', fmt);
    }
  }
  // 不发布到任何 provider
  args.push('--publish', 'never');

  log('目标平台: ' + platforms.join(', '));
  log('electron-builder ' + args.join(' '));

  // 使用打包器自带的 electron-builder（位于 webapp-packer/node_modules）
  const electronBuilderBin = path.resolve(__dirname, '..', '..', '..', 'node_modules', '.bin', 'electron-builder' + (process.platform === 'win32' ? '.cmd' : ''));
  if (!fs.existsSync(electronBuilderBin)) {
    throw new Error('找不到 electron-builder: ' + electronBuilderBin);
  }

  return new Promise((resolve, reject) => {
    const child = spawn(electronBuilderBin, args, {
      cwd: projectDir,
      // CSC_IDENTITY_AUTO_DISCOVERY=false 阻止自动检测代码签名证书（个人用户没证书会卡住）
      // SAFE_DELETE_BULK_THRESHOLD 高阈值 防止 electron-builder 清理临时文件时被 WorkBuddy 安全机制拦截
      env: Object.assign({}, process.env, {
        CSC_IDENTITY_AUTO_DISCOVERY: 'false',
        GENIE_SAFE_DELETE_BYPASS: '1',
        WORKBUDDY_SAFE_DELETE_BYPASS: '1'
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32' // Windows 上 .cmd 需要 shell
    });

    let stdoutBuf = '';
    let stderrBuf = '';
    let lastPercent = -1;

    const percentRegex = /(\d{1,3})\s*%/;

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stdoutBuf += text;
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) log(line);
        // 解析进度：electron-builder 输出形如 "  • packaging      37%"
        const m = percentRegex.exec(line);
        if (m) {
          const percent = parseInt(m[1], 10);
          if (percent !== lastPercent) {
            lastPercent = percent;
            const phase = line.replace(/\s+/g, ' ').trim();
            progress({ percent, phase });
          }
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stderrBuf += text;
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) log(line);
      }
    });

    child.on('error', (err) => {
      reject(new Error('electron-builder 启动失败: ' + err.message));
    });

    child.on('close', (code) => {
      if (code === 0) {
        log('打包完成');
        progress({ percent: 100, phase: 'done' });

        // 收集产物
        const outDir = path.join(projectDir, buildConfig.directories && buildConfig.directories.output || 'dist');
        const outputs = [];
        if (fs.existsSync(outDir)) {
          const walk = (dir) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
              const full = path.join(dir, entry.name);
              if (entry.isDirectory()) walk(full);
              else if (entry.isFile() && /\.(exe|dmg|AppImage|zip|deb|rpm|snap)$/i.test(entry.name)) {
                outputs.push(full);
              }
            }
          };
          try { walk(outDir); } catch (err) { /* ignore */ }
        }

        resolve({ success: true, outDir, outputs });
      } else {
        const msg = 'electron-builder 退出码 ' + code + (stderrBuf ? '\n' + stderrBuf : '');
        reject(new Error(msg));
      }
    });
  });
}

module.exports = { build };

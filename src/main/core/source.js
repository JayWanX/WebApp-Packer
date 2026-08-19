'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

/**
 * 判断字符串是否像 git 仓库地址：
 *   - https:// / http:// / ssh:// / git:// 协议
 *   - git@host:owner/repo 形式
 *   - 以 .git 结尾
 */
function isGitUrl(s) {
  if (!s || typeof s !== 'string') return false;
  const v = s.trim();
  if (/^(https?|ssh|git|file):\/\//i.test(v)) return true;
  if (/^git@[^:/]+[:/].+\.git$/i.test(v)) return true;
  if (/^[^@\s]+@[^:\s]+:.+\.git$/i.test(v)) return true;
  if (/\.git$/i.test(v) && /\//.test(v)) return true;
  return false;
}

function runGit(args, log) {
  const res = spawnSync('git', args, {
    cwd: os.tmpdir(),
    encoding: 'utf8',
    timeout: 180000,
    windowsHide: true,
    env: Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0' })
  });
  if (res.error) {
    throw new Error('执行 git 失败: ' + res.error.message);
  }
  if (res.status !== 0) {
    const out = (res.stderr || res.stdout || '').trim();
    throw new Error('git ' + args.join(' ') + ' 失败 (' + res.status + '): ' + out);
  }
  if (log && res.stdout && res.stdout.trim()) log(res.stdout.trim());
}

const SHA_RE = /^[0-9a-f]{7,40}$/i;

function cloneRepo(url, ref, log) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wapp-repo-'));
  const args = ['clone', '--depth', '1'];
  if (ref && !SHA_RE.test(ref)) {
    args.push('--branch', ref);
  }
  args.push(url, tmp);
  if (log) log('克隆仓库: ' + url + (ref ? ' @ ' + ref : ' (默认分支)'));
  runGit(args, log);

  // 指定了 commit SHA：在浅克隆基础上再 fetch 该提交
  if (ref && SHA_RE.test(ref)) {
    if (log) log('检出提交: ' + ref);
    runGit(['-C', tmp, 'fetch', '--depth', '1', 'origin', ref], log);
    runGit(['-C', tmp, 'checkout', ref], log);
  }
  return tmp;
}

/**
 * 解析打包源：
 *   - 若 inputs.repo（或 sourceDir 是 git 地址）存在 → 克隆到临时目录，返回其路径与清理函数
 *   - 否则原样返回本地 sourceDir
 * 返回 { sourceDir, cleanup }
 */
function resolveSource(inputs, log) {
  log = log || (() => {});
  const repoUrl = inputs.repo || (inputs.sourceDir && isGitUrl(inputs.sourceDir) ? inputs.sourceDir : null);
  if (!repoUrl) {
    return { sourceDir: inputs.sourceDir, cleanup: () => {} };
  }

  const tmp = cloneRepo(repoUrl, inputs.ref || null, log);
  let sourceDir = tmp;
  if (inputs.subpath && String(inputs.subpath).trim()) {
    sourceDir = path.join(tmp, String(inputs.subpath).trim().replace(/^[\\/]+/, '').replace(/[\\/]+$/, ''));
    if (!fs.existsSync(sourceDir)) {
      throw new Error('仓库内子目录不存在: ' + inputs.subpath);
    }
  }
  const cleanup = () => {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch (e) {
      /* 临时目录清理失败不阻断主流程 */
    }
  };
  return { sourceDir, cleanup };
}

module.exports = { isGitUrl, resolveSource, cloneRepo };

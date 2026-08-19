'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * 在 scaffold 后的项目根目录写入 .github/workflows/build.yml。
 * 触发方式：push tag (v*) 或手动 dispatch。
 * 矩阵构建：windows-latest / macos-latest / ubuntu-latest。
 */
function generateWorkflow(projectDir, productName) {
  if (!fs.existsSync(projectDir)) {
    throw new Error('项目目录不存在: ' + projectDir);
  }

  const name = productName || 'WebApp';
  const safeName = name.replace(/[^A-Za-z0-9_-]+/g, '-');

  // 使用数组拼接而非模板字符串，避免 ${{ }} 被 Node 当作模板插值
  const lines = [
    'name: Build ' + safeName,
    '',
    'on:',
    '  push:',
    '    tags:',
    '      - \'v*\'',
    '  workflow_dispatch:',
    '',
    'jobs:',
    '  build:',
    '    name: ${{ matrix.os }}',
    '    runs-on: ${{ matrix.os }}',
    '    strategy:',
    '      fail-fast: false',
    '      matrix:',
    '        os: [windows-latest, macos-latest, ubuntu-latest]',
    '',
    '    steps:',
    '      - name: Checkout',
    '        uses: actions/checkout@v4',
    '',
    '      - name: Setup Node.js',
    '        uses: actions/setup-node@v4',
    '        with:',
    '          node-version: \'20\'',
    '          cache: \'npm\'',
    '',
    '      - name: Install system dependencies (Linux)',
    '        if: matrix.os == \'ubuntu-latest\'',
    '        run: |',
    '          sudo apt-get update',
    '          sudo apt-get install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 libxss1 libasound2 libgtk-3-0 libgbm1 xvfb',
    '',
    '      - name: Build (${{ matrix.os }})',
    '        env:',
    '          CSC_IDENTITY_AUTO_DISCOVERY: "false"',
    '        run: |',
    '          npm ci',
    '          if [ "${{ matrix.os }}" = "windows-latest" ]; then',
    '            npm run pack:win',
    '          elif [ "${{ matrix.os }}" = "macos-latest" ]; then',
    '            npm run pack:mac',
    '          else',
    '            xvfb-run --auto-servernum --server-args="-screen 0 1024x768x24" npm run pack:linux',
    '          fi',
    '',
    '      - name: Upload artifacts (Windows)',
    '        if: matrix.os == \'windows-latest\'',
    '        uses: actions/upload-artifact@v4',
    '        with:',
    '          name: ' + safeName + '-windows',
    '          path: dist/*.exe',
    '          if-no-files-found: warn',
    '',
    '      - name: Upload artifacts (macOS)',
    '        if: matrix.os == \'macos-latest\'',
    '        uses: actions/upload-artifact@v4',
    '        with:',
    '          name: ' + safeName + '-macos',
    '          path: |',
    '            dist/*.dmg',
    '            dist/*.zip',
    '          if-no-files-found: warn',
    '',
    '      - name: Upload artifacts (Linux)',
    '        if: matrix.os == \'ubuntu-latest\'',
    '        uses: actions/upload-artifact@v4',
    '        with:',
    '          name: ' + safeName + '-linux',
    '          path: |',
    '            dist/*.AppImage',
    '            dist/*.deb',
    '            dist/*.snap',
    '            dist/*.zip',
    '          if-no-files-found: warn',
    '',
    '      - name: Attach to release (Windows)',
    '        if: startsWith(github.ref, \'refs/tags/v\') && matrix.os == \'windows-latest\'',
    '        uses: softprops/action-gh-release@v2',
    '        with:',
    '          files: |',
    '            dist/*.exe',
    '            dist/*.exe.blockmap',
    '',
    '      - name: Attach to release (macOS)',
    '        if: startsWith(github.ref, \'refs/tags/v\') && matrix.os == \'macos-latest\'',
    '        uses: softprops/action-gh-release@v2',
    '        with:',
    '          files: |',
    '            dist/*.dmg',
    '            dist/*.dmg.blockmap',
    '            dist/*.zip',
    '            dist/latest-mac.yml',
    '',
    '      - name: Attach to release (Linux)',
    '        if: startsWith(github.ref, \'refs/tags/v\') && matrix.os == \'ubuntu-latest\'',
    '        uses: softprops/action-gh-release@v2',
    '        with:',
    '          files: |',
    '            dist/*.AppImage',
    '            dist/*.deb',
    '            dist/*.snap',
    '            dist/*.zip',
    '            dist/latest-linux.yml',
    ''
  ];

  const workflow = lines.join('\n');

  const workflowDir = path.join(projectDir, '.github', 'workflows');
  fs.mkdirSync(workflowDir, { recursive: true });
  fs.writeFileSync(path.join(workflowDir, 'build.yml'), workflow, 'utf8');

  // 写入 README 提示
  const readme = '# ' + name + ' — Electron Build Source\n\n'
    + 'This directory contains the source code for a desktop application built by **WebApp Packer**.\n\n'
    + '## Run from source\n\n'
    + '```bash\n'
    + 'npm install\n'
    + 'npm start\n'
    + '```\n\n'
    + '## Build locally\n\n'
    + '```bash\n'
    + 'npm run pack:win     # Windows: portable .exe\n'
    + 'npm run pack:mac     # macOS: .dmg / .zip\n'
    + 'npm run pack:linux   # Linux: AppImage\n'
    + '```\n\n'
    + '> The `dist/` folder is the build output. `www/` is the original offline web content.\n\n'
    + '## Build via GitHub Actions\n\n'
    + '1. Push this directory to a GitHub repository.\n'
    + '2. The workflow in `.github/workflows/build.yml` will run on `v*` tag pushes.\n'
    + '3. Manual trigger: `Actions` tab → `Build ' + safeName + '` → `Run workflow`.\n'
    + '4. Artifacts are uploaded for each platform.\n\n'
    + '### Tag a release\n\n'
    + '```bash\n'
    + 'git tag v1.0.0\n'
    + 'git push origin v1.0.0\n'
    + '```\n\n'
    + 'Builds for all three platforms will be attached to the GitHub Release automatically.\n';

  fs.writeFileSync(path.join(projectDir, 'README.md'), readme, 'utf8');
  fs.writeFileSync(path.join(projectDir, '.gitignore'),
    'node_modules/\ndist/\n*.log\n.DS_Store\n', 'utf8');

  return {
    workflowPath: path.join(workflowDir, 'build.yml')
  };
}

module.exports = { generateWorkflow };

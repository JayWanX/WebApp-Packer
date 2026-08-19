# WebApp Packer

把离线网页目录一键打包为 Windows / macOS / Linux 桌面应用。

基于 [Electron](https://www.electronjs.org/) + [electron-builder](https://www.electron.build/)。

## 特性

- **图形界面** — 拖入网页目录、填表、点开始，零命令行。
- **命令行** — 给脚本和 CI 用。
- **三平台输出** — Windows (portable exe / NSIS) / macOS (dmg / zip) / Linux (AppImage)。
- **自定义协议加载** — 用 `app://` 而非 `file://` 加载网页，ES module / fetch / localStorage 全部正常工作。
- **可注入桌面 API** — 网页内可调用 `window.desktopAPI` 读写本地文件、调系统对话框、记持久化存储。
- **窗口控制** — 尺寸/全屏/无边框/缩放限制/记忆位置。
- **托盘与单实例** — 可选。
- **Git 仓库源** — 直接把远程仓库（branch / tag / commit + 子目录）当作打包目标，无需先 clone 到本地；导出时会把内容内联进项目，GitHub Actions 构建无需仓库访问。
- **GitHub Actions 云构建** — 一键导出可移植源项目，push 后云端矩阵构建三平台。

## 快速开始

### 1. 启动 GUI

```bash
npm install
npm start
```

### 2. 命令行打包

```bash
# 本地目录
node src/cli.js pack --source ./my-website --name "My App" --platforms win

# 外部 Git 仓库（与 --source 二选一）
node src/cli.js pack --repo https://github.com/user/site.git --name "My App" --platforms win
node src/cli.js pack --repo https://github.com/user/site.git --ref main --subpath dist --platforms win,mac,linux
```

`--source` 与 `--repo` 二选一；`--repo` 支持指定分支/标签/commit（`--ref`）与仓库内子目录（`--subpath`）。支持 `win` / `mac` / `linux` 多选。

### 3. 从 Git 仓库打包

打包目标不必是本地目录，可以直接是远程仓库：

- `--repo <url>`：https / git / SSH 地址，或本地 `.git` 目录。
- `--ref <branch|tag|commit>`：不填取默认分支；填 commit SHA 会自动 `fetch` 该提交。
- `--subpath <path>`：只打包仓库内某个子目录（如构建产物 `dist/`），留空表示整仓。

GUI 中切到「源内容 → Git 仓库」模式，填地址与可选的 ref / subpath 即可，其余配置一致。

### 4. 导出可移植源项目（推 GitHub 云构建）

```bash
# 本地目录
node src/cli.js export --source ./my-website --name "My App"

# 外部 Git 仓库（导出时自动拉取并内联进 www/）
node src/cli.js export --repo https://github.com/user/site.git --name "My App"
```

把生成的目录推到 GitHub，Actions 会在三台 runner 上分别构建对应平台产物。用 `--repo` 导出时，仓库内容已在导出阶段克隆并内联进 `www/`，因此云端构建**不需要**任何仓库访问权限。

## 网页端的桌面 API

打包后的网页可通过 `window.desktopAPI` 访问：

```js
// 运行时信息
const info = await window.desktopAPI.getInfo();

// 弹保存对话框并直接写入
const savedPath = await window.desktopAPI.saveAs('note.txt', 'hello');

// 弹打开对话框并直接读文本
const { path, content } = await window.desktopAPI.openAs([{ name: '文本', extensions: ['txt'] }]);

// 选择目录
const dir = await window.desktopAPI.dialog.selectDirectory();

// 持久化 KV 存储
await window.desktopAPI.store.set('theme', 'dark');
const theme = await window.desktopAPI.store.get('theme');

// 通用 fs 操作
await window.desktopAPI.fs.writeText('C:/x.txt', 'data');
const txt = await window.desktopAPI.fs.readText('C:/x.txt');

// 打开外部链接
await window.desktopAPI.shell.openExternal('https://...');
```

`isDesktop` 标志用于判断当前是否在桌面环境运行：

```js
if (window.desktopAPI && window.desktopAPI.isDesktop) {
  // 桌面专属功能
}
```

## 配置能力

| 能力         | 默认 | 说明                      |
| ---------- | -- | ----------------------- |
| 单实例        | ✅  | 防止重复启动                  |
| 外部链接走系统浏览器 | ✅  | window.open 拦截          |
| 本地文件 API   | ✅  | `window.desktopAPI`     |
| 记忆窗口位置     | ✅  | 写入 userData             |
| 允许缩放       | ✅  | Ctrl +/- / Ctrl 滚轮      |
| 开发者工具      | ❌  | 开启后 F12                 |
| 系统托盘       | ❌  | 开启后最小化到托盘               |
| 无边框        | ❌  | 自定义标题栏场景                |
| 显示菜单栏      | ❌  | macOS 强制保留最小菜单（系统级复制粘贴） |
| SPA 路由回退   | ❌  | 未知路径返回入口 HTML           |

## 项目结构

```
webapp-packer/
├── src/
│   ├── main/
│   │   ├── index.js          # 打包器自身的 Electron 主进程
│   │   ├── preload.js        # 打包器的 preload 桥
│   │   └── core/
│   │       ├── scaffold.js   # 目标项目脚手架生成
│   │       ├── builder.js    # electron-builder Node API 封装
│   │       ├── source.js     # Git 仓库源解析（clone / ref / subpath）
│   │       ├── workflow.js   # GitHub Actions 工作流生成
│   │       ├── icon.js       # 无依赖 PNG 编码器与默认图标生成
│   │       └── templates/
│   │           ├── runtime-main.js     # 注入到目标 APP 的主进程
│   │           └── runtime-preload.js  # 注入到目标 APP 的 preload
│   ├── renderer/
│   │   ├── index.html        # 打包器 UI
│   │   ├── styles.css
│   │   └── app.js
│   └── cli.js                # 命令行入口
└── package.json
```

## 图标说明

- 推荐 512×512 PNG，electron-builder 会自动生成各平台图标格式。
- ICO 仅 Windows 生效，macOS / Linux 会用程序自动生成的兜底 PNG。
- 不提供图标时使用程序生成的默认图标（蓝色圆角 + 窗口图形）。

## 已知限制

- macOS 产物在 Windows / Linux 上无法正确签名；导出源项目后用 GitHub Actions 或 Mac 完成。
- electron-builder 首次打包需联网下载 Electron 二进制（~100MB）。
- Windows 7 不支持（Electron 33 已停止支持）。
- Windows 下 `file:///C:/...` 形式的 git URL 会被 git-for-Windows 的路径转换破坏；本地仓库直接当目录拖入，或远程仓库用 `https` 即可。

## License

MIT

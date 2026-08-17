# TestApp — Electron Build Source

This directory contains the source code for a desktop application built by **WebApp Packer**.

## Run from source

```bash
npm install
npm start
```

## Build locally

```bash
npm run pack:win     # Windows: portable .exe
npm run pack:mac     # macOS: .dmg / .zip
npm run pack:linux   # Linux: AppImage
```

> The `dist/` folder is the build output. `www/` is the original offline web content.

## Build via GitHub Actions

1. Push this directory to a GitHub repository.
2. The workflow in `.github/workflows/build.yml` will run on `v*` tag pushes.
3. Manual trigger: `Actions` tab → `Build TestApp` → `Run workflow`.
4. Artifacts are uploaded for each platform.

### Tag a release

```bash
git tag v1.0.0
git push origin v1.0.0
```

Builds for all three platforms will be attached to the GitHub Release automatically.

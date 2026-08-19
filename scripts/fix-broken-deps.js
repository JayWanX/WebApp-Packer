'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const https = require('node:https');

const REGISTRY = 'https://registry.npmjs.org';

function walk(dir, results) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, results);
    else if (e.name === 'package.json' && !full.includes(path.sep + 'node_modules' + path.sep + 'node_modules' + path.sep)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(full, 'utf8'));
        if (!pkg.main) continue;
        const mainPath = path.resolve(path.dirname(full), pkg.main);
        if (!fs.existsSync(mainPath)) {
          results.push({ pkgDir: path.dirname(full), main: pkg.main, mainPath, name: pkg.name, version: pkg.version });
        }
      } catch (err) { /* skip */ }
    }
  }
}

function fetch(url) {
  return new Promise((resolve, reject) => {
    const get = (u) => https.get(u, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) return get(res.headers.location).then(resolve, reject);
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode + ' for ' + u));
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', (e) => reject(new Error('stream error: ' + e.message)));
    }).on('error', (e) => reject(new Error('request error: ' + e.message)));
    get(url);
  });
}

async function fetchTarball(name, version) {
  const nameEnc = name.startsWith('@') ? '@' + encodeURIComponent(name.slice(1)) : encodeURIComponent(name);
  const metaUrl = REGISTRY + '/' + nameEnc + '/' + version;
  const meta = await fetch(metaUrl);
  const data = JSON.parse(meta.toString('utf8'));
  if (!data.dist || !data.dist.tarball) throw new Error('No tarball URL for ' + name);
  return fetch(data.dist.tarball);
}

function extractTarGz(buf, destDir) {
  let offset = 0;
  while (offset < buf.length) {
    if (offset + 512 > buf.length) break;
    const header = buf.subarray(offset, offset + 512);
    const nameRaw = header.subarray(0, 100).toString('utf8').replace(/\0+$/, '');
    if (!nameRaw) break;
    const sizeOct = header.subarray(124, 136).toString('utf8').replace(/\0+$/, '').trim();
    const size = parseInt(sizeOct, 8) || 0;
    const typeFlag = String.fromCharCode(header[156]);
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0+$/, '');
    const fullName = prefix ? prefix + '/' + nameRaw : nameRaw;
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    const paddedEnd = dataStart + Math.ceil(size / 512) * 512;
    if (typeFlag === '0' || typeFlag === '\0') {
      const rel = fullName.replace(/^package\//, '');
      if (!rel || rel === 'package') { offset = paddedEnd; continue; }
      const target = path.join(destDir, rel);
      if (fullName.endsWith('/')) fs.mkdirSync(target, { recursive: true });
      else {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, buf.subarray(dataStart, dataEnd));
      }
    }
    offset = paddedEnd;
  }
}

async function main() {
  const root = path.resolve('node_modules');
  const broken = [];
  walk(root, broken);
  console.log('Found ' + broken.length + ' broken packages');

  function walkAll(dir, cb) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walkAll(full, cb);
      else cb(full);
    }
  }
  let deleteStubs = 0;
  walkAll(root, (f) => {
    if (f.includes('.DELETE.')) { try { fs.unlinkSync(f); deleteStubs++; } catch (err) { /* skip */ } }
  });
  console.log('Cleaned ' + deleteStubs + ' .DELETE. stubs');

  const seen = new Set();
  const unique = broken.filter((b) => {
    const key = b.name + '@' + b.version + '@' + b.pkgDir;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  let ok = 0, fail = 0;
  for (const b of unique) {
    process.stdout.write('  ' + b.name + '@' + b.version + '... ');
    try {
      const tarball = await fetchTarball(b.name, b.version);
      if (fs.existsSync(b.pkgDir)) {
        for (const e of fs.readdirSync(b.pkgDir)) {
          try { fs.rmSync(path.join(b.pkgDir, e), { recursive: true, force: true }); } catch (err) {}
        }
      }
      const gunzipped = zlib.gunzipSync(tarball);
      extractTarGz(gunzipped, b.pkgDir);
      if (fs.existsSync(b.mainPath)) { console.log('OK'); ok++; }
      else { console.log('FAIL (main still missing after extract)'); fail++; }
    } catch (err) {
      console.log('FAIL: ' + (err.message || '(no message)'));
      if (err.stack) console.log('    ' + err.stack.split('\n').slice(0, 3).join('\n    '));
      fail++;
    }
  }
  console.log('\nDone: ' + ok + ' ok, ' + fail + ' failed');
}

main().catch((err) => { console.error('Top-level error:', err); process.exit(1); });

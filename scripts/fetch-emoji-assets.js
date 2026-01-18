#!/usr/bin/env node
/*
 * Download Telegram animated emojis bundle on install to avoid bundling ~400MB in git.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { spawn } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const EMOJI_DIR = path.join(PROJECT_ROOT, 'public', 'telegram-animated-emojis');
const MANIFEST = path.join(EMOJI_DIR, 'manifest.json');
const ASSET_URL = process.env.OS_EMOJI_URL ||
  'https://github.com/GuntarWi/OpenScreen/releases/download/emoji-assets-v1/telegram-animated-emojis.tar.gz';

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function alreadyPresent() {
  try {
    return fs.existsSync(MANIFEST);
  } catch {
    return false;
  }
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`Download failed: ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
    }).on('error', (err) => {
      fs.unlink(dest, () => reject(err));
    });
  });
}

function extractTarGz(tarPath) {
  return new Promise((resolve, reject) => {
    const tar = spawn('tar', ['-xzf', tarPath, '-C', PROJECT_ROOT]);
    tar.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`tar exited with code ${code}`));
    });
    tar.on('error', reject);
  });
}

(async () => {
  if (alreadyPresent()) {
    console.log('[emoji-assets] Already present, skipping download.');
    return;
  }

  console.log(`[emoji-assets] Fetching emoji bundle from ${ASSET_URL}`);
  ensureDir(EMOJI_DIR);
  const tmpFile = path.join(os.tmpdir(), `telegram-animated-emojis-${Date.now()}.tar.gz`);
  try {
    await download(ASSET_URL, tmpFile);
    await extractTarGz(tmpFile);
    console.log('[emoji-assets] Downloaded and extracted.');
  } catch (err) {
    console.warn('[emoji-assets] Failed to download bundle, emojis will stream from remote source at runtime.', err.message);
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
})();

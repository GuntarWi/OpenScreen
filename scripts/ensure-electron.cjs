#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const electronRoot = path.join(projectRoot, 'node_modules', 'electron');
const electronPackageJson = path.join(electronRoot, 'package.json');

if (!fs.existsSync(electronPackageJson)) {
  console.error('[ensure-electron] Missing node_modules/electron. Run `npm install` first.');
  process.exit(1);
}

const electronPkg = JSON.parse(fs.readFileSync(electronPackageJson, 'utf8'));
const distDir = path.join(electronRoot, 'dist');
const versionFile = path.join(distDir, 'version');
const pathFile = path.join(electronRoot, 'path.txt');

function resolveBinaryPath() {
  if (!fs.existsSync(pathFile)) {
    return null;
  }

  const relativeBinaryPath = fs.readFileSync(pathFile, 'utf8').trim();
  if (!relativeBinaryPath) {
    return null;
  }

  return path.join(distDir, relativeBinaryPath);
}

function isElectronInstalled() {
  const binaryPath = resolveBinaryPath();
  if (!binaryPath || !fs.existsSync(binaryPath)) {
    return false;
  }

  if (!fs.existsSync(versionFile)) {
    return false;
  }

  const installedVersion = fs.readFileSync(versionFile, 'utf8').trim().replace(/^v/, '');
  return installedVersion === electronPkg.version;
}

if (isElectronInstalled()) {
  process.exit(0);
}

console.warn('[ensure-electron] Electron binary is missing or incomplete. Reinstalling Electron runtime.');

const installScript = path.join(electronRoot, 'install.js');
const result = spawnSync(process.execPath, [installScript], {
  cwd: projectRoot,
  stdio: 'inherit',
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

if (!isElectronInstalled()) {
  console.error('[ensure-electron] Electron install completed, but the runtime is still unavailable.');
  process.exit(1);
}

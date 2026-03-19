import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'

const electronModule = createRequire(import.meta.url)('electron') as typeof import('electron') | string

export let RECORDINGS_DIR = ''
export let VITE_DEV_SERVER_URL: string | undefined
export let MAIN_DIST = ''
export let RENDERER_DIST = ''

if (typeof electronModule !== 'string' && electronModule.app) {
const { app, BrowserWindow, Tray, Menu, nativeImage } = electronModule

const __dirname = path.dirname(fileURLToPath(import.meta.url))

RECORDINGS_DIR = path.join(app.getPath('userData'), 'recordings')


async function ensureRecordingsDir() {
  try {
    await fs.mkdir(RECORDINGS_DIR, { recursive: true })
    console.log('RECORDINGS_DIR:', RECORDINGS_DIR)
    console.log('User Data Path:', app.getPath('userData'))
  } catch (error) {
    console.error('Failed to create recordings directory:', error)
  }
}

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

// Lazy-loaded Electron windows and IPC modules
let createHudOverlayWindow: () => BrowserWindow
let createEditorWindow: () => BrowserWindow
let createSourceSelectorWindow: () => BrowserWindow
let registerIpcHandlers: (
  createEditorWindow: () => void,
  createSourceSelectorWindow: () => BrowserWindow,
  getMainWindow: () => BrowserWindow | null,
  getSourceSelectorWindow: () => BrowserWindow | null,
  onRecordingStateChange?: (recording: boolean, sourceName: string) => void
) => void

// Window references
let mainWindow: BrowserWindow | null = null
let sourceSelectorWindow: BrowserWindow | null = null
let tray: Tray | null = null
let selectedSourceName = ''
let isQuitting = false

// Tray Icons
const defaultTrayIcon = getTrayIcon('openscreen.png');
const recordingTrayIcon = getTrayIcon('rec-button.png');

function createWindow() {
  mainWindow = createHudOverlayWindow()
}

function createTray() {
  tray = new Tray(defaultTrayIcon);
}

function getTrayIcon(filename: string) {
  return nativeImage.createFromPath(path.join(process.env.VITE_PUBLIC || RENDERER_DIST, filename)).resize({
    width: 24,
    height: 24,
    quality: 'best'
  });
}


function updateTrayMenu(recording: boolean = false) {
  if (!tray) return;
  const trayIcon = recording ? recordingTrayIcon : defaultTrayIcon;
  const trayToolTip = recording ? `Recording: ${selectedSourceName}` : "OpenScreen";
  const menuTemplate = recording
    ? [
        {
          label: "Stop Recording",
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send("stop-recording-from-tray");
            }
          },
        },
      ]
    : [
        {
          label: "Open",
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.isMinimized() && mainWindow.restore();
            } else {
              createWindow();
            }
          },
        },
        {
          label: "Quit",
          click: () => {
            app.quit();
          },
        },
      ];
  tray.setImage(trayIcon);
  tray.setToolTip(trayToolTip);
  tray.setContextMenu(Menu.buildFromTemplate(menuTemplate));
}

function createEditorWindowWrapper() {
  if (mainWindow) {
    mainWindow.close()
    mainWindow = null
  }
  mainWindow = createEditorWindow()
}

function createSourceSelectorWindowWrapper() {
  sourceSelectorWindow = createSourceSelectorWindow()
  sourceSelectorWindow.on('closed', () => {
    sourceSelectorWindow = null
  })
  return sourceSelectorWindow
}

// On macOS, applications and their menu bar stay active until the user quits
// explicitly with Cmd + Q. However, in dev mode or non-macOS, quit when windows close.
app.on('window-all-closed', () => {
  // In dev mode, allow quitting when windows close (for Ctrl+C and X button)
  if (VITE_DEV_SERVER_URL) {
    app.quit()
    return
  }
  
  // On non-macOS platforms, quit when all windows are closed
  if (process.platform !== 'darwin') {
    app.quit()
  }
  // On macOS production, keep app running for tray functionality
})

app.on('before-quit', () => {
  isQuitting = true
  sourceSelectorWindow?.destroy()
  sourceSelectorWindow = null
  tray?.destroy()
  tray = null
})

app.on('browser-window-created', (_event, window) => {
  window.on('close', () => {
    if (VITE_DEV_SERVER_URL && BrowserWindow.getAllWindows().length <= 1) {
      isQuitting = true
    }
  })
})

app.on('activate', () => {
  if (isQuitting) {
    return
  }
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})



// Register all IPC handlers when app is ready
app.whenReady().then(async () => {
    const windowsModule = await import('./windows')
    const ipcModule = await import('./ipc/handlers')
    createHudOverlayWindow = windowsModule.createHudOverlayWindow
    createEditorWindow = windowsModule.createEditorWindow
    createSourceSelectorWindow = windowsModule.createSourceSelectorWindow
    registerIpcHandlers = ipcModule.registerIpcHandlers
    // Listen for HUD overlay quit event (macOS only)
    const { ipcMain } = await import('electron');
    ipcMain.on('hud-overlay-close', () => {
      app.quit();
    });
    createTray()
    updateTrayMenu()
  // Ensure recordings directory exists
  await ensureRecordingsDir()

  registerIpcHandlers(
    createEditorWindowWrapper,
    createSourceSelectorWindowWrapper,
    () => mainWindow,
    () => sourceSelectorWindow,
    (recording: boolean, sourceName: string) => {
      selectedSourceName = sourceName
      if (!tray) createTray();
      updateTrayMenu(recording);
      if (!recording) {
        if (mainWindow) mainWindow.restore();
      }
    }
  )
  createWindow()
})
}

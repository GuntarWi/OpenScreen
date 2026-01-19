import electron from 'electron'

const { contextBridge, ipcRenderer } = electron

contextBridge.exposeInMainWorld('electronAPI', {
    hudOverlayHide: () => {
      ipcRenderer.send('hud-overlay-hide');
    },
    hudOverlayClose: () => {
      ipcRenderer.send('hud-overlay-close');
    },
  getAssetBasePath: async () => {
    // ask main process for the correct base path (production vs dev)
    return await ipcRenderer.invoke('get-asset-base-path')
  },
  getSources: async (opts: Electron.SourcesOptions) => {
    return await ipcRenderer.invoke('get-sources', opts)
  },
  switchToEditor: () => {
    return ipcRenderer.invoke('switch-to-editor')
  },
  openSourceSelector: () => {
    return ipcRenderer.invoke('open-source-selector')
  },
  selectSource: (source: any) => {
    return ipcRenderer.invoke('select-source', source)
  },
  quitApp: () => {
    return ipcRenderer.invoke('quit-app')
  },
  getSelectedSource: () => {
    return ipcRenderer.invoke('get-selected-source')
  },

  storeRecordedVideo: (videoData: ArrayBuffer, fileName: string) => {
    return ipcRenderer.invoke('store-recorded-video', videoData, fileName)
  },
  storeCursorData: (videoPath: string, cursorData: any) => {
    return ipcRenderer.invoke('store-cursor-data', videoPath, cursorData)
  },
  loadCursorData: (videoPath: string) => {
    return ipcRenderer.invoke('load-cursor-data', videoPath)
  },

  getRecordedVideoPath: () => {
    return ipcRenderer.invoke('get-recorded-video-path')
  },
  setRecordingState: (recording: boolean) => {
    return ipcRenderer.invoke('set-recording-state', recording)
  },
  onStopRecordingFromTray: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('stop-recording-from-tray', listener)
    return () => ipcRenderer.removeListener('stop-recording-from-tray', listener)
  },
  onGlobalMouseMove: (callback: (event: { screenX: number; screenY: number; timestamp: number }) => void) => {
    const listener = (_: any, event: { screenX: number; screenY: number; timestamp: number }) => callback(event)
    ipcRenderer.on('global-mouse-move', listener)
    return () => ipcRenderer.removeListener('global-mouse-move', listener)
  },
  openExternalUrl: (url: string) => {
    return ipcRenderer.invoke('open-external-url', url)
  },
  saveExportedVideo: (videoData: ArrayBuffer, fileName: string) => {
    return ipcRenderer.invoke('save-exported-video', videoData, fileName)
  },
  openVideoFilePicker: () => {
    return ipcRenderer.invoke('open-video-file-picker')
  },
  openProjectFilePicker: () => {
    return ipcRenderer.invoke('open-project-file-picker')
  },
  setCurrentProjectPath: (path: string) => {
    return ipcRenderer.invoke('set-current-project-path', path)
  },
  getCurrentProjectPath: () => {
    return ipcRenderer.invoke('get-current-project-path')
  },
  clearCurrentProjectPath: () => {
    return ipcRenderer.invoke('clear-current-project-path')
  },
  setCurrentVideoPath: (path: string) => {
    return ipcRenderer.invoke('set-current-video-path', path)
  },
  getCurrentVideoPath: () => {
    return ipcRenderer.invoke('get-current-video-path')
  },
  clearCurrentVideoPath: () => {
    return ipcRenderer.invoke('clear-current-video-path')
  },
  getPlatform: () => {
    return ipcRenderer.invoke('get-platform')
  },
  getSourceBounds: () => {
    return ipcRenderer.invoke('get-source-bounds')
  },
  saveProject: (projectData: string, suggestedFileName: string) => {
    return ipcRenderer.invoke('save-project', projectData, suggestedFileName)
  },
  loadProject: (projectPath: string) => {
    return ipcRenderer.invoke('load-project', projectPath)
  },
  checkVideoFileExists: (videoPath: string) => {
    return ipcRenderer.invoke('check-video-file-exists', videoPath)
  },
})

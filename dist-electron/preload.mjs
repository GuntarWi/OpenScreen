"use strict";
const electron = require("electron");
const { contextBridge, ipcRenderer } = electron;
contextBridge.exposeInMainWorld("electronAPI", {
  hudOverlayHide: () => {
    ipcRenderer.send("hud-overlay-hide");
  },
  hudOverlayClose: () => {
    ipcRenderer.send("hud-overlay-close");
  },
  getAssetBasePath: async () => {
    return await ipcRenderer.invoke("get-asset-base-path");
  },
  getSources: async (opts) => {
    return await ipcRenderer.invoke("get-sources", opts);
  },
  switchToEditor: () => {
    return ipcRenderer.invoke("switch-to-editor");
  },
  openSourceSelector: () => {
    return ipcRenderer.invoke("open-source-selector");
  },
  selectSource: (source) => {
    return ipcRenderer.invoke("select-source", source);
  },
  quitApp: () => {
    return ipcRenderer.invoke("quit-app");
  },
  getSelectedSource: () => {
    return ipcRenderer.invoke("get-selected-source");
  },
  storeRecordedVideo: (videoData, fileName) => {
    return ipcRenderer.invoke("store-recorded-video", videoData, fileName);
  },
  storeCursorData: (videoPath, cursorData) => {
    return ipcRenderer.invoke("store-cursor-data", videoPath, cursorData);
  },
  loadCursorData: (videoPath) => {
    return ipcRenderer.invoke("load-cursor-data", videoPath);
  },
  getRecordedVideoPath: () => {
    return ipcRenderer.invoke("get-recorded-video-path");
  },
  setRecordingState: (recording) => {
    return ipcRenderer.invoke("set-recording-state", recording);
  },
  onStopRecordingFromTray: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("stop-recording-from-tray", listener);
    return () => ipcRenderer.removeListener("stop-recording-from-tray", listener);
  },
  onGlobalMouseMove: (callback) => {
    const listener = (_, event) => callback(event);
    ipcRenderer.on("global-mouse-move", listener);
    return () => ipcRenderer.removeListener("global-mouse-move", listener);
  },
  openExternalUrl: (url) => {
    return ipcRenderer.invoke("open-external-url", url);
  },
  saveExportedVideo: (videoData, fileName) => {
    return ipcRenderer.invoke("save-exported-video", videoData, fileName);
  },
  openVideoFilePicker: () => {
    return ipcRenderer.invoke("open-video-file-picker");
  },
  setCurrentVideoPath: (path) => {
    return ipcRenderer.invoke("set-current-video-path", path);
  },
  getCurrentVideoPath: () => {
    return ipcRenderer.invoke("get-current-video-path");
  },
  clearCurrentVideoPath: () => {
    return ipcRenderer.invoke("clear-current-video-path");
  },
  getPlatform: () => {
    return ipcRenderer.invoke("get-platform");
  },
  getSourceBounds: () => {
    return ipcRenderer.invoke("get-source-bounds");
  },
  saveProject: (projectData, suggestedFileName) => {
    return ipcRenderer.invoke("save-project", projectData, suggestedFileName);
  },
  loadProject: (projectPath) => {
    return ipcRenderer.invoke("load-project", projectPath);
  },
  openProjectFilePicker: () => {
    return ipcRenderer.invoke("open-project-file-picker");
  },
  checkVideoFileExists: (videoPath) => {
    return ipcRenderer.invoke("check-video-file-exists", videoPath);
  }
});

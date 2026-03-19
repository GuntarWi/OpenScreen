import electron from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { RECORDINGS_DIR } from "./main.js";
const { ipcMain, desktopCapturer, BrowserWindow, shell, app, dialog, screen } = electron;
let selectedSource = null;
let globalMouseListenerInterval = null;
let recordingWindow = null;
let lastMousePosition = null;
function registerIpcHandlers(createEditorWindow, createSourceSelectorWindow, getMainWindow, getSourceSelectorWindow, onRecordingStateChange) {
  ipcMain.handle("get-sources", async (_, opts) => {
    const sources = await desktopCapturer.getSources(opts);
    return sources.map((source) => ({
      id: source.id,
      name: source.name,
      display_id: source.display_id,
      thumbnail: source.thumbnail ? source.thumbnail.toDataURL() : null,
      appIcon: source.appIcon ? source.appIcon.toDataURL() : null
    }));
  });
  ipcMain.handle("select-source", (_, source) => {
    selectedSource = source;
    const sourceSelectorWin = getSourceSelectorWindow();
    if (sourceSelectorWin) {
      sourceSelectorWin.close();
    }
    return selectedSource;
  });
  ipcMain.handle("get-selected-source", () => {
    return selectedSource;
  });
  ipcMain.handle("open-source-selector", () => {
    const sourceSelectorWin = getSourceSelectorWindow();
    if (sourceSelectorWin) {
      sourceSelectorWin.focus();
      return;
    }
    createSourceSelectorWindow();
  });
  ipcMain.handle("quit-app", () => {
    app.quit();
    return { success: true };
  });
  ipcMain.handle("switch-to-editor", () => {
    const mainWin = getMainWindow();
    if (mainWin) {
      mainWin.close();
    }
    createEditorWindow();
  });
  ipcMain.handle("store-recorded-video", async (_, videoData, fileName) => {
    try {
      const videoPath = path.join(RECORDINGS_DIR, fileName);
      await fs.writeFile(videoPath, Buffer.from(videoData));
      currentVideoPath = videoPath;
      return {
        success: true,
        path: videoPath,
        message: "Video stored successfully"
      };
    } catch (error) {
      console.error("Failed to store video:", error);
      return {
        success: false,
        message: "Failed to store video",
        error: String(error)
      };
    }
  });
  ipcMain.handle("store-cursor-data", async (_, videoPath, cursorData) => {
    try {
      const cursorPath = `${videoPath}.cursor.json`;
      const payload = JSON.stringify(cursorData);
      await fs.writeFile(cursorPath, payload, "utf-8");
      return { success: true, path: cursorPath };
    } catch (error) {
      console.error("Failed to store cursor data:", error);
      return { success: false, message: "Failed to store cursor data", error: String(error) };
    }
  });
  ipcMain.handle("load-cursor-data", async (_, videoPath) => {
    try {
      const cursorPath = `${videoPath}.cursor.json`;
      const data = await fs.readFile(cursorPath, "utf-8");
      return { success: true, path: cursorPath, data };
    } catch (error) {
      return { success: false, message: "Cursor data not found", error: String(error) };
    }
  });
  ipcMain.handle("save-project", async (_, projectData, suggestedFileName) => {
    try {
      const mainWindow = getMainWindow();
      const result = await dialog.showSaveDialog(
        mainWindow || void 0,
        {
          title: "Save OpenScreen Project",
          defaultPath: path.join(app.getPath("documents"), suggestedFileName),
          filters: [
            { name: "OpenScreen Project", extensions: ["openscreen"] }
          ],
          properties: ["createDirectory", "showOverwriteConfirmation"]
        }
      );
      if (result.canceled || !result.filePath) {
        return { success: false, cancelled: true, message: "Save cancelled" };
      }
      await fs.writeFile(result.filePath, projectData, "utf-8");
      return {
        success: true,
        path: result.filePath,
        message: "Project saved successfully"
      };
    } catch (error) {
      console.error("Failed to save project:", error);
      return {
        success: false,
        message: "Failed to save project",
        error: String(error)
      };
    }
  });
  ipcMain.handle("load-project", async (_, projectPath) => {
    try {
      const data = await fs.readFile(projectPath, "utf-8");
      return { success: true, path: projectPath, data };
    } catch (error) {
      console.error("Failed to load project:", error);
      return {
        success: false,
        message: "Failed to load project file",
        error: String(error)
      };
    }
  });
  ipcMain.handle("open-project-file-picker", async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: "Open OpenScreen Project",
        defaultPath: app.getPath("documents"),
        filters: [
          { name: "OpenScreen Project", extensions: ["openscreen"] },
          { name: "All Files", extensions: ["*"] }
        ],
        properties: ["openFile"]
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, cancelled: true };
      }
      return {
        success: true,
        path: result.filePaths[0]
      };
    } catch (error) {
      console.error("Failed to open project picker:", error);
      return {
        success: false,
        message: "Failed to open project picker",
        error: String(error)
      };
    }
  });
  ipcMain.handle("check-video-file-exists", async (_, videoPath) => {
    try {
      await fs.access(videoPath);
      return { success: true, exists: true };
    } catch (error) {
      return { success: true, exists: false };
    }
  });
  ipcMain.handle("get-recorded-video-path", async () => {
    try {
      const files = await fs.readdir(RECORDINGS_DIR);
      const videoFiles = files.filter((file) => file.endsWith(".webm"));
      if (videoFiles.length === 0) {
        return { success: false, message: "No recorded video found" };
      }
      const latestVideo = videoFiles.sort().reverse()[0];
      const videoPath = path.join(RECORDINGS_DIR, latestVideo);
      return { success: true, path: videoPath };
    } catch (error) {
      console.error("Failed to get video path:", error);
      return { success: false, message: "Failed to get video path", error: String(error) };
    }
  });
  ipcMain.handle("set-recording-state", (_, recording) => {
    const source = selectedSource || { name: "Screen" };
    if (onRecordingStateChange) {
      onRecordingStateChange(recording, source.name);
    }
    if (recording) {
      startGlobalMouseListener(getMainWindow());
    } else {
      stopGlobalMouseListener();
    }
  });
  function startGlobalMouseListener(window) {
    if (globalMouseListenerInterval) {
      return;
    }
    recordingWindow = window;
    lastMousePosition = null;
    globalMouseListenerInterval = setInterval(() => {
      const targetWindow = recordingWindow || getMainWindow();
      if (!targetWindow || targetWindow.isDestroyed()) {
        const allWindows = BrowserWindow.getAllWindows();
        if (allWindows.length === 0) {
          stopGlobalMouseListener();
          return;
        }
        recordingWindow = allWindows[0];
      }
      try {
        const point = screen.getCursorScreenPoint();
        const currentPosition = { x: point.x, y: point.y };
        if (!lastMousePosition || lastMousePosition.x !== currentPosition.x || lastMousePosition.y !== currentPosition.y) {
          const windows = BrowserWindow.getAllWindows();
          windows.forEach((win) => {
            if (!win.isDestroyed()) {
              win.webContents.send("global-mouse-move", {
                screenX: currentPosition.x,
                screenY: currentPosition.y,
                timestamp: Date.now()
              });
            }
          });
          lastMousePosition = currentPosition;
        }
      } catch (error) {
        console.error("Error in global mouse listener:", error);
      }
    }, 1e3 / 60);
  }
  function stopGlobalMouseListener() {
    if (globalMouseListenerInterval) {
      clearInterval(globalMouseListenerInterval);
      globalMouseListenerInterval = null;
    }
    recordingWindow = null;
    lastMousePosition = null;
  }
  ipcMain.handle("open-external-url", async (_, url) => {
    try {
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      console.error("Failed to open URL:", error);
      return { success: false, error: String(error) };
    }
  });
  ipcMain.handle("get-asset-base-path", () => {
    try {
      if (app.isPackaged) {
        return path.join(process.resourcesPath, "assets");
      }
      return path.join(app.getAppPath(), "public", "assets");
    } catch (err) {
      console.error("Failed to resolve asset base path:", err);
      return null;
    }
  });
  ipcMain.handle("save-exported-video", async (_, videoData, fileName) => {
    try {
      const mainWindow = getMainWindow();
      const result = await dialog.showSaveDialog(
        mainWindow || void 0,
        {
          title: "Save Exported Video",
          defaultPath: path.join(app.getPath("downloads"), fileName),
          filters: [
            { name: "MP4 Video", extensions: ["mp4"] }
          ],
          properties: ["createDirectory", "showOverwriteConfirmation"]
        }
      );
      if (result.canceled || !result.filePath) {
        return {
          success: false,
          cancelled: true,
          message: "Export cancelled"
        };
      }
      await fs.writeFile(result.filePath, Buffer.from(videoData));
      return {
        success: true,
        path: result.filePath,
        message: "Video exported successfully"
      };
    } catch (error) {
      console.error("Failed to save exported video:", error);
      return {
        success: false,
        message: "Failed to save exported video",
        error: String(error)
      };
    }
  });
  ipcMain.handle("open-video-file-picker", async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: "Select Media File",
        defaultPath: RECORDINGS_DIR,
        filters: [
          { name: "Media Files", extensions: ["webm", "mp4", "mov", "avi", "mkv", "mp3", "wav", "m4a", "aac", "ogg", "flac", "opus"] },
          { name: "All Files", extensions: ["*"] }
        ],
        properties: ["openFile"]
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, cancelled: true };
      }
      return {
        success: true,
        path: result.filePaths[0]
      };
    } catch (error) {
      console.error("Failed to open file picker:", error);
      return {
        success: false,
        message: "Failed to open file picker",
        error: String(error)
      };
    }
  });
  ipcMain.handle("open-video-files-picker", async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: "Select Media Files",
        defaultPath: RECORDINGS_DIR,
        filters: [
          { name: "Media Files", extensions: ["webm", "mp4", "mov", "avi", "mkv", "mp3", "wav", "m4a", "aac", "ogg", "flac", "opus"] },
          { name: "All Files", extensions: ["*"] }
        ],
        properties: ["openFile", "multiSelections"]
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, cancelled: true };
      }
      return {
        success: true,
        paths: result.filePaths
      };
    } catch (error) {
      console.error("Failed to open files picker:", error);
      return {
        success: false,
        message: "Failed to open files picker",
        error: String(error)
      };
    }
  });
  let currentVideoPath = null;
  let currentProjectPath = null;
  ipcMain.handle("set-current-video-path", (_, path2) => {
    currentVideoPath = path2;
    return { success: true };
  });
  ipcMain.handle("get-current-video-path", () => {
    return currentVideoPath ? { success: true, path: currentVideoPath } : { success: false };
  });
  ipcMain.handle("clear-current-video-path", () => {
    currentVideoPath = null;
    return { success: true };
  });
  ipcMain.handle("set-current-project-path", (_, path2) => {
    currentProjectPath = path2;
    return { success: true };
  });
  ipcMain.handle("get-current-project-path", () => {
    return currentProjectPath ? { success: true, path: currentProjectPath } : { success: false };
  });
  ipcMain.handle("clear-current-project-path", () => {
    currentProjectPath = null;
    return { success: true };
  });
  ipcMain.handle("get-platform", () => {
    return process.platform;
  });
  ipcMain.handle("get-source-bounds", async () => {
    try {
      if (!selectedSource) {
        return { success: false, message: "No source selected" };
      }
      const sourceId = selectedSource.id;
      if (sourceId.startsWith("screen:")) {
        const displays = screen.getAllDisplays();
        const displayId = selectedSource.display_id;
        const display = displays.find((d) => String(d.id) === String(displayId)) || screen.getPrimaryDisplay();
        return {
          success: true,
          bounds: {
            x: display.bounds.x,
            y: display.bounds.y,
            width: display.bounds.width,
            height: display.bounds.height
          },
          scaleFactor: display.scaleFactor || 1
        };
      }
      if (sourceId.startsWith("window:")) {
        const displays = screen.getAllDisplays();
        const displayId = selectedSource.display_id;
        const display = displays.find((d) => String(d.id) === String(displayId)) || screen.getPrimaryDisplay();
        return {
          success: true,
          bounds: {
            x: display.bounds.x,
            y: display.bounds.y,
            width: display.bounds.width,
            height: display.bounds.height
          },
          scaleFactor: display.scaleFactor || 1
        };
      }
      const primaryDisplay = screen.getPrimaryDisplay();
      return {
        success: true,
        bounds: {
          x: primaryDisplay.bounds.x,
          y: primaryDisplay.bounds.y,
          width: primaryDisplay.bounds.width,
          height: primaryDisplay.bounds.height
        },
        scaleFactor: primaryDisplay.scaleFactor || 1
      };
    } catch (error) {
      console.error("Failed to get source bounds:", error);
      return {
        success: false,
        message: "Failed to get source bounds",
        error: String(error)
      };
    }
  });
}
export {
  registerIpcHandlers
};

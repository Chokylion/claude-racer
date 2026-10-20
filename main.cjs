// main.cjs — Electron main process for Claude Racer.
// Frameless game window, centered, fixed size. Persists garage/upgrades to disk.
const { app, BrowserWindow, ipcMain, screen } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

let win = null;
const SAVE = path.join(os.homedir(), ".claude", "racer-save.json");

function readSave() {
  try { return JSON.parse(fs.readFileSync(SAVE, "utf8")); } catch { return null; }
}
function writeSave(obj) {
  try { fs.writeFileSync(SAVE, JSON.stringify(obj, null, 2)); return true; } catch { return false; }
}

function createWindow() {
  const W = 940, H = 660;
  const wa = screen.getPrimaryDisplay().workArea;
  win = new BrowserWindow({
    width: W, height: H,
    minWidth: 820, minHeight: 560,
    x: wa.x + Math.floor((wa.width - W) / 2),
    y: wa.y + Math.floor((wa.height - H) / 2),
    frame: false,
    resizable: true,
    maximizable: true,
    backgroundColor: "#0a0a0c",
    title: "Claude Racer",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.loadFile("index.html");
  win.once("ready-to-show", () => win.show());
  // notify renderer when fullscreen state changes (to swap the button glyph)
  const sendFS = () => win.webContents.send("racer:fs", win.isFullScreen());
  win.on("enter-full-screen", sendFS);
  win.on("leave-full-screen", sendFS);
}

ipcMain.handle("racer:load", () => readSave());
ipcMain.handle("racer:save", (_e, data) => writeSave(data));
ipcMain.on("racer:close", () => app.quit());
ipcMain.on("racer:minimize", () => win && win.minimize());
ipcMain.handle("racer:toggleFullscreen", () => {
  if (!win) return false;
  const next = !win.isFullScreen();
  win.setFullScreen(next);
  return next;
});

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

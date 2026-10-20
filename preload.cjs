const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("racer", {
  load:     () => ipcRenderer.invoke("racer:load"),
  save:     (data) => ipcRenderer.invoke("racer:save", data),
  close:    () => ipcRenderer.send("racer:close"),
  minimize: () => ipcRenderer.send("racer:minimize"),
  toggleFullscreen: () => ipcRenderer.invoke("racer:toggleFullscreen"),
  onFullscreen: (cb) => ipcRenderer.on("racer:fs", (_e, v) => cb(v)),
});

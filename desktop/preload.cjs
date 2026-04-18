const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("turnosDesktop", {
  platform: process.platform,
});

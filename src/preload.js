// 安全桥：向渲染层暴露最小 API 面
const { contextBridge, ipcRenderer } = require('electron')

const EVENTS = ['data:changed', 'timer:state', 'alarm:fired', 'notify', 'theme:changed', 'win:maximized']

const api = {
  platform: process.platform,
  window: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('win:toggleMaximize'),
    close: () => ipcRenderer.invoke('win:close'),
    show: () => ipcRenderer.invoke('win:show'),
    isMaximized: () => ipcRenderer.invoke('win:isMaximized'),
  },
  data: {
    getAll: (col) => ipcRenderer.invoke('data:getAll', col),
    upsert: (col, item) => ipcRenderer.invoke('data:upsert', col, item),
    remove: (col, id) => ipcRenderer.invoke('data:remove', col, id),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
  },
  timer: {
    state: () => ipcRenderer.invoke('timer:state'),
    control: (action, arg) => ipcRenderer.invoke('timer:control', action, arg),
  },
  alarm: {
    snooze: (id, min) => ipcRenderer.invoke('alarm:snooze', id, min),
  },
  app: {
    getAutostart: () => ipcRenderer.invoke('app:autostart:get'),
    setAutostart: (v) => ipcRenderer.invoke('app:autostart:set', v),
    openDataFolder: () => ipcRenderer.invoke('app:openDataFolder'),
    themeState: () => ipcRenderer.invoke('theme:state'),
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
  },
  mini: {
    toggle: () => ipcRenderer.invoke('mini:toggle'),
  },
  on(channel, cb) {
    if (!EVENTS.includes(channel)) throw new Error('事件不在白名单: ' + channel)
    const handler = (_e, payload) => cb(payload)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.off(channel, handler)
  },
}

contextBridge.exposeInMainWorld('timeAPI', api)

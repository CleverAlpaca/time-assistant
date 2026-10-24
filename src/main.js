// 时光助手 · 主进程：窗口 / 托盘 / 计时引擎 / 闹钟调度 / IPC
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  Notification,
  ipcMain,
  nativeTheme,
  powerMonitor,
  shell,
  nativeImage,
} = require('electron')
const path = require('path')
const { Store } = require('./lib/store')
const { TimerEngine } = require('./lib/timer')
const { AlarmScheduler } = require('./lib/alarms')

let mainWindow = null
let miniWindow = null
let tray = null
let quitting = false
let store = null
let engine = null
let scheduler = null

const ICON = path.join(__dirname, '..', 'assets', 'icon.png')
const TRAY_ICON = path.join(__dirname, '..', 'assets', 'tray.png') // 32px 托盘/通知专用，16px 下仍清晰

// ---- 广播到所有窗口 ----
const allWindows = () => [mainWindow, miniWindow].filter(Boolean)
function broadcast(channel, payload) {
  for (const w of allWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

// ---- 主题 ----
function effectiveTheme() {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
}
function broadcastTheme() {
  broadcast('theme:changed', { source: store.getSettings().theme, effective: effectiveTheme() })
}
function applyThemeSetting(source) {
  nativeTheme.themeSource = source // 'system' | 'light' | 'dark'
  broadcastTheme()
}

// ---- 窗口 ----
function createMainWindow() {
  const s = store.getSettings()
  const bounds = s.windowBounds || { width: 980, height: 680 }
  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 880,
    minHeight: 600,
    frame: false,
    transparent: true, // 配合 CSS 圆角：Win10 无系统级窗口圆角
    thickFrame: false, // 去掉 WS_THICKFRAME 遗留的 1px 浅色直角边框（代价：不能拖边缘缩放）
    icon: ICON, // 开发模式下任务栏显示应用图标（打包版用 exe 内嵌图标）
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  mainWindow.once('ready-to-show', () => mainWindow.show())
  if (s.windowMaximized) mainWindow.maximize()

  // 最大化状态同步给渲染层（圆角窗口在最大化时还原直角）
  const sendMaxState = () => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('win:maximized', mainWindow.isMaximized())
  }
  mainWindow.on('maximize', sendMaxState)
  mainWindow.on('unmaximize', sendMaxState)

  // 透明窗口在 Win10 最小化后任务栏图标会变空白（Chromium 缺陷），
  // 默认改为最小化进托盘。不阻止默认行为再事后 hide ——
  // 这样任务栏点击 / Win+D / 应用按钮等所有最小化路径都能覆盖
  // 透明窗口在 Win10 最小化后任务栏图标会变空白（Chromium 缺陷），
  // 默认改为最小化进托盘。不阻止默认行为、事后兜底 ——
  // 覆盖应用按钮 / 任务栏点击 / Win+D 等所有最小化路径。
  // 注意：Win10 下对已最小化的窗口 hide() 不生效，须先 restore 再 hide
  mainWindow.on('minimize', () => {
    if (store.getSettings().minimizeToTray) {
      setTimeout(() => {
        if (mainWindow.isDestroyed()) return
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.hide()
      }, 60)
    }
  })

  mainWindow.on('close', (e) => {
    const max = mainWindow.isMaximized()
    store.setSettings({ windowBounds: mainWindow.getNormalBounds(), windowMaximized: max })
    if (!quitting && store.getSettings().closeAction === 'tray') {
      e.preventDefault()
      mainWindow.hide()
    }
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function createMiniWindow() {
  if (miniWindow) return miniWindow
  miniWindow = new BrowserWindow({
    width: 236,
    height: 128,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  miniWindow.loadFile(path.join(__dirname, 'renderer', 'mini.html'))
  miniWindow.once('ready-to-show', () => miniWindow.show())
  miniWindow.on('closed', () => {
    miniWindow = null
  })
  return miniWindow
}

function syncMiniWindow() {
  const enabled = store.getSettings().miniWindow
  if (enabled) createMiniWindow().show()
  else if (miniWindow) miniWindow.close()
}

function showMainWindow() {
  if (!mainWindow) createMainWindow()
  if (mainWindow.isMinimized()) mainWindow.restore() // 隐藏前可能处于最小化状态
  mainWindow.show()
  mainWindow.focus()
}

// ---- 托盘 ----
function trayLabel() {
  const st = engine.snapshot()
  if (!st.running) return st.mode === 'stopwatch' && st.elapsedMs > 0 ? '时光助手 — 暂停' : '时光助手'
  const name = st.mode === 'pomodoro' ? (st.phase === 'focus' ? '专注' : '休息') : st.mode === 'countdown' ? '倒计时' : '正计时'
  const sec = Math.floor((st.mode === 'stopwatch' ? st.elapsedMs : st.remainingMs) / 1000)
  const mm = String(Math.floor(sec / 60)).padStart(2, '0')
  const ss = String(sec % 60).padStart(2, '0')
  return `时光助手 — ${name} ${mm}:${ss}`
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(TRAY_ICON))
  tray.setToolTip('时光助手')
  tray.on('click', () => showMainWindow())
  tray.on('double-click', () => showMainWindow())
  rebuildTrayMenu()
}

function rebuildTrayMenu() {
  const st = engine.snapshot()
  const focusish = st.mode !== 'stopwatch' || st.elapsedMs > 0
  const menu = Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => showMainWindow() },
    { type: 'separator' },
    {
      label: st.running ? '暂停' : '开始专注',
      enabled: focusish || !st.running,
      click: () => {
        if (st.mode !== 'pomodoro') engine.control('mode', 'pomodoro')
        engine.control(st.running ? 'pause' : 'start')
      },
    },
    { label: '重置', click: () => engine.control('reset') },
    {
      label: '悬浮计时窗',
      type: 'checkbox',
      checked: store.getSettings().miniWindow,
      click: (item) => store.setSettings({ miniWindow: item.checked }),
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        quitting = true
        app.quit()
      },
    },
  ])
  tray.setContextMenu(menu)
}

function updateTrayTooltip() {
  if (!tray) return
  tray.setToolTip(trayLabel())
}

// ---- 通知 ----
function showNotification(title, body) {
  if (!Notification.isSupported()) return
  const n = new Notification({ title, body, icon: nativeImage.createFromPath(TRAY_ICON) })
  n.on('click', () => showMainWindow())
  n.show()
}

// ---- 应用生命周期 ----
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showMainWindow())

  app.whenReady().then(() => {
    app.setAppUserModelId('com.local.time-assistant')
    store = new Store(app.getPath('userData'))
    store.onChange = (col) => {
      broadcast('data:changed', { collection: col })
      if (col === 'settings') syncMiniWindow()
    }

    applyThemeSetting(store.getSettings().theme === 'dark' ? 'dark' : store.getSettings().theme === 'light' ? 'light' : 'system')

    engine = new TimerEngine({
      getSettings: () => store.getSettings(),
      onSession: (s) => store.upsert('sessions', s),
      onNotify: ({ title, body }) => {
        showNotification(title, body)
        broadcast('notify', { title, body, kind: 'timer' })
      },
      onStateChange: (st) => {
        broadcast('timer:state', st)
        updateTrayTooltip()
      },
    })

    scheduler = new AlarmScheduler({
      getAlarms: () => store.get('alarms'),
      saveAlarm: (a) => store.upsert('alarms', a),
      onFire: ({ alarm, snoozed }) => {
        const prefix = alarm.type === 'todo' ? '📌 待办提醒' : alarm.type === 'event' ? '📅 日程提醒' : '⏰ 闹钟'
        showNotification(prefix, alarm.title)
        broadcast('alarm:fired', { alarm, snoozed })
      },
    })

    createMainWindow()
    createTray()
    if (store.getSettings().miniWindow) createMiniWindow()

    setInterval(() => engine.tick(), 250)
    setInterval(() => scheduler.tick(), 1000)
    engine.onStateChange(engine.snapshot())

    powerMonitor.on('resume', () => scheduler.tick())
    nativeTheme.on('updated', broadcastTheme)

    registerIpc()
  })
}

function registerIpc() {
  // 窗口控制（自定义红绿灯窗控）
  ipcMain.handle('win:minimize', () => mainWindow?.minimize())
  ipcMain.handle('win:toggleMaximize', () => {
    if (!mainWindow) return
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
  })
  ipcMain.handle('win:close', () => mainWindow?.close())
  ipcMain.handle('win:show', () => showMainWindow())
  ipcMain.handle('win:isMaximized', () => mainWindow?.isMaximized() ?? false)

  // 数据 CRUD
  ipcMain.handle('data:getAll', (_e, col) => store.get(col))
  ipcMain.handle('data:upsert', (_e, col, item) => store.upsert(col, item))
  ipcMain.handle('data:remove', (_e, col, id) => store.remove(col, id))

  // 设置
  ipcMain.handle('settings:get', () => store.getSettings())
  ipcMain.handle('settings:set', (_e, patch) => {
    const s = store.setSettings(patch)
    if (patch.theme !== undefined) {
      applyThemeSetting(patch.theme === 'dark' ? 'dark' : patch.theme === 'light' ? 'light' : 'system')
    }
    return s
  })

  // 计时
  ipcMain.handle('timer:state', () => engine.snapshot())
  ipcMain.handle('timer:control', (_e, action, arg) => {
    engine.control(action, arg)
    rebuildTrayMenu()
    return engine.snapshot()
  })

  // 闹钟
  ipcMain.handle('alarm:snooze', (_e, id, min) => scheduler.snooze(id, min))

  // 应用
  ipcMain.handle('app:autostart:get', () => app.getLoginItemSettings().openAtLogin)
  ipcMain.handle('app:autostart:set', (_e, enabled) => {
    app.setLoginItemSettings({ openAtLogin: !!enabled })
    return app.getLoginItemSettings().openAtLogin
  })
  ipcMain.handle('app:openDataFolder', () => shell.openPath(store.dir))
  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.handle('theme:state', () => ({ source: store.getSettings().theme, effective: effectiveTheme() }))
  ipcMain.handle('mini:toggle', () => {
    store.setSettings({ miniWindow: !store.getSettings().miniWindow })
    rebuildTrayMenu()
  })
}

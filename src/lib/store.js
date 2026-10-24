// JSON 数据层：五个集合（alarms/todos/events/sessions 为数组，settings 为单文档）
// 主进程独占写入（临时文件 + rename 原子落盘），渲染层经 IPC 访问
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const COLLECTIONS = ['alarms', 'todos', 'events', 'sessions']

const DEFAULT_SETTINGS = {
  focusMin: 25,
  shortBreakMin: 5,
  longBreakMin: 15,
  cyclesBeforeLong: 4,
  autoStartBreak: true,
  autoStartNextFocus: false,
  soundEnabled: true,
  closeAction: 'tray', // 'tray' | 'quit'
  minimizeToTray: true, // 最小化隐藏到托盘（绕开 Win10 透明窗口最小化后任务栏图标空白的缺陷）
  theme: 'light', // 'light' | 'dark' | 'auto'（默认浅色玻璃，贴合参考图）
  miniWindow: false,
  windowBounds: null,
  windowMaximized: false,
}

class Store {
  constructor(dir) {
    this.dir = dir
    this.data = { settings: { ...DEFAULT_SETTINGS } }
    for (const c of COLLECTIONS) this.data[c] = []
    this.onChange = null // (collection) => void
    this.loadAll()
  }

  file(col) {
    return path.join(this.dir, col + '.json')
  }

  loadAll() {
    fs.mkdirSync(this.dir, { recursive: true })
    for (const col of [...COLLECTIONS, 'settings']) {
      try {
        const raw = fs.readFileSync(this.file(col), 'utf8')
        const parsed = JSON.parse(raw)
        if (col === 'settings') this.data.settings = { ...DEFAULT_SETTINGS, ...parsed }
        else if (Array.isArray(parsed)) this.data[col] = parsed
      } catch {
        /* 首次运行或文件损坏，保留默认值 */
      }
    }
  }

  save(col) {
    const tmp = this.file(col) + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(this.data[col], null, 2), 'utf8')
    fs.renameSync(tmp, this.file(col))
  }

  get(col) {
    return this.data[col]
  }

  getSettings() {
    return this.data.settings
  }

  setSettings(patch) {
    Object.assign(this.data.settings, patch)
    this.save('settings')
    this.emit('settings')
    return this.data.settings
  }

  upsert(col, item) {
    if (!COLLECTIONS.includes(col)) throw new Error('unknown collection: ' + col)
    const list = this.data[col]
    if (!item.id) item.id = crypto.randomUUID()
    const i = list.findIndex((x) => x.id === item.id)
    if (i >= 0) list[i] = item
    else list.push(item)
    this.save(col)
    this.emit(col)
    return item
  }

  remove(col, id) {
    if (!COLLECTIONS.includes(col)) throw new Error('unknown collection: ' + col)
    this.data[col] = this.data[col].filter((x) => x.id !== id)
    this.save(col)
    this.emit(col)
  }

  emit(col) {
    if (this.onChange) this.onChange(col)
  }
}

module.exports = { Store, COLLECTIONS, DEFAULT_SETTINGS }

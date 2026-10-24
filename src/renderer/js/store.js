// 数据层 + 全局命名空间（本文件在所有渲染脚本中最先加载）
// App.pages 由各页面文件注册，App 的助手方法由 app.js 补充
window.App = { pages: {} }
window.Data = {
  alarms: [],
  todos: [],
  events: [],
  sessions: [],
  settings: {},
  _subs: new Map(),
  _pendingEmit: null,
  _emitTimer: null,

  async init() {
    const cols = ['alarms', 'todos', 'events', 'sessions']
    const loaded = await Promise.all(cols.map((c) => timeAPI.data.getAll(c)))
    cols.forEach((c, i) => (this[c] = loaded[i]))
    this.settings = await timeAPI.settings.get()
    timeAPI.on('data:changed', ({ collection }) => this.reload(collection))
  },

  async reload(col) {
    if (col === 'settings') this.settings = await timeAPI.settings.get()
    else if (['alarms', 'todos', 'events', 'sessions'].includes(col)) {
      this[col] = await timeAPI.data.getAll(col)
    } else return
    this._emit(col)
  },

  // 合并 30ms 内的多次变更再通知，联动写入（如待办+关联闹钟）只触发一次重渲染
  _emit(col) {
    if (this._emitTimer) {
      this._pendingEmit.add(col)
      return
    }
    this._pendingEmit = new Set([col])
    this._emitTimer = setTimeout(() => {
      this._emitTimer = null
      const cols = this._pendingEmit
      for (const c of cols) (this._subs.get(c) || []).forEach((cb) => cb())
      ;(this._subs.get('*') || []).forEach((cb) => cb())
    }, 30)
  },

  on(col, cb) {
    if (!this._subs.has(col)) this._subs.set(col, new Set())
    this._subs.get(col).add(cb)
    return () => this._subs.get(col).delete(cb)
  },

  save(col, item) {
    return timeAPI.data.upsert(col, item)
  },

  remove(col, id) {
    return timeAPI.data.remove(col, id)
  },

  async setSettings(patch) {
    this.settings = await timeAPI.settings.set(patch)
    return this.settings
  },
}

// ---- 本地日期工具（一律本地时区，日期键 'YYYY-MM-DD'，时间 'HH:MM'）----
window.DU = {
  pad: (n) => String(n).padStart(2, '0'),
  dateKey(d) {
    return `${d.getFullYear()}-${DU.pad(d.getMonth() + 1)}-${DU.pad(d.getDate())}`
  },
  fromKey(key) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || '')
    if (!m) return null
    const d = new Date(+m[1], +m[2] - 1, +m[3])
    return isNaN(d) ? null : d
  },
  parseDT(dateKey, time) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(time || '')
    if (!m) return null
    const d = DU.fromKey(dateKey)
    if (!d) return null
    d.setHours(+m[1], +m[2], 0, 0)
    return d
  },
  startOfDay(d) {
    const x = new Date(d)
    x.setHours(0, 0, 0, 0)
    return x
  },
  addDays(d, n) {
    const x = new Date(d)
    x.setDate(x.getDate() + n)
    return x
  },
  isoWeekday(d) {
    return d.getDay() === 0 ? 7 : d.getDay()
  },
  weekdayCN: ['一', '二', '三', '四', '五', '六', '日'],
  fmtCN(key) {
    const d = DU.fromKey(key)
    return d ? `${d.getMonth() + 1}月${d.getDate()}日` : ''
  },
}

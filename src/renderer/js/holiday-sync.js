// 法定节假日在线同步（渲染层侧）：
// 网络与缓存都在主进程（src/lib/holidays.js，CSP 不放开外联），这里只负责
// 把拉到的年份注入 Lunar 并告知调用方是否需要重渲染。
;(function () {
  const applied = new Set() // 本会话已注入的年份，避免重复 IPC 与重复渲染

  /** 确保某年节假日可用。返回 Promise<boolean>：true = 本次拉到了新数据（调用方应重渲染） */
  async function ensureYear(year) {
    year = Math.floor(+year)
    if (!Number.isInteger(year) || applied.has(year) || !window.timeAPI || !window.Lunar) return false
    try {
      const data = await window.timeAPI.holiday.getYear(year)
      if (!data || applied.has(year)) return false
      if (!window.Lunar.setDynamicHolidays(year, data)) return false
      applied.add(year)
      return true
    } catch {
      return false
    }
  }

  window.HolidaySync = { ensureYear }
})()

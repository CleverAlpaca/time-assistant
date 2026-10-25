// 法定节假日在线同步（主进程）：
// 官方放假安排由国务院办公厅逐年公布、无法用公式推算，静态表（lunar.js，人工核对）
// 只覆盖已核实的年份；后续年份经本模块从 holiday-cn 在线补齐。
// 数据源：NateScarlet/holiday-cn（社区 CI 机器人解析国务院通知，发布后数小时内更新）：
//   1) jsdelivr CDN —— 国内网络可达性好
//   2) api.github.com contents API —— CDN 被墙时的备用通道（与 1 同一份仓库数据）
// 缓存：数据目录下 holidays-cache.json（临时文件 + rename 原子落盘，同 Store）。
//   years: 已发布数据（7 天内直接用）；miss: 未发布/失败的年份（24 小时内不重复请求，
//   官方一般 11 月底公布次年安排——公布后最迟次日起自动生效）。
const fs = require('fs')
const path = require('path')

const FRESH_MS = 7 * 24 * 3600 * 1000
const MISS_MS = 24 * 3600 * 1000
const TIMEOUT_MS = 10_000

// 解析 holiday-cn 原始格式：{ year, days: [{ name, date: 'YYYY-MM-DD', isOffDay }] }
// days 含官方连休跨度内的全部日期（含自然周末）与调休补班日，与静态表口径一致
function parseHolidayCN(json, year) {
  if (!json || json.year !== year || !Array.isArray(json.days)) return null
  return collect(json.days.map((d) => [d && d.date, d && d.isOffDay === true]), year)
}

// api.github.com contents 接口把文件包成 { encoding: 'base64', content }
function parseGithubContents(json, year) {
  if (!json || json.encoding !== 'base64' || typeof json.content !== 'string') return null
  let raw
  try {
    raw = JSON.parse(Buffer.from(json.content, 'base64').toString('utf8'))
  } catch {
    return null
  }
  return parseHolidayCN(raw, year)
}

const SOURCES = [
  { url: (y) => `https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${y}.json`, parse: parseHolidayCN },
  { url: (y) => `https://api.github.com/repos/NateScarlet/holiday-cn/contents/${y}.json`, parse: parseGithubContents },
]

/** 归并校验：date/isOffDay 对 → { rest: ['MM-DD'], work: ['MM-DD'] }；无放假日视为无效 */
function collect(pairs, year) {
  const rest = new Set()
  const work = new Set()
  for (const [date, off] of pairs) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof date === 'string' ? date : '')
    if (!m || +m[1] !== year) continue
    ;(off ? rest : work).add(m[2] + '-' + m[3])
  }
  if (rest.size < 3) return null // 全年安排至少 3 个放假日，否则视为坏数据
  const sort = (s) => [...s].sort()
  return { rest: sort(rest), work: sort(work) }
}

class HolidaySync {
  constructor(dir) {
    this.file = path.join(dir, 'holidays-cache.json')
    this.cache = this.load()
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      return { years: parsed.years || {}, miss: parsed.miss || {} }
    } catch {
      return { years: {}, miss: {} }
    }
  }

  save() {
    try {
      const tmp = this.file + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(this.cache, null, 2), 'utf8')
      fs.renameSync(tmp, this.file)
    } catch {
      /* 磁盘异常时静默：下次启动重试 */
    }
  }

  /** 查询某年 { rest, work } 或 null（未发布/不可达）。缓存内秒回，否则联网 */
  async getYear(year) {
    year = Math.floor(+year)
    if (!Number.isInteger(year) || year < 2007 || year > 2100) return null
    const y = this.cache.years[year]
    if (y && Date.now() - y.ts < FRESH_MS) return { rest: y.rest, work: y.work }
    if (!y && this.cache.miss[year] && Date.now() - this.cache.miss[year] < MISS_MS) return null

    const got = await this.fetchYear(year)
    if (got) {
      this.cache.years[year] = { ...got, ts: Date.now() }
      delete this.cache.miss[year]
    } else if (!y) {
      this.cache.miss[year] = Date.now() // 已有旧数据但刷新失败时保留旧数据
    }
    this.save()
    return got || (y ? { rest: y.rest, work: y.work } : null)
  }

  async fetchYear(year) {
    for (const src of SOURCES) {
      try {
        const res = await fetch(src.url(year), {
          signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: { 'User-Agent': 'time-assistant' },
        })
        if (!res.ok) continue
        const parsed = src.parse(await res.json(), year)
        if (parsed) return parsed
      } catch {
        /* 断网/被墙/限流：换下一个源 */
      }
    }
    return null
  }
}

module.exports = { HolidaySync, parseHolidayCN, parseGithubContents, collect }

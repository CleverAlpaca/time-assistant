// 闹钟调度器：每秒检查到期的闹钟（含待办/日程的关联提醒），触发系统通知
// 睡眠唤醒后 60 秒内错过的补发，更早的直接标记已跳过，避免开机连环响
const pad = (n) => String(n).padStart(2, '0')
const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const isoWeekday = (d) => (d.getDay() === 0 ? 7 : d.getDay()) // 周一=1 … 周日=7
const addDays = (d, n) => {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

function parseDT(dateStr, timeStr) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(timeStr || '')
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '')
  if (!m || !dm) return null
  const d = new Date(+dm[1], +dm[2] - 1, +dm[3], +m[1], +m[2], 0, 0)
  return isNaN(d) ? null : d
}

const occKey = (d, time) => `${fmtDate(d)} ${time}`

class AlarmScheduler {
  constructor({ getAlarms, saveAlarm, onFire }) {
    this.getAlarms = getAlarms
    this.saveAlarm = saveAlarm
    this.onFire = onFire
    this.snoozes = new Map() // alarmId -> Date
  }

  snooze(id, minutes = 5) {
    this.snoozes.set(id, new Date(Date.now() + minutes * 60_000))
  }

  /** 不晚于 now 的最近一次触发时刻（用于判断"是否到期"） */
  lastOccurrenceAtOrBefore(alarm, now) {
    if (alarm.repeat === 'once') {
      const d = parseDT(alarm.date, alarm.time)
      return d && d <= now ? d : null
    }
    const today = parseDT(fmtDate(now), alarm.time)
    if (!today) return null
    if (alarm.repeat === 'daily') return today <= now ? today : null
    // weekly
    if (today <= now && (alarm.weekdays || []).includes(isoWeekday(now))) return today
    return null
  }

  /** 下一次（严格未来）触发时刻，供 UI 展示 */
  nextOccurrence(alarm, now = new Date()) {
    if (alarm.repeat === 'once') {
      const d = parseDT(alarm.date, alarm.time)
      return d && d > now ? d : null
    }
    if (alarm.repeat === 'daily') {
      const t = parseDT(fmtDate(now), alarm.time)
      if (t && t > now) return t
      return parseDT(fmtDate(addDays(now, 1)), alarm.time)
    }
    if (alarm.repeat === 'weekly') {
      for (let i = 0; i < 8; i++) {
        const day = addDays(now, i)
        if ((alarm.weekdays || []).includes(isoWeekday(day))) {
          const t = parseDT(fmtDate(day), alarm.time)
          if (t && t > now) return t
        }
      }
    }
    return null
  }

  tick() {
    const now = new Date()

    // 贪睡到点
    for (const [id, at] of this.snoozes) {
      if (at <= now) {
        this.snoozes.delete(id)
        const alarm = this.getAlarms().find((a) => a.id === id)
        if (alarm) this.fire(alarm, null, true)
      }
    }

    for (const alarm of this.getAlarms()) {
      if (!alarm.enabled) continue
      const occ = this.lastOccurrenceAtOrBefore(alarm, now)
      if (!occ) continue
      const key = occKey(occ, alarm.time)
      if (alarm.lastFiredKey === key) continue
      const late = Date.now() - occ.getTime()
      if (late <= 60_000) {
        this.fire(alarm, key, false)
      } else {
        // 错过太久（如睡眠唤醒）：标记已消费，等下一次
        this.saveAlarm({ ...alarm, lastFiredKey: key })
      }
    }
  }

  fire(alarm, key, snoozed) {
    this.onFire({ alarm, snoozed })
    if (snoozed) return
    const patch = { ...alarm, lastFiredKey: key }
    if (alarm.repeat === 'once') patch.enabled = false
    this.saveAlarm(patch)
  }
}

module.exports = { AlarmScheduler }

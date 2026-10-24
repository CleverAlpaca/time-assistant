// 专注统计页：概览 / 趋势柱状图（手写 SVG）/ 连续天数 / 任务排行
;(function () {
  const completed = () => Data.sessions.filter((s) => s.completed)

  function inRange(s, from, to) {
    const k = DU.dateKey(new Date(s.start))
    return k >= from && k <= to
  }

  function summarize(list) {
    const min = Math.round(list.reduce((a, s) => a + s.durationMs, 0) / 60_000)
    const tomatoes = list.filter((s) => s.mode === 'pomodoro').length
    return { min, tomatoes }
  }

  function weekStart(d) {
    return DU.addDays(DU.startOfDay(d), -(DU.isoWeekday(d) - 1))
  }

  function calcStreak() {
    const days = new Set(completed().map((s) => DU.dateKey(new Date(s.start))))
    let streak = 0
    let cursor = new Date()
    if (!days.has(DU.dateKey(cursor))) cursor = DU.addDays(cursor, -1) // 今天还没专注不打断连续
    while (days.has(DU.dateKey(cursor))) {
      streak++
      cursor = DU.addDays(cursor, -1)
    }
    return streak
  }

  App.pages.stats = {
    range: 7,

    init(root) {
      this.root = root
      root.innerHTML = `
        <div class="page-header">
          <div><h2>专注统计</h2><div class="page-sub">只统计完整完成的专注段</div></div>
        </div>
        <div class="stats-cards" id="st-cards"></div>
        <div class="card stats-chart-card">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
            <h4 style="margin:0">每日专注时长（分钟）</h4>
            <div class="seg" id="st-range">
              <button class="seg-item active" data-r="7">近 7 天</button>
              <button class="seg-item" data-r="30">近 30 天</button>
            </div>
          </div>
          <div id="st-chart"></div>
        </div>
        <div class="stats-bottom">
          <div class="card streak-card"><h4>连续专注</h4>
            <div class="streak-num" id="st-streak">0</div>
            <div class="streak-sub" id="st-streak-sub">天</div>
          </div>
          <div class="card task-rank-card"><h4>任务专注排行</h4><div id="st-rank"></div></div>
        </div>`

      root.querySelector('#st-range').addEventListener('click', (e) => {
        const b = e.target.closest('.seg-item')
        if (!b) return
        this.range = +b.dataset.r
        this.render()
      })
      window.addEventListener('resize', () => {
        if (App.currentPage === 'stats') this.render()
      })
      Data.on('sessions', () => this.render())
      this.render()
    },

    show() {
      this.render()
    },

    render() {
      const root = this.root
      root.querySelectorAll('#st-range .seg-item').forEach((b) => b.classList.toggle('active', +b.dataset.r === this.range))

      const today = DU.startOfDay(new Date())
      const todayKey = DU.dateKey(today)
      const weekFrom = DU.dateKey(weekStart(new Date()))
      const monthFrom = DU.dateKey(new Date(today.getFullYear(), today.getMonth(), 1))
      const all = completed()

      const cards = [
        { label: '今日', data: summarize(all.filter((s) => inRange(s, todayKey, todayKey))) },
        { label: '本周', data: summarize(all.filter((s) => inRange(s, weekFrom, todayKey))) },
        { label: '本月', data: summarize(all.filter((s) => inRange(s, monthFrom, todayKey))) },
      ]
      root.querySelector('#st-cards').innerHTML = cards
        .map(
          (c) => `
        <div class="card stats-card">
          <div class="sc-num">${c.data.min}<small>分钟</small></div>
          <div class="sc-label">${c.label}专注 · ${c.data.tomatoes} 番茄</div>
        </div>`
        )
        .join('')

      this.renderChart()
      this.renderRank()

      const streak = calcStreak()
      root.querySelector('#st-streak').textContent = streak
      root.querySelector('#st-streak-sub').textContent = streak > 0 ? `天连续专注，保持住 💪` : '天，从今天开始一段专注吧'
    },

    renderChart() {
      const box = this.root.querySelector('#st-chart')
      const W = Math.max(320, box.clientWidth || 600)
      const H = 190
      const padB = 22
      const padT = 14
      const n = this.range

      const byDay = new Map()
      for (let i = n - 1; i >= 0; i--) {
        byDay.set(DU.dateKey(DU.addDays(new Date(), -i)), 0)
      }
      for (const s of completed()) {
        const k = DU.dateKey(new Date(s.start))
        if (byDay.has(k)) byDay.set(k, byDay.get(k) + s.durationMs / 60_000)
      }
      const values = [...byDay.values()].map((v) => Math.round(v))
      const max = Math.max(30, ...values)
      const gap = n > 10 ? 3 : 8
      const barW = (W - gap * (n - 1)) / n
      const plotH = H - padB - padT

      let bars = ''
      let labels = ''
      const keys = [...byDay.keys()]
      keys.forEach((key, i) => {
        const v = values[i]
        const h = Math.max(v > 0 ? 3 : 0, (v / max) * plotH)
        const x = i * (barW + gap)
        const y = padT + plotH - h
        const d = DU.fromKey(key)
        const isToday = i === n - 1
        bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="3.5"
          fill="${isToday ? 'var(--accent)' : 'color-mix(in srgb, var(--accent) 55%, transparent)'}">
          <title>${DU.fmtCN(key)} · ${v} 分钟</title></rect>`
        if (n <= 7 || i % 5 === 0 || isToday) {
          const text = n <= 7 ? `周${DU.weekdayCN[DU.isoWeekday(d) - 1]}` : `${d.getMonth() + 1}/${d.getDate()}`
          labels += `<text class="bar-label" x="${(x + barW / 2).toFixed(1)}" y="${H - 6}">${text}</text>`
        }
      })

      const gridLines = [0, 0.5, 1]
        .map((f) => {
          const y = padT + plotH - f * plotH
          return `<line x1="0" x2="${W}" y1="${y}" y2="${y}" stroke="var(--border)" stroke-dasharray="${f === 0 ? '' : '3,4'}"/>
            <text class="bar-label" x="2" y="${y - 3}" style="text-anchor:start">${Math.round(max * f)}</text>`
        })
        .join('')

      box.innerHTML = `<svg class="bar-chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${gridLines}${bars}${labels}</svg>`
    },

    renderRank() {
      const byTask = new Map()
      for (const s of completed()) {
        const name = s.mode === 'pomodoro' ? s.title || '专注' : s.mode === 'countdown' ? '倒计时专注' : '正计时专注'
        byTask.set(name, (byTask.get(name) || 0) + s.durationMs / 60_000)
      }
      const rows = [...byTask.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      const box = this.root.querySelector('#st-rank')
      if (!rows.length) {
        box.innerHTML = `<div class="text-3" style="font-size:12px">还没有专注记录</div>`
        return
      }
      const max = rows[0][1]
      box.innerHTML = rows
        .map(
          ([name, min]) => `
        <div class="task-rank-row">
          <span class="tr-name" title="${App.esc(name)}">${App.esc(name)}</span>
          <span class="tr-bar"><i style="width:${Math.round((min / max) * 100)}%"></i></span>
          <span class="tr-val">${Math.round(min)} 分</span>
        </div>`
        )
        .join('')
    },
  }
})()

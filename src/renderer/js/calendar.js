// 日历日程页：月视图 + 日程事件 + 待办标记 + 专注热力
;(function () {
  // 日程提醒以关联闹钟（type:'event'）实现；remindMin = 提前分钟数（0 = 准时，null = 不提醒）
  function syncEventAlarm(ev) {
    const existing = Data.alarms.find((a) => a.type === 'event' && a.sourceId === ev.id)
    if (ev.remindMin !== null && ev.remindMin !== undefined) {
      const dt = DU.parseDT(ev.date, ev.time)
      if (dt) {
        dt.setMinutes(dt.getMinutes() - (ev.remindMin || 0))
        Data.save('alarms', {
          ...existing,
          id: existing ? existing.id : undefined,
          type: 'event',
          sourceId: ev.id,
          title: `日程：${ev.title}`,
          date: DU.dateKey(dt),
          time: `${DU.pad(dt.getHours())}:${DU.pad(dt.getMinutes())}`,
          repeat: 'once',
          weekdays: null,
          enabled: true,
        })
        return
      }
    }
    if (existing) Data.remove('alarms', existing.id)
  }

  function openEventModal(existing, defaultDate) {
    const ev = existing || { title: '', date: defaultDate, time: '09:00', remindMin: null }
    const body = App.el(`
      <div>
        <div class="form-row"><label>标题</label>
          <input class="input" id="fm-title" placeholder="日程安排…" value="${App.esc(ev.title)}"></div>
        <div class="form-row"><label>日期与时间</label>
          <div style="display:flex;gap:10px">
            <input class="input" id="fm-date" type="date" value="${App.esc(ev.date || '')}" style="flex:1">
            <input class="input" id="fm-time" type="time" value="${App.esc(ev.time || '')}" style="flex:1">
          </div>
        </div>
        <div class="form-row"><label>提醒</label>
          <select class="input" id="fm-remind">
            <option value="">不提醒</option>
            <option value="0">准时提醒</option>
            <option value="5">提前 5 分钟</option>
            <option value="15">提前 15 分钟</option>
            <option value="30">提前 30 分钟</option>
          </select>
        </div>
      </div>`)
    body.querySelector('#fm-remind').value = ev.remindMin === null || ev.remindMin === undefined ? '' : String(ev.remindMin)

    App.modal({
      title: existing ? '编辑日程' : '新建日程',
      body,
      actions: [
        {
          label: '保存',
          onClick: (close) => {
            const title = body.querySelector('#fm-title').value.trim()
            const date = body.querySelector('#fm-date').value
            const time = body.querySelector('#fm-time').value
            if (!title) return App.toast({ title: '请输入标题' })
            if (!date || !time) return App.toast({ title: '请选择日期和时间' })
            const remindRaw = body.querySelector('#fm-remind').value
            Data.save('events', {
              ...existing,
              id: existing ? existing.id : undefined,
              title,
              date,
              time,
              remindMin: remindRaw === '' ? null : +remindRaw,
            }).then((saved) => syncEventAlarm(saved))
            close()
          },
        },
      ],
    })
  }

  // 按日期聚合已完成专注（分钟），供热力与面板使用
  function focusByDay() {
    const map = new Map()
    for (const s of Data.sessions) {
      if (!s.completed) continue
      const key = DU.dateKey(new Date(s.start))
      const cur = map.get(key) || { min: 0, count: 0 }
      cur.min += s.durationMs / 60_000
      cur.count += 1
      map.set(key, cur)
    }
    return map
  }

  App.pages.calendar = {
    view: new Date(), // 当前展示月（任意属于该月的日期）
    selected: DU.dateKey(new Date()),

    init(root) {
      this.root = root
      root.innerHTML = `
        <div class="page-header">
          <div><h2>日历日程</h2><div class="page-sub">背景深浅表示当日专注时长</div></div>
          <button class="btn btn-primary" id="cal-add">＋ 新建日程</button>
        </div>
        <div class="cal-layout">
          <div class="cal-main">
            <div class="cal-head">
              <div class="cal-title" id="cal-title"></div>
              <div class="cal-nav">
                <button class="btn btn-secondary btn-sm" id="cal-prev">‹</button>
                <button class="btn btn-secondary btn-sm" id="cal-today">今天</button>
                <button class="btn btn-secondary btn-sm" id="cal-next">›</button>
              </div>
            </div>
            <div class="cal-grid" id="cal-grid"></div>
          </div>
          <div class="cal-panel card" id="cal-panel"></div>
        </div>`

      root.querySelector('#cal-prev').onclick = () => this.shiftMonth(-1)
      root.querySelector('#cal-next').onclick = () => this.shiftMonth(1)
      root.querySelector('#cal-today').onclick = () => {
        this.view = new Date()
        this.selected = DU.dateKey(new Date())
        this.render()
      }
      root.querySelector('#cal-add').onclick = () => openEventModal(null, this.selected)
      root.querySelector('#cal-grid').addEventListener('click', (e) => {
        const cell = e.target.closest('.cal-day')
        if (!cell) return
        this.selected = cell.dataset.date
        this.render()
      })
      root.querySelector('#cal-panel').addEventListener('click', (e) => this._onPanelClick(e))

      Data.on('*', () => this.render())
      this.render()
    },

    show() {
      this.render()
    },

    shiftMonth(n) {
      this.view = new Date(this.view.getFullYear(), this.view.getMonth() + n, 1)
      this.render()
    },

    render() {
      const title = this.root.querySelector('#cal-title')
      title.textContent = `${this.view.getFullYear()} 年 ${this.view.getMonth() + 1} 月`

      const focusMap = focusByDay()
      const todoMap = new Map()
      for (const t of Data.todos) {
        if (t.done || !t.dueDate) continue
        todoMap.set(t.dueDate, (todoMap.get(t.dueDate) || 0) + 1)
      }
      const eventMap = new Map()
      for (const ev of Data.events) {
        eventMap.set(ev.date, (eventMap.get(ev.date) || 0) + 1)
      }

      // 从本月第一天的周一开始，铺满 6 周
      const first = new Date(this.view.getFullYear(), this.view.getMonth(), 1)
      const start = DU.addDays(first, -(DU.isoWeekday(first) - 1))
      const todayKey = DU.dateKey(new Date())

      let html = DU.weekdayCN.map((w) => `<div class="cal-weekday">周${w}</div>`).join('')
      for (let i = 0; i < 42; i++) {
        const d = DU.addDays(start, i)
        const key = DU.dateKey(d)
        const other = d.getMonth() !== this.view.getMonth()
        const focus = focusMap.get(key)
        const heat = focus ? `style="background:color-mix(in srgb, var(--accent) ${Math.min(38, Math.round(focus.min / 7))}%, transparent)"` : ''
        const evCount = eventMap.get(key) || 0
        const tdCount = todoMap.get(key) || 0
        const dots = [
          ...Array(Math.min(evCount, 3)).fill('<span class="cal-dot" style="background:var(--accent)"></span>'),
          ...Array(Math.min(tdCount, 2)).fill('<span class="cal-dot" style="background:var(--purple)"></span>'),
        ].join('')
        // 农历/节气/节日：节日(红) > 节气(紫) > 农历日(灰)；法定节假日角标：休(红)/班(橙)
        const li = Lunar.dayInfo(key)
        const lunarCls = li.type === 'festival' ? ' festival' : li.type === 'term' ? ' term' : ''
        const hol = Lunar.holidayOf(key)
        const holBadge = hol ? `<span class="cal-hol ${hol}">${hol === 'rest' ? '休' : '班'}</span>` : ''
        html += `
          <div class="cal-day${other ? ' other' : ''}${key === todayKey ? ' today' : ''}${key === this.selected ? ' selected' : ''}${hol ? ' has-hol' : ''}" data-date="${key}" ${heat}>
            <div class="cal-top">
              <div class="cal-num">${d.getDate()}</div>
              ${li.label ? `<span class="cal-lunar${lunarCls}">${li.label}</span>` : ''}
            </div>
            <div class="cal-dots">${dots}</div>
            ${holBadge}
          </div>`
      }
      this.root.querySelector('#cal-grid').innerHTML = html
      this.renderPanel()
    },

    renderPanel() {
      const panel = this.root.querySelector('#cal-panel')
      const key = this.selected
      const d = DU.fromKey(key)
      const todayKey = DU.dateKey(new Date())
      const tomorrowKey = DU.dateKey(DU.addDays(new Date(), 1))
      const dayName = key === todayKey ? '今天' : key === tomorrowKey ? '明天' : DU.fmtCN(key)
      const wd = DU.weekdayCN[DU.isoWeekday(d) - 1]

      const events = Data.events.filter((e) => e.date === key).sort((a, b) => a.time.localeCompare(b.time))
      const todos = Data.todos.filter((t) => t.dueDate === key && !t.done)
      const focus = focusByDay().get(key)

      const eventHtml = events.length
        ? events
            .map(
              (e) => `
          <div class="cal-event" data-id="${e.id}">
            <span class="ev-time">${App.esc(e.time)}</span>
            <span class="ev-title" title="${App.esc(e.title)}">${App.esc(e.title)}</span>
            ${e.remindMin !== null && e.remindMin !== undefined ? '<span title="提醒已开启">🔔</span>' : ''}
            <button class="icon-btn ev-edit" title="编辑">✎</button>
            <button class="icon-btn danger ev-del" title="删除">🗑</button>
          </div>`
            )
            .join('')
        : `<div class="text-3" style="font-size:12px">这一天没有日程</div>`

      const todoHtml = todos.length
        ? todos
            .map(
              (t) => `
          <div class="cal-event" data-todo="${t.id}">
            <button class="todo-check" style="width:18px;height:18px;font-size:10px" title="完成"></button>
            <span class="ev-title">${App.esc(t.title)}</span>
          </div>`
            )
            .join('')
        : `<div class="text-3" style="font-size:12px">没有到期的待办</div>`

      const li = Lunar.dayInfo(key)
      const lunarLine = li.lunarFull
        ? `${li.lunarFull}${li.term && li.type !== 'term' ? ` · ${li.term}` : ''}${li.festival ? ` · <b class="cal-panel-festival">${li.festival}</b>` : ''}`
        : ''
      const hol = Lunar.holidayOf(key)
      const holLine = hol
        ? `<div class="cal-panel-hol ${hol}">${hol === 'rest' ? '法定休假日' : '调休上班日'}</div>`
        : ''

      panel.innerHTML = `
        <div class="cal-panel-date">${dayName} · 周${wd}</div>
        ${lunarLine ? `<div class="cal-panel-lunar">${lunarLine}</div>` : ''}
        ${holLine}
        <div class="cal-panel-section"><h4>日程</h4>${eventHtml}</div>
        <div class="cal-panel-section"><h4>到期待办</h4>${todoHtml}</div>
        <div class="cal-panel-section">
          <h4>专注</h4>
          <div style="font-size:13px">${focus ? `专注 <b>${Math.round(focus.min)}</b> 分钟 · <b>${focus.count}</b> 段` : '<span class="text-3">这一天没有专注记录</span>'}</div>
        </div>`
    },

    _onPanelClick(e) {
      const evBox = e.target.closest('.cal-event[data-id]')
      if (evBox) {
        const ev = Data.events.find((x) => x.id === evBox.dataset.id)
        if (!ev) return
        if (e.target.closest('.ev-edit')) openEventModal(ev)
        else if (e.target.closest('.ev-del')) {
          App.confirmDlg(`删除日程「${ev.title}」？`).then(async (ok) => {
            if (!ok) return
            const linked = Data.alarms.find((a) => a.type === 'event' && a.sourceId === ev.id)
            if (linked) await Data.remove('alarms', linked.id)
            Data.remove('events', ev.id)
          })
        }
        return
      }
      const tdBox = e.target.closest('.cal-event[data-todo]')
      if (tdBox && e.target.closest('.todo-check')) {
        const todo = Data.todos.find((t) => t.id === tdBox.dataset.todo)
        if (todo) Data.save('todos', { ...todo, done: true, completedAt: Date.now() })
      }
    },
  }
})()

// 闹钟提醒页
;(function () {
  function nextOccurrence(alarm) {
    const now = new Date()
    if (alarm.repeat === 'once') {
      const d = DU.parseDT(alarm.date, alarm.time)
      return d && d > now ? d : null
    }
    if (alarm.repeat === 'daily') {
      const t = DU.parseDT(DU.dateKey(now), alarm.time)
      if (t && t > now) return t
      return DU.parseDT(DU.dateKey(DU.addDays(now, 1)), alarm.time)
    }
    if (alarm.repeat === 'weekly') {
      for (let i = 0; i < 8; i++) {
        const day = DU.addDays(now, i)
        if ((alarm.weekdays || []).includes(DU.isoWeekday(day))) {
          const t = DU.parseDT(DU.dateKey(day), alarm.time)
          if (t && t > now) return t
        }
      }
    }
    return null
  }

  function repeatText(a) {
    if (a.repeat === 'daily') return '每天'
    if (a.repeat === 'weekly') {
      return '每周' + (a.weekdays || []).map((w) => DU.weekdayCN[w - 1]).join('、')
    }
    return a.date ? DU.fmtCN(a.date) : '单次'
  }

  function nextText(a) {
    const d = nextOccurrence(a)
    if (!d) return '已过期'
    const today = DU.dateKey(new Date())
    const key = DU.dateKey(d)
    const day = key === today ? '今天' : key === DU.dateKey(DU.addDays(new Date(), 1)) ? '明天' : DU.fmtCN(key)
    return `下次提醒：${day} ${d.getHours()}:${DU.pad(d.getMinutes())}`
  }

  // ---- 开启闹钟时的倒计时气泡（玻璃风，每秒跳动，6 秒后自动消失）----
  let alarmPop = null

  function closeAlarmPop() {
    if (!alarmPop) return
    clearInterval(alarmPop.tick)
    clearTimeout(alarmPop.hide)
    document.removeEventListener('mousedown', alarmPop.onDown, true)
    alarmPop.el.remove()
    alarmPop = null
  }

  function showAlarmPop(anchorEl, alarm) {
    closeAlarmPop()
    const el = App.el('<div class="wpop alarm-pop"><div class="alarm-pop-when"></div><div class="alarm-pop-cap">距响铃还有</div><div class="alarm-pop-time"></div></div>')
    document.body.appendChild(el)
    const whenEl = el.querySelector('.alarm-pop-when')
    const timeEl = el.querySelector('.alarm-pop-time')
    const update = () => {
      const d = nextOccurrence(alarm)
      if (!d) {
        whenEl.textContent = '该闹钟没有有效的触发时间'
        timeEl.textContent = '--:--'
        return
      }
      whenEl.textContent = '下次响铃 · ' + nextText(alarm).replace('下次提醒：', '')
      const sec = Math.max(0, Math.ceil((d - Date.now()) / 1000))
      const hh = Math.floor(sec / 3600)
      const mm = Math.floor((sec % 3600) / 60)
      const ss = sec % 60
      timeEl.textContent = hh > 0 ? `${hh}:${DU.pad(mm)}:${DU.pad(ss)}` : `${DU.pad(mm)}:${DU.pad(ss)}`
    }
    update()
    // 定位：锚定开关下方、右缘对齐并夹在视口内，放不下则翻到上方
    const r = anchorEl.getBoundingClientRect()
    el.style.visibility = 'hidden'
    const pw = el.offsetWidth
    const ph = el.offsetHeight
    const left = Math.min(Math.max(8, r.right - pw), window.innerWidth - pw - 8)
    let top = r.bottom + 8
    if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 8)
    el.style.left = left + 'px'
    el.style.top = top + 'px'
    el.style.visibility = ''
    const onDown = (e) => {
      if (!el.contains(e.target)) closeAlarmPop()
    }
    document.addEventListener('mousedown', onDown, true)
    alarmPop = {
      el,
      tick: setInterval(update, 1000),
      hide: setTimeout(closeAlarmPop, 6000),
      onDown,
      alarmId: alarm.id,
    }
  }

  function openAlarmModal(existing) {
    const a = existing || { title: '', time: '08:00', repeat: 'daily', date: DU.dateKey(new Date()), weekdays: [1, 2, 3, 4, 5] }
    const dateW = Widgets.datePicker({ value: a.date || '', className: 'fill' })
    const timeW = Widgets.timePicker({ value: a.time || '08:00' })
    const body = App.el(`
      <div>
        <div class="form-row"><label>标题</label>
          <input class="input" id="fm-title" placeholder="闹钟提醒" value="${App.esc(a.title)}"></div>
        <div class="form-row"><label>时间</label>
          <span id="fm-time" style="display:flex"></span></div>
        <div class="form-row"><label>重复</label>
          <div class="seg" id="fm-repeat">
            <button class="seg-item" data-v="once">一次</button>
            <button class="seg-item" data-v="daily">每天</button>
            <button class="seg-item" data-v="weekly">每周</button>
          </div>
          <div style="margin-top:10px">
            <div class="form-row" id="fm-date-row" style="margin:0"><label style="margin-top:0">日期</label>
              <span id="fm-date" style="display:flex"></span></div>
            <div class="chips" id="fm-weekdays" style="margin-top:10px"></div>
          </div>
        </div>
      </div>`)
    body.querySelector('#fm-date').appendChild(dateW.root)
    body.querySelector('#fm-time').appendChild(timeW.root)

    const repeatSeg = body.querySelector('#fm-repeat')
    const syncRepeatUI = () => {
      repeatSeg.querySelectorAll('.seg-item').forEach((b) => b.classList.toggle('active', b.dataset.v === a.repeat))
      body.querySelector('#fm-date-row').style.display = a.repeat === 'once' ? '' : 'none'
      body.querySelector('#fm-weekdays').style.display = a.repeat === 'weekly' ? 'flex' : 'none'
    }
    repeatSeg.addEventListener('click', (e) => {
      const b = e.target.closest('.seg-item')
      if (b) {
        a.repeat = b.dataset.v
        syncRepeatUI()
      }
    })
    const wdBox = body.querySelector('#fm-weekdays')
    const syncWeekdays = () => {
      wdBox.innerHTML = DU.weekdayCN
        .map((w, i) => `<button class="chip${(a.weekdays || []).includes(i + 1) ? ' on' : ''}" data-w="${i + 1}">周${w}</button>`)
        .join('')
    }
    wdBox.addEventListener('click', (e) => {
      const b = e.target.closest('.chip')
      if (!b) return
      const w = +b.dataset.w
      a.weekdays = a.weekdays || []
      a.weekdays = a.weekdays.includes(w) ? a.weekdays.filter((x) => x !== w) : [...a.weekdays, w].sort()
      syncWeekdays()
    })
    syncRepeatUI()
    syncWeekdays()

    App.modal({
      title: existing ? '编辑闹钟' : '新建闹钟',
      body,
      actions: [
        {
          label: '保存',
          onClick: (close) => {
            const title = body.querySelector('#fm-title').value.trim() || '闹钟提醒'
            const time = timeW.get()
            if (!time) return App.toast({ title: '请选择时间' })
            let date = null
            if (a.repeat === 'once') {
              date = dateW.get()
              if (!date) return App.toast({ title: '请选择日期' })
            }
            if (a.repeat === 'weekly' && (!a.weekdays || !a.weekdays.length)) {
              return App.toast({ title: '请选择至少一个星期' })
            }
            Data.save('alarms', {
              id: existing ? existing.id : undefined,
              type: 'alarm',
              title,
              time,
              repeat: a.repeat,
              date,
              weekdays: a.repeat === 'weekly' ? a.weekdays : null,
              enabled: true,
              lastFiredKey: existing ? existing.lastFiredKey : null,
            }).then((saved) => {
              // 新建闹钟默认开启：等同打开开关，弹出距下次响铃的倒计时气泡
              if (!existing && saved) {
                setTimeout(() => {
                  const row = document.querySelector(`.alarm-item[data-id="${saved.id}"] .switch`)
                  showAlarmPop(row || document.querySelector('#al-add'), saved)
                }, 90) // 等列表按新数据重渲染完成，再锚定到新行
              }
            })
            close()
          },
        },
      ],
    })
  }

  App.pages.alarms = {
    init(root) {
      this.root = root
      root.innerHTML = `
        <div class="page-header">
          <div><h2>闹钟提醒</h2><div class="page-sub">到点弹出系统通知，支持贪睡 5 分钟</div></div>
          <button class="btn btn-primary" id="al-add">＋ 新建闹钟</button>
        </div>
        <div class="alarm-list" id="al-list"></div>`
      root.querySelector('#al-add').onclick = () => openAlarmModal(null)
      root.querySelector('#al-list').addEventListener('click', (e) => this._onClick(e))
      // 开关用 change 事件：label 的激活行为会产生两次 click 派发（滑块 + 转发到 checkbox），
      // 委派 click 会把其中一次误判成「点卡片编辑」
      root.querySelector('#al-list').addEventListener('change', (e) => this._onToggle(e))
      Data.on('alarms', () => this.render())
      this.render()
    },

    show() {
      this.render()
    },

    render() {
      const list = Data.alarms.filter((a) => a.type === 'alarm' || !a.type)
      const box = this.root.querySelector('#al-list')
      if (!list.length) {
        box.innerHTML = `<div class="card empty"><span class="empty-icon">⏰</span>还没有闹钟，点右上角新建一个</div>`
        return
      }
      list.sort((x, y) => x.time.localeCompare(y.time))
      box.innerHTML = list
        .map(
          (a) => `
        <div class="alarm-item${a.enabled ? '' : ' off'}" data-id="${a.id}">
          <div class="alarm-time">${App.esc(a.time)}</div>
          <div class="alarm-info">
            <div class="alarm-title">${App.esc(a.title)}</div>
            <div class="alarm-meta">${repeatText(a)} · ${nextText(a)}</div>
          </div>
          <div class="alarm-actions">
            <label class="switch"><input type="checkbox" class="al-toggle" ${a.enabled ? 'checked' : ''}><span class="track"></span></label>
            <button class="icon-btn al-edit" title="编辑">✎</button>
            <button class="icon-btn danger al-del" title="删除">🗑</button>
          </div>
        </div>`
        )
        .join('')
    },

    // 开关切换（change 事件，状态翻转只派发一次）
    _onToggle(e) {
      if (!e.target.closest('.al-toggle')) return
      const item = e.target.closest('.alarm-item')
      if (!item) return
      const alarm = Data.alarms.find((a) => a.id === item.dataset.id)
      if (!alarm) return
      const turningOn = e.target.checked
      if (!!alarm.enabled === turningOn) return // 状态未变（重复派发），跳过
      Data.save('alarms', { ...alarm, enabled: turningOn })
      if (turningOn) showAlarmPop(item.querySelector('.switch'), alarm)
      else if (alarmPop && alarmPop.alarmId === alarm.id) closeAlarmPop()
    },

    _onClick(e) {
      const item = e.target.closest('.alarm-item')
      if (!item) return
      if (e.target.closest('.switch')) return // 开关走 change 事件，避免双派发误触编辑
      const alarm = Data.alarms.find((a) => a.id === item.dataset.id)
      if (!alarm) return
      if (e.target.closest('.al-edit')) {
        openAlarmModal(alarm)
      } else if (e.target.closest('.al-del')) {
        App.confirmDlg(`删除闹钟「${alarm.title}」？`).then((ok) => ok && Data.remove('alarms', alarm.id))
      } else {
        // 点击闹钟卡片本体 = 编辑
        openAlarmModal(alarm)
      }
    },
  }
})()

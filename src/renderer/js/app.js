// 应用外壳：路由 / 主题 / 窗控 / Toast / 弹窗（最后加载并启动）
;(function () {
  const $ = (sel, root = document) => root.querySelector(sel)

  // ---- DOM 助手 ----
  function el(html) {
    const t = document.createElement('template')
    t.innerHTML = html.trim()
    return t.content.firstElementChild
  }
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }
  function fmtMS(ms) {
    const sec = Math.max(0, Math.floor(ms / 1000))
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = sec % 60
    return h > 0 ? `${h}:${DU.pad(m)}:${DU.pad(s)}` : `${DU.pad(m)}:${DU.pad(s)}`
  }

  // ---- 提示音（Web Audio 合成，无需资源文件）----
  function playChime() {
    try {
      const ctx = new AudioContext()
      for (const [i, freq] of [660, 880].entries()) {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        const t0 = ctx.currentTime + i * 0.22
        osc.type = 'sine'
        osc.frequency.value = freq
        gain.gain.setValueAtTime(0.0001, t0)
        gain.gain.exponentialRampToValueAtTime(0.16, t0 + 0.03)
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.1)
        osc.connect(gain).connect(ctx.destination)
        osc.start(t0)
        osc.stop(t0 + 1.2)
      }
    } catch {
      /* 音频不可用时静默 */
    }
  }

  // ---- Toast ----
  function toast({ title, body = '', actions = [], timeout = 4200 }) {
    const t = el(`<div class="toast"><div style="min-width:0"><div class="toast-title">${esc(title)}</div>${body ? `<div class="toast-body">${esc(body)}</div>` : ''}</div></div>`)
    const close = () => {
      t.classList.add('leaving')
      setTimeout(() => t.remove(), 220)
    }
    if (actions.length) {
      const box = el('<div class="toast-actions"></div>')
      for (const a of actions) {
        const b = el(`<button class="btn btn-sm ${a.class || 'btn-secondary'}">${esc(a.label)}</button>`)
        b.onclick = () => {
          close()
          a.onClick && a.onClick()
        }
        box.appendChild(b)
      }
      t.appendChild(box)
    }
    $('#toasts').appendChild(t)
    if (timeout) setTimeout(close, timeout)
    return close
  }

  // ---- 弹窗 ----
  let activeModal = null
  function closeModal() {
    if (activeModal) {
      activeModal()
      activeModal = null
    }
  }
  function modal({ title, body, actions = [] }) {
    closeModal()
    const overlay = el('<div class="modal-overlay"></div>')
    const m = el(`<div class="modal"><h3>${esc(title)}</h3><div class="modal-body"></div><div class="form-actions"></div></div>`)
    overlay.appendChild(m)
    const bodyBox = $('.modal-body', m)
    typeof body === 'string' ? bodyBox.appendChild(el(body)) : bodyBox.appendChild(body)
    const close = () => {
      overlay.remove()
      if (activeModal === close) activeModal = null
    }
    const acts = $('.form-actions', m)
    if (!actions.some((a) => a.cancel)) {
      const cancel = el('<button class="btn btn-secondary">取消</button>')
      cancel.onclick = close
      acts.appendChild(cancel)
    }
    for (const a of actions) {
      const b = el(`<button class="btn ${a.class || 'btn-primary'}">${esc(a.label)}</button>`)
      b.onclick = () => a.onClick && a.onClick(close)
      acts.appendChild(b)
    }
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) close()
    })
    $('#modal-root').appendChild(overlay)
    activeModal = close
    setTimeout(() => {
      const first = m.querySelector('input, select, textarea')
      first && first.focus()
    }, 30)
    return close
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal()
  })

  function confirmDlg(message, { okLabel = '删除', danger = true } = {}) {
    return new Promise((resolve) => {
      modal({
        title: '确认操作',
        body: `<p style="font-size:13px;line-height:1.6">${esc(message)}</p>`,
        actions: [
          { label: '取消', class: 'btn-secondary', cancel: true, onClick: (close) => { close(); resolve(false) } },
          { label: okLabel, class: danger ? 'btn-danger' : 'btn-primary', onClick: (close) => { close(); resolve(true) } },
        ],
      })
    })
  }

  // ---- 挂载助手 ----
  Object.assign(App, { el, esc, fmtMS, toast, modal, closeModal, confirmDlg, playChime, $ })

  // ---- 主题 ----
  let darkFromSystem = false
  function applyTheme() {
    const pref = Data.settings.theme || 'auto'
    document.documentElement.dataset.theme = pref === 'auto' ? (darkFromSystem ? 'dark' : 'light') : pref
  }

  // ---- 侧栏计时任务：三组计时器并行独立，各占一条；点击跳转对应计时页 ----
  function initSidebarTimer() {
    const box = $('#sidebar-timer')
    box.addEventListener('click', (e) => {
      const b = e.target.closest('.sb-timer-item')
      if (!b) return
      timeAPI.timer.control('mode', b.dataset.mode)
      App.nav('timer')
    })
    timeAPI.on('timer:state', (st) => {
      const items = st.sidebar || []
      box.hidden = items.length === 0
      box.innerHTML = items
        .map((it) => {
          const isBreak = it.mode === 'pomodoro' && it.phase !== 'focus'
          const cls = 'sb-timer-item' + (it.running ? '' : ' paused') + (isBreak ? ' is-break' : '') + (st.view === it.mode ? ' current' : '')
          const tip = it.running ? '点击查看此计时' : '已暂停 · 点击查看'
          const x = Math.max(0, Math.floor(it.ms))
          // 计时器条目精确到百分秒；番茄钟/倒计时精确到秒
          const timeTxt =
            it.mode === 'stopwatch'
              ? `${App.fmtMS(x)}.${String(Math.floor((x % 1000) / 10)).padStart(2, '0')}`
              : App.fmtMS(x)
          return (
            `<button class="${cls}" data-mode="${it.mode}" title="${tip}">` +
            `<span class="sidebar-timer-label">${App.esc(it.title)}${it.running ? '' : ' ⏸'}</span>` +
            `<span class="sidebar-timer-time">${timeTxt}</span>` +
            `</button>`
          )
        })
        .join('')
    })
  }

  // ---- 全局事件 ----
  function initGlobalEvents() {
    timeAPI.on('notify', ({ title, body, kind }) => {
      App.toast({ title, body, timeout: 6000 })
      if (kind === 'timer' && Data.settings.soundEnabled && document.hasFocus()) App.playChime()
    })
    timeAPI.on('alarm:fired', ({ alarm }) => {
      if (Data.settings.soundEnabled && document.hasFocus()) App.playChime()
      App.toast({
        title: '⏰ ' + alarm.title,
        body: alarm.type === 'todo' ? '待办到期提醒' : alarm.type === 'event' ? '日程提醒' : '闹钟时间到',
        timeout: 15000,
        actions: [{ label: '贪睡 5 分钟', onClick: () => timeAPI.alarm.snooze(alarm.id, 5) }],
      })
    })
  }

  // ---- 路由 ----
  const inited = new Set()
  function nav(name) {
    if (!App.pages[name]) return
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.page === name))
    document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === 'page-' + name))
    App.currentPage = name
    const root = document.getElementById('page-' + name)
    if (!inited.has(name)) {
      inited.add(name)
      App.pages[name].init(root)
    }
    App.pages[name].show && App.pages[name].show()
  }
  App.nav = nav

  function initWindowControls() {
    $('#btn-close').onclick = () => timeAPI.window.close()
    $('#btn-min').onclick = () => timeAPI.window.minimize()
    $('#btn-max').onclick = () => timeAPI.window.toggleMaximize()
    $('#titlebar').addEventListener('dblclick', (e) => {
      if (e.target.closest('.caption-btns')) return
      timeAPI.window.toggleMaximize()
    })
  }

  // ---- 启动 ----
  async function boot() {
    initWindowControls()
    await Data.init()

    const st = await timeAPI.app.themeState()
    darkFromSystem = st.effective === 'dark'
    applyTheme()
    timeAPI.on('theme:changed', ({ effective }) => {
      darkFromSystem = effective === 'dark'
      applyTheme()
    })
    Data.on('settings', applyTheme)

    initSidebarTimer()
    initGlobalEvents()

    // 圆角窗口：最大化时还原直角
    document.body.classList.toggle('maximized', await timeAPI.window.isMaximized())
    timeAPI.on('win:maximized', (v) => document.body.classList.toggle('maximized', v))

    $('#nav-items').addEventListener('click', (e) => {
      const b = e.target.closest('.nav-item')
      if (b) nav(b.dataset.page)
    })
    nav('timer')
  }

  boot()
})()

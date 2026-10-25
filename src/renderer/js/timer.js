// 番茄钟 / 倒计时 / 正计时页（首页）
;(function () {
  const C = 2 * Math.PI * 122 // 圆环周长
  const CHIPS = [5, 10, 15, 20, 25, 30, 45, 60] // 倒计时快捷分钟

  function phaseColor(st) {
    if (st.mode === 'countdown') return 'var(--accent)'
    if (st.mode === 'stopwatch') return 'var(--blue)'
    return st.phase === 'focus' ? 'var(--accent)' : st.phase === 'short' ? 'var(--green)' : 'var(--purple)'
  }

  function subText(st, taskTitle) {
    if (st.mode === 'pomodoro') {
      if (st.phase === 'focus') return taskTitle ? `任务 · ${taskTitle}` : '专注时间'
      return st.phase === 'short' ? '短休一下 ☕' : '好好长休 🛋️'
    }
    return st.mode === 'countdown' ? '倒计时' : '正计时'
  }

  App.pages.timer = {
    init(root) {
      this.root = root
      root.innerHTML = `
        <div class="timer-wrap">
          <div class="seg timer-mode">
            <button class="seg-item active" data-mode="pomodoro">番茄钟</button>
            <button class="seg-item" data-mode="countdown">倒计时</button>
            <button class="seg-item" data-mode="stopwatch">正计时</button>
          </div>
          <div class="ring-box">
            <svg width="264" height="264" viewBox="0 0 264 264">
              <circle class="ring-track" cx="132" cy="132" r="122" fill="none" stroke-width="10"/>
              <circle class="ring-progress" id="tm-ring" cx="132" cy="132" r="122" fill="none"
                stroke-width="10" stroke-linecap="round" stroke-dasharray="0 ${C}"/>
            </svg>
            <div class="ring-center">
              <div class="ring-time" id="tm-time">25:00</div>
              <div class="ring-sub" id="tm-sub">专注时间</div>
            </div>
          </div>
          <div class="cycle-dots" id="tm-dots"></div>
          <div class="timer-task" id="tm-task-row">
            <span class="text-2" style="font-size:12px;flex:none">当前任务</span>
            <span id="tm-task-host" style="flex:1;display:flex;min-width:0"></span>
          </div>
          <div class="dur-chips" id="tm-durs"></div>
          <div class="timer-controls">
            <button class="btn-round btn-round-sub" id="tm-reset">重置</button>
            <button class="btn-round btn-round-main" id="tm-main">开始</button>
            <button class="btn-round btn-round-sub" id="tm-skip">跳过</button>
          </div>
          <div class="timer-stats" id="tm-stats"></div>
        </div>`

      root.querySelector('.timer-mode').addEventListener('click', (e) => {
        const b = e.target.closest('.seg-item')
        if (b) timeAPI.timer.control('mode', b.dataset.mode)
      })

      root.querySelector('#tm-durs').addEventListener('click', (e) => {
        const b = e.target.closest('.dur-chip')
        if (b) timeAPI.timer.control('countdownDuration', +b.dataset.min * 60_000)
      })

      root.querySelector('#tm-main').onclick = () => timeAPI.timer.control((this.st && this.st.running) ? 'pause' : 'start')
      root.querySelector('#tm-reset').onclick = () => timeAPI.timer.control('reset')
      root.querySelector('#tm-skip').onclick = () => timeAPI.timer.control('skip')

      this._taskW = Widgets.select({
        options: [{ value: '', label: '不关联任务' }],
        value: '',
        className: 'fill',
        placeholder: '不关联任务',
        onChange: (v) => {
          const t = Data.todos.find((x) => x.id === v)
          timeAPI.timer.control('task', { id: v || null, title: t ? t.title : null })
        },
      })
      root.querySelector('#tm-task-host').appendChild(this._taskW.root)

      Data.on('todos', () => this.renderTasks())
      Data.on('sessions', () => this.renderStats())
      timeAPI.on('timer:state', (st) => this.render(st))
      this.st = null
      timeAPI.timer.state().then((st) => this.render(st))
    },

    show() {
      this.renderTasks()
      this.renderStats()
    },

    render(st) {
      this.st = st
      const root = this.root
      const isStopwatch = st.mode === 'stopwatch'
      const isFocusBreak = st.mode === 'pomodoro'
      const ms = isStopwatch ? st.elapsedMs : st.remainingMs

      root.querySelector('#tm-time').textContent = App.fmtMS(ms)
      root.querySelector('#tm-sub').textContent = subText(st, st.taskTitle)
      root.querySelector('#tm-time').style.color = st.running ? phaseColor(st) : 'var(--text)'

      // 圆环进度：倒计时类随时间消耗填充；正计时不画进度
      const ring = root.querySelector('#tm-ring')
      if (isStopwatch) {
        ring.setAttribute('visibility', 'hidden')
      } else {
        const frac = st.durationMs > 0 ? Math.min(1, Math.max(0, 1 - st.remainingMs / st.durationMs)) : 0
        ring.style.stroke = phaseColor(st)
        // frac=0 时隐藏整条弧：圆头端帽在零长度 dash 上仍会画出一个点
        ring.setAttribute('visibility', frac > 0 ? 'visible' : 'hidden')
        ring.setAttribute('stroke-dasharray', `${(frac * C).toFixed(2)} ${C}`)
      }

      // 模式切换
      root.querySelectorAll('.timer-mode .seg-item').forEach((b) => b.classList.toggle('active', b.dataset.mode === st.mode))

      // 番茄周期圆点
      const dots = root.querySelector('#tm-dots')
      const cyc = Data.settings.cyclesBeforeLong || 4
      const filled = st.cycleCount === 0 ? 0 : ((st.cycleCount - 1) % cyc) + 1
      dots.innerHTML = Array.from({ length: cyc }, (_, i) => `<span class="cycle-dot${i < filled ? ' done' : ''}"></span>`).join('')
      dots.style.display = isFocusBreak ? '' : 'none'

      // 任务选择仅番茄钟模式
      root.querySelector('#tm-task-row').style.display = isFocusBreak ? '' : 'none'

      // 倒计时时长筹码
      const durs = root.querySelector('#tm-durs')
      durs.style.display = st.mode === 'countdown' ? '' : 'none'
      durs.innerHTML = CHIPS.map(
        (m) => `<button class="dur-chip${st.durationMs === m * 60_000 ? ' on' : ''}" data-min="${m}" ${st.running ? 'disabled' : ''}>${m} 分</button>`
      ).join('')

      // 控制按钮
      const main = root.querySelector('#tm-main')
      let label
      if (st.running) label = '暂停'
      else if (isStopwatch) label = st.elapsedMs > 0 ? '继续' : '开始'
      else label = st.remainingMs != null && st.remainingMs < st.durationMs ? '继续' : '开始'
      main.textContent = label
      root.querySelector('#tm-reset').textContent = isStopwatch ? '停止记录' : '重置'
      root.querySelector('#tm-skip').style.display = isStopwatch ? 'none' : ''

      this.renderTasks()
    },

    renderTasks() {
      const st = this.st
      if (!st) return
      const open = Data.todos.filter((t) => !t.done)
      const opts = [{ value: '', label: '不关联任务' }]
      for (const t of open) opts.push({ value: t.id, label: t.title })
      // 已完成/已删除但仍在引擎状态里的任务也保留显示，避免选中项消失
      if (st.taskId && !opts.some((o) => o.value === st.taskId)) {
        const t = Data.todos.find((x) => x.id === st.taskId)
        if (t) opts.push({ value: t.id, label: t.title })
      }
      this._taskW.setOptions(opts)
      this._taskW.set(st.taskId || '')
    },

    renderStats() {
      const today = DU.dateKey(new Date())
      const todaySessions = Data.sessions.filter((s) => s.completed && DU.dateKey(new Date(s.start)) === today)
      const minutes = Math.round(todaySessions.reduce((a, s) => a + s.durationMs, 0) / 60_000)
      const tomatoes = todaySessions.filter((s) => s.mode === 'pomodoro').length
      this.root.querySelector('#tm-stats').innerHTML = `
        <div class="stat-pill"><b>${minutes}</b><span>今日专注（分钟）</span></div>
        <div class="stat-pill"><b>${tomatoes}</b><span>今日番茄</span></div>`
    },
  }
})()

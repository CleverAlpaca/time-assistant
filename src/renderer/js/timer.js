// 番茄钟 / 倒计时 / 正计时页（首页）
;(function () {
  const C = 2 * Math.PI * 122 // 圆环周长
  const DEFAULT_PRESETS = [5, 10, 15, 20, 25, 30, 45, 60].map((m) => ({ ms: m * 60_000, label: '' }))

  // 时长标签：整分「5 分」；含秒「1 分 30 秒」；含毫秒「1.25 秒」「999 毫秒」
  function fmtDur(ms) {
    const m = Math.floor(ms / 60_000)
    const rem = ms % 60_000
    if (rem === 0) return `${m} 分`
    const s = rem / 1000
    if (m === 0 && s < 1) return `${Math.round(ms)} 毫秒`
    const sTxt = String(+s.toFixed(3))
    return m === 0 ? `${sTxt} 秒` : Number.isInteger(s) ? `${m} 分 ${s} 秒` : `${m} 分 ${sTxt} 秒`
  }

  // 倒计时长项列表：存 settings.countdownPresets（[{ms, label}]，升序）；未配置时用默认八项
  function getPresets() {
    const list = Data.settings.countdownPresets
    return Array.isArray(list) ? list : DEFAULT_PRESETS
  }
  function savePresets(list) {
    // 先同步落地本地副本：连续编辑（删旧+存新）时下一次 getPresets 必须读到最新值，
    // 否则会基于过期列表重复写入；异步 IPC 完成后回写的 settings 与本地一致，幂等
    Data.settings = { ...Data.settings, countdownPresets: list }
    Data.setSettings({ countdownPresets: list })
  }
  function upsertPreset(ms, label) {
    const list = getPresets()
    const i = list.findIndex((p) => p.ms === ms)
    if (i >= 0) {
      list[i] = { ms, label: label || '' }
    } else {
      if (list.length >= 12) return false
      list.push({ ms, label: label || '' })
      list.sort((a, b) => a.ms - b.ms)
    }
    savePresets(list)
    return true
  }
  function removePreset(ms) {
    savePresets(getPresets().filter((p) => p.ms !== ms))
  }

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
    return st.mode === 'countdown' ? st.label || '倒计时' : '正计时'
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
            <button class="btn-round btn-round-sub" id="tm-third" title="跳过当前段">跳过</button>
          </div>
          <div class="timer-stats" id="tm-stats"></div>
        </div>`

      root.querySelector('.timer-mode').addEventListener('click', (e) => {
        const b = e.target.closest('.seg-item')
        if (b) timeAPI.timer.control('mode', b.dataset.mode)
      })

      root.querySelector('#tm-durs').addEventListener('click', (e) => {
        const b = e.target.closest('.dur-chip')
        if (!b) return
        const ms = +b.dataset.ms
        // 已选中项再次左键 = 打开修改弹窗（右键任意项随时可用）
        if (this.st && this.st.durationMs === ms) {
          const sel = getPresets().find((x) => x.ms === ms)
          if (sel) this.openCustomCountdown(sel)
          return
        }
        const p = getPresets().find((x) => x.ms === ms)
        timeAPI.timer.control('countdownDuration', ms)
        timeAPI.timer.control('countdownLabel', p && p.label ? p.label : null)
      })
      // 右键时长项：修改（弹窗内可删除）
      root.querySelector('#tm-durs').addEventListener('contextmenu', (e) => {
        const b = e.target.closest('.dur-chip')
        if (!b || (this.st && this.st.running)) return
        e.preventDefault()
        const p = getPresets().find((x) => x.ms === +b.dataset.ms)
        if (p) this.openCustomCountdown(p)
      })

      root.querySelector('#tm-main').onclick = () => timeAPI.timer.control((this.st && this.st.running) ? 'pause' : 'start')
      root.querySelector('#tm-reset').onclick = () => timeAPI.timer.control('reset')
      root.querySelector('#tm-third').onclick = () => {
        // 倒计时模式下第三颗按钮是「新增」（自定义时长与备注）；番茄钟保持「跳过」
        if (this.st && this.st.mode === 'countdown') this.openCustomCountdown()
        else timeAPI.timer.control('skip')
      }

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

      // 倒计时时长项（点击使用 · 右键修改/删除）
      const durs = root.querySelector('#tm-durs')
      durs.style.display = st.mode === 'countdown' ? '' : 'none'
      durs.innerHTML = getPresets()
        .map(
          (p) =>
            `<button class="dur-chip${st.durationMs === p.ms ? ' on' : ''}" data-ms="${p.ms}" title="点击使用 · 右键修改或删除" ${st.running ? 'disabled' : ''}>${App.esc(fmtDur(p.ms))}</button>`
        )
        .join('')

      // 控制按钮
      const main = root.querySelector('#tm-main')
      let label
      if (st.running) label = '暂停'
      else if (isStopwatch) label = st.elapsedMs > 0 ? '继续' : '开始'
      else label = st.remainingMs != null && st.remainingMs < st.durationMs ? '继续' : '开始'
      main.textContent = label
      root.querySelector('#tm-reset').textContent = isStopwatch ? '停止记录' : '重置'
      const third = root.querySelector('#tm-third')
      if (isStopwatch) {
        third.style.display = 'none'
      } else {
        third.style.display = ''
        const isCd = st.mode === 'countdown'
        third.textContent = isCd ? '新增' : '跳过'
        third.disabled = isCd && st.running
        third.title = isCd ? '自定义倒计时时长与备注' : '跳过当前段'
      }

      this.renderTasks()
    },

    // 「新增」（preset 为空）或右键「修改」倒计时项：时长精确到毫秒，备注覆盖环形下方的「倒计时」文字；
    // 新增的时工会保存进时长项列表
    openCustomCountdown(preset) {
      const st = this.st
      if (!st || st.mode !== 'countdown' || st.running) return
      const cur = preset ? preset.ms : st.durationMs || 25 * 60_000
      const min0 = Math.floor(cur / 60_000)
      const sec0 = Math.floor((cur % 60_000) / 1000)
      const ms0 = cur % 1000
      const label0 = preset ? preset.label || '' : st.label || ''
      const body = App.el(`
        <div>
          <div class="form-row"><label>时长</label>
            <div style="display:flex;gap:8px;align-items:center">
              <input class="input" id="fm-cd-min" type="number" min="0" max="599" step="1" value="${min0}" style="width:72px">
              <span class="text-2">分</span>
              <input class="input" id="fm-cd-sec" type="number" min="0" max="59" step="1" value="${sec0}" style="width:72px">
              <span class="text-2">秒</span>
              <input class="input" id="fm-cd-ms" type="number" min="0" max="999" step="1" value="${ms0}" style="width:84px">
              <span class="text-2">毫秒</span>
            </div>
          </div>
          <div class="form-row"><label>备注</label>
            <input class="input" id="fm-cd-label" maxlength="12" placeholder="留空则显示「倒计时」" value="${App.esc(label0)}">
          </div>
          ${preset ? '' : '<div class="text-2" style="font-size:12px;margin-top:-4px">保存后加入上方时长项，右键可修改或删除</div>'}
        </div>`)
      // 悬停时长输入框滚动滚轮 = 增/减（毫秒步进 50，其余 1）
      const bindWheel = (id, max) => {
        const el = body.querySelector(id)
        el.addEventListener(
          'wheel',
          (e) => {
            e.preventDefault()
            const step = id === '#fm-cd-ms' ? 50 : 1
            const cur = Math.floor(+el.value || 0)
            const next = Math.min(max, Math.max(0, cur + (e.deltaY < 0 ? step : -step)))
            if (next !== cur) el.value = next
          },
          { passive: false }
        )
      }
      bindWheel('#fm-cd-min', 599)
      bindWheel('#fm-cd-sec', 59)
      bindWheel('#fm-cd-ms', 999)
      const actions = [
        {
          label: '保存',
          onClick: (close) => {
            const min = Math.max(0, Math.floor(+body.querySelector('#fm-cd-min').value || 0))
            const sec = Math.max(0, Math.floor(+body.querySelector('#fm-cd-sec').value || 0))
            const msPart = Math.max(0, Math.floor(+body.querySelector('#fm-cd-ms').value || 0))
            const ms = min * 60_000 + sec * 1000 + msPart
            if (ms <= 0) return App.toast({ title: '请输入倒计时时长' })
            const label = body.querySelector('#fm-cd-label').value.trim()
            timeAPI.timer.control('countdownDuration', ms)
            timeAPI.timer.control('countdownLabel', label || null)
            if (preset) {
              removePreset(preset.ms)
              upsertPreset(ms, label)
            } else if (!upsertPreset(ms, label)) {
              App.toast({ title: '时长项最多保存 12 个' })
            }
            close()
          },
        },
      ]
      if (preset) {
        actions.unshift({
          label: '删除',
          class: 'btn-danger',
          onClick: (close) => {
            removePreset(preset.ms)
            close()
          },
        })
      }
      App.modal({ title: preset ? '修改倒计时项' : '自定义倒计时', body, actions })
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

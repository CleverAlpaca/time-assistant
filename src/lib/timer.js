// 计时引擎：番茄钟（专注/短休/长休相位循环）、自由倒计时、正计时
// 运行于主进程 —— 三组计时器互相独立、可并行运行，互不打断；
// view 只是「当前页面正在查看/控制哪个计时器」，切换视图不影响任何计时任务
class TimerEngine {
  constructor({ getSettings, onSession, onNotify, onStateChange }) {
    this.getSettings = getSettings
    this.onSession = onSession
    this.onNotify = onNotify
    this.onStateChange = onStateChange

    this.view = 'pomodoro' // pomodoro | countdown | stopwatch（页面视图）
    this.timers = {
      pomodoro: this.freshPomodoro(),
      countdown: { durationMs: 25 * 60_000, label: null, running: false, endsAt: null, remaining: null, segmentStart: null },
      stopwatch: { elapsedMs: 0, running: false, lastTick: null, segmentStart: null },
    }
  }

  freshPomodoro() {
    const s = this.getSettings()
    return {
      phase: 'focus', // focus | short | long
      cycleCount: 0, // 本轮已完成专注数（用于长休节奏）
      task: { id: null, title: null },
      durationMs: s.focusMin * 60_000,
      running: false,
      endsAt: null, // 运行中的到期时刻
      remaining: null, // 暂停时剩余 ms（null = 未开始）
      segmentStart: null,
    }
  }

  // 该计时器是否还有「任务」在侧栏展示（重置/停止记录后消失，完成自然消失）
  hasState(key) {
    const t = this.timers[key]
    if (key === 'pomodoro') return t.running || t.remaining != null || t.cycleCount > 0
    if (key === 'countdown') return t.running || t.remaining != null
    return t.running || t.elapsedMs > 0
  }

  // ---- 对外状态快照：view 模式的完整状态 + 侧栏条目（所有进行中/暂停的计时任务） ----
  snapshot(now = Date.now()) {
    const key = this.view
    const t = this.timers[key]
    let base
    if (key === 'stopwatch') {
      const elapsed = t.running ? t.elapsedMs + (now - (t.lastTick ?? now)) : t.elapsedMs
      base = { elapsedMs: elapsed, remainingMs: elapsed, durationMs: 0 }
    } else {
      const remainingMs = t.running ? Math.max(0, t.endsAt - now) : t.remaining ?? t.durationMs
      base = { remainingMs, durationMs: t.durationMs, elapsedMs: t.durationMs - remainingMs }
    }
    const modeState =
      key === 'pomodoro'
        ? { phase: t.phase, cycleCount: t.cycleCount, taskId: t.task.id, taskTitle: t.task.title, label: null }
        : key === 'countdown'
          ? { phase: null, cycleCount: 0, taskId: null, taskTitle: null, label: t.label }
          : { phase: null, cycleCount: 0, taskId: null, taskTitle: null, label: null }
    return { mode: key, view: key, running: t.running, ...modeState, ...base, sidebar: this.sidebar(now) }
  }

  // 侧栏条目：有任务的计时器（运行中/暂停），点击可跳转对应页面
  sidebar(now = Date.now()) {
    const out = []
    const p = this.timers.pomodoro
    if (this.hasState('pomodoro')) {
      const ms = p.running ? Math.max(0, p.endsAt - now) : p.remaining ?? p.durationMs
      const title = p.phase === 'focus' ? (p.running ? '专注中' : '专注') : p.phase === 'short' ? '短休' : '长休'
      out.push({ mode: 'pomodoro', running: p.running, phase: p.phase, title, ms })
    }
    const c = this.timers.countdown
    if (this.hasState('countdown')) {
      const ms = c.running ? Math.max(0, c.endsAt - now) : c.remaining ?? c.durationMs
      out.push({ mode: 'countdown', running: c.running, phase: null, title: c.label || '倒计时', ms })
    }
    const w = this.timers.stopwatch
    if (this.hasState('stopwatch')) {
      const ms = w.running ? w.elapsedMs + (now - (w.lastTick ?? now)) : w.elapsedMs
      out.push({ mode: 'stopwatch', running: w.running, phase: null, title: '正计时', ms })
    }
    return out
  }

  // ---- 驱动：三组计时器全部推进，后台到点照常结算并提醒 ----
  tick() {
    const now = Date.now()
    const p = this.timers.pomodoro
    if (p.running && now >= p.endsAt) this.completePomodoro(now)
    const c = this.timers.countdown
    if (c.running && now >= c.endsAt) this.completeCountdown(now)
    const w = this.timers.stopwatch
    if (w.running) {
      w.elapsedMs += now - (w.lastTick ?? now)
      w.lastTick = now
    }
    this.onStateChange(this.snapshot(now))
  }

  control(action, arg) {
    const key = this.view
    switch (action) {
      case 'start':
        this.startTimer(key)
        break
      case 'pause':
        this.pauseTimer(key)
        break
      case 'reset':
        this.resetTimer(key)
        break
      case 'skip':
        this.skipTimer(key)
        break
      case 'mode':
        // 纯视图切换：不暂停、不清空，其他计时器继续在后台运行
        if (['pomodoro', 'countdown', 'stopwatch'].includes(arg)) this.view = arg
        break
      case 'countdownDuration':
        if (this.view === 'countdown' && !this.timers.countdown.running) {
          this.timers.countdown.durationMs = arg
          this.timers.countdown.remaining = null
        }
        break
      case 'countdownLabel':
        if (this.view === 'countdown') this.timers.countdown.label = (typeof arg === 'string' && arg.trim()) || null
        break
      case 'task':
        this.timers.pomodoro.task = { id: arg?.id ?? null, title: arg?.title ?? null }
        break
    }
    this.onStateChange(this.snapshot())
  }

  startTimer(key, now = Date.now()) {
    const t = this.timers[key]
    if (t.running) return
    if (key === 'stopwatch') {
      t.lastTick = now
      t.running = true
      t.segmentStart ??= now
      return
    }
    t.remaining ??= t.durationMs
    if (t.remaining <= 0) t.remaining = t.durationMs
    t.endsAt = now + t.remaining
    t.segmentStart ??= now
    t.running = true
  }

  pauseTimer(key) {
    const t = this.timers[key]
    if (!t.running) return
    const now = Date.now()
    if (key === 'stopwatch') {
      t.elapsedMs += now - (t.lastTick ?? now)
      t.lastTick = null
    } else {
      t.remaining = Math.max(0, t.endsAt - now)
    }
    t.running = false
  }

  // 重置/停止记录：清空该计时器任务（侧栏条目随之消失）
  resetTimer(key) {
    const t = this.timers[key]
    this.abandonLog(key)
    if (key === 'pomodoro') {
      const task = t.task
      this.timers.pomodoro = this.freshPomodoro()
      this.timers.pomodoro.task = task
    } else if (key === 'countdown') {
      // 时长与备注是配置，保留；只清运行任务
      t.running = false
      t.remaining = null
      t.endsAt = null
      t.segmentStart = null
    } else {
      t.running = false
      t.elapsedMs = 0
      t.lastTick = null
      t.segmentStart = null
    }
  }

  skipTimer(key) {
    if (key === 'pomodoro') {
      const t = this.timers.pomodoro
      if (t.phase === 'focus') {
        this.abandonLog('pomodoro')
        this.advanceToBreak()
      } else {
        this.toFocusPhase()
      }
    } else {
      // 倒计时跳过 = 放弃本段；正计时跳过 = 停止记录
      this.resetTimer(key)
    }
  }

  completePomodoro(now) {
    const t = this.timers.pomodoro
    t.running = false
    t.remaining = null
    t.segmentStart = null
    if (t.phase === 'focus') {
      this.logSession('pomodoro', { start: t.segmentStart, end: now, durationMs: t.durationMs, completed: true })
      t.cycleCount += 1
      this.notify('专注完成 🍅', t.task.title ? `「${t.task.title}」已专注 ${Math.round(t.durationMs / 60_000)} 分钟` : `专注 ${Math.round(t.durationMs / 60_000)} 分钟完成`)
      this.advanceToBreak(now)
    } else {
      if (t.phase === 'long') t.cycleCount = 0
      this.notify('休息结束', '准备开始下一轮专注')
      this.toFocusPhase(now)
    }
  }

  completeCountdown(now) {
    const t = this.timers.countdown
    t.running = false
    t.remaining = null
    t.segmentStart = null
    if (t.durationMs >= 60_000) {
      this.logSession('countdown', { start: t.segmentStart, end: now, durationMs: t.durationMs, completed: true })
    }
    const mins = Math.floor(t.durationMs / 60_000)
    const rem = t.durationMs % 60_000
    const secs = Math.floor(rem / 1000)
    const msPart = rem % 1000
    let durTxt
    if (rem === 0) durTxt = `${mins} 分钟`
    else if (msPart === 0) durTxt = mins > 0 ? `${mins} 分 ${secs} 秒` : `${secs} 秒`
    else durTxt = mins > 0 ? `${mins} 分 ${secs} 秒 ${msPart} 毫秒` : `${secs} 秒 ${msPart} 毫秒`
    this.notify('倒计时结束', t.label ? `「${t.label}」 ${durTxt}` : `时长 ${durTxt}`)
  }

  advanceToBreak(now = Date.now()) {
    const t = this.timers.pomodoro
    const s = this.getSettings()
    t.phase = t.cycleCount > 0 && t.cycleCount % s.cyclesBeforeLong === 0 ? 'long' : 'short'
    t.segmentStart = null
    t.remaining = null
    t.endsAt = null
    t.running = false
    t.durationMs = (t.phase === 'short' ? s.shortBreakMin : s.longBreakMin) * 60_000
    const breakMin = Math.round(t.durationMs / 60_000)
    if (s.autoStartBreak) {
      this.startTimer('pomodoro', now)
      this.notify(`开始${t.phase === 'long' ? '长' : '短'}休`, `休息 ${breakMin} 分钟，到点提醒你`)
    } else {
      this.notify('专注完成，该休息了', `建议休息 ${breakMin} 分钟`)
    }
  }

  toFocusPhase(now = Date.now()) {
    const t = this.timers.pomodoro
    const s = this.getSettings()
    t.phase = 'focus'
    t.segmentStart = null
    t.remaining = null
    t.endsAt = null
    t.running = false
    t.durationMs = s.focusMin * 60_000
    if (s.autoStartNextFocus) this.startTimer('pomodoro', now)
  }

  // 中断/重置时：专注段已进行 ≥60s 则以 completed:false 计入统计（暂停态按剩余量折算）
  abandonLog(key) {
    const t = this.timers[key]
    if (!t.segmentStart) return
    const now = Date.now()
    if (key === 'stopwatch') {
      const elapsed = t.running ? t.elapsedMs + (now - (t.lastTick ?? now)) : t.elapsedMs
      if (elapsed >= 60_000) {
        this.logSession('stopwatch', { start: t.segmentStart, end: now, durationMs: elapsed, completed: true })
      }
      return
    }
    const isFocusish = key === 'countdown' || t.phase === 'focus'
    if (!isFocusish) return
    const elapsed = t.running
      ? t.durationMs - Math.max(0, t.endsAt - now)
      : t.remaining != null
        ? t.durationMs - t.remaining
        : 0
    if (elapsed >= 60_000) {
      this.logSession(key, { start: t.segmentStart, end: now, durationMs: elapsed, completed: false })
    }
  }

  logSession(key, { start, end, durationMs, completed }) {
    const p = this.timers.pomodoro
    this.onSession({
      mode: key,
      title: key === 'pomodoro' ? p.task.title || '专注' : key === 'countdown' ? '倒计时专注' : '正计时专注',
      taskId: key === 'pomodoro' ? p.task.id : null,
      start,
      end,
      durationMs,
      completed,
    })
  }

  notify(title, body) {
    this.onNotify({ title, body, kind: 'timer' })
  }
}

module.exports = { TimerEngine }

// 计时引擎：番茄钟（专注/短休/长休相位循环）、自由倒计时、正计时
// 运行于主进程 —— 切页/最小化到托盘不中断，是计时状态的唯一数据源
class TimerEngine {
  constructor({ getSettings, onSession, onNotify, onStateChange }) {
    this.getSettings = getSettings
    this.onSession = onSession
    this.onNotify = onNotify
    this.onStateChange = onStateChange

    this.mode = 'pomodoro' // pomodoro | countdown | stopwatch
    this.phase = 'focus' // pomodoro 相位：focus | short | long
    this.running = false
    this.endsAt = null // 倒计时类：运行中的到期时刻
    this.remaining = null // 倒计时类：暂停时剩余 ms（null = 未开始）
    this.durationMs = 0 // 当前段总时长
    this.elapsedMs = 0 // 正计时累计
    this.lastTick = null
    this.cycleCount = 0 // 本轮已完成专注数（用于长休节奏）
    this.task = { id: null, title: null }
    this.label = null // 倒计时自定义备注（覆盖「倒计时」文字显示）
    this.segmentStart = null

    this.applyPhaseDefaults()
  }

  applyPhaseDefaults() {
    const s = this.getSettings()
    this.durationMs =
      this.mode === 'countdown'
        ? this.durationMs || 25 * 60_000
        : this.phase === 'focus'
          ? s.focusMin * 60_000
          : this.phase === 'short'
            ? s.shortBreakMin * 60_000
            : s.longBreakMin * 60_000
  }

  // ---- 对外状态快照 ----
  snapshot(now = Date.now()) {
    let remainingMs
    if (this.mode === 'stopwatch') {
      const elapsed = this.running ? this.elapsedMs + (now - this.lastTick) : this.elapsedMs
      return this.pack({ elapsedMs: elapsed, remainingMs: elapsed })
    }
    if (this.running) remainingMs = Math.max(0, this.endsAt - now)
    else remainingMs = this.remaining ?? this.durationMs
    return this.pack({ remainingMs, elapsedMs: this.durationMs - remainingMs })
  }

  pack(extra) {
    return {
      mode: this.mode,
      phase: this.mode === 'pomodoro' ? this.phase : null,
      running: this.running,
      durationMs: this.durationMs,
      cycleCount: this.cycleCount,
      taskId: this.task.id,
      taskTitle: this.task.title,
      label: this.label,
      ...extra,
    }
  }

  // ---- 驱动 ----
  tick() {
    const now = Date.now()
    if (this.running && this.mode === 'stopwatch') {
      this.elapsedMs += now - this.lastTick
      this.lastTick = now
    } else if (this.running && now >= this.endsAt) {
      this.complete()
    }
    this.onStateChange(this.snapshot(now))
  }

  control(action, arg) {
    switch (action) {
      case 'start':
        this.start()
        break
      case 'pause':
        this.pause()
        break
      case 'reset':
        this.reset()
        break
      case 'skip':
        this.skip()
        break
      case 'mode':
        this.setMode(arg)
        break
      case 'countdownDuration':
        if (!this.running && this.mode === 'countdown') {
          this.durationMs = arg
          this.remaining = null
        }
        break
      case 'countdownLabel':
        if (this.mode === 'countdown') this.label = (typeof arg === 'string' && arg.trim()) || null
        break
      case 'task':
        this.task = { id: arg?.id ?? null, title: arg?.title ?? null }
        break
    }
    this.onStateChange(this.snapshot())
  }

  start() {
    if (this.running) return
    const now = Date.now()
    if (this.mode === 'stopwatch') {
      this.lastTick = now
      this.running = true
      this.segmentStart ??= now
      return
    }
    this.remaining ??= this.durationMs
    if (this.remaining <= 0) this.remaining = this.durationMs
    this.endsAt = now + this.remaining
    this.segmentStart ??= now
    this.running = true
  }

  pause() {
    if (!this.running) return
    const now = Date.now()
    if (this.mode === 'stopwatch') {
      this.elapsedMs += now - this.lastTick
      this.lastTick = null
    } else {
      this.remaining = Math.max(0, this.endsAt - now)
    }
    this.running = false
  }

  reset() {
    this.abandonLog()
    this.running = false
    this.remaining = null
    this.elapsedMs = 0
    this.lastTick = null
    this.segmentStart = null
    this.applyPhaseDefaults()
  }

  skip() {
    // 跳过当前段：专注段视为中断（部分计入），休息段/倒计时直接进入下一段
    if (this.mode === 'pomodoro') {
      if (this.phase === 'focus') {
        this.abandonLog()
        this.advanceToBreak()
      } else {
        this.toFocusPhase()
      }
    } else if (this.mode === 'countdown') {
      this.abandonLog()
      this.running = false
      this.remaining = null
      this.segmentStart = null
    } else {
      this.reset()
    }
  }

  complete() {
    const now = Date.now()
    this.running = false
    this.remaining = null
    if (this.mode === 'pomodoro') {
      if (this.phase === 'focus') {
        this.logSession({ start: this.segmentStart, end: now, durationMs: this.durationMs, completed: true })
        this.cycleCount += 1
        this.notify('专注完成 🍅', this.task.title ? `「${this.task.title}」已专注 ${Math.round(this.durationMs / 60_000)} 分钟` : `专注 ${Math.round(this.durationMs / 60_000)} 分钟完成`)
        this.advanceToBreak()
      } else {
        if (this.phase === 'long') this.cycleCount = 0
        this.notify('休息结束', '准备开始下一轮专注')
        this.toFocusPhase()
      }
    } else if (this.mode === 'countdown') {
      if (this.durationMs >= 60_000) {
        this.logSession({ start: this.segmentStart, end: now, durationMs: this.durationMs, completed: true })
      }
      const mins = Math.floor(this.durationMs / 60_000)
      const secs = Math.round((this.durationMs % 60_000) / 1000)
      const durTxt = secs > 0 ? (mins > 0 ? `${mins} 分 ${secs} 秒` : `${secs} 秒`) : `${mins} 分钟`
      this.notify('倒计时结束', this.label ? `「${this.label}」 ${durTxt}` : `时长 ${durTxt}`)
      this.segmentStart = null
    }
    // 正计时不会自然结束
  }

  advanceToBreak() {
    const s = this.getSettings()
    this.phase = this.cycleCount > 0 && this.cycleCount % s.cyclesBeforeLong === 0 ? 'long' : 'short'
    this.segmentStart = null
    this.applyPhaseDefaults()
    const breakMin = Math.round(this.durationMs / 60_000)
    if (s.autoStartBreak) {
      this.start()
      this.notify(`开始${this.phase === 'long' ? '长' : '短'}休`, `休息 ${breakMin} 分钟，到点提醒你`)
    } else {
      this.notify(`专注完成，该休息了`, `建议休息 ${breakMin} 分钟`)
    }
  }

  toFocusPhase() {
    this.phase = 'focus'
    this.segmentStart = null
    this.applyPhaseDefaults()
    const s = this.getSettings()
    if (s.autoStartNextFocus) this.start()
  }

  setMode(mode) {
    if (!['pomodoro', 'countdown', 'stopwatch'].includes(mode)) return
    if (mode === this.mode) return
    this.abandonLog()
    this.mode = mode
    this.phase = 'focus'
    this.running = false
    this.remaining = null
    this.elapsedMs = 0
    this.lastTick = null
    this.segmentStart = null
    if (mode !== 'countdown') {
      this.durationMs = 0
      this.label = null
    }
    this.applyPhaseDefaults()
  }

  // 中断/重置时：专注段已进行 ≥60s 则以 completed:false 计入统计
  abandonLog() {
    if (!this.segmentStart) return
    const now = Date.now()
    if (this.mode === 'stopwatch') {
      const elapsed = this.running ? this.elapsedMs + (now - this.lastTick) : this.elapsedMs
      if (elapsed >= 60_000) {
        this.logSession({ start: this.segmentStart, end: now, durationMs: elapsed, completed: true })
      }
      return
    }
    const isFocusish = this.mode === 'countdown' || this.phase === 'focus'
    if (!isFocusish || !this.running) return
    const elapsed = this.durationMs - Math.max(0, this.endsAt - now)
    if (elapsed >= 60_000) {
      this.logSession({ start: this.segmentStart, end: now, durationMs: elapsed, completed: false })
    }
  }

  logSession({ start, end, durationMs, completed }) {
    this.onSession({
      mode: this.mode,
      title: this.mode === 'pomodoro' ? this.task.title || '专注' : this.mode === 'countdown' ? '倒计时专注' : '正计时专注',
      taskId: this.mode === 'pomodoro' ? this.task.id : null,
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

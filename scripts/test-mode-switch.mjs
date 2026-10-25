// 引擎模式切换状态保留测试（node scripts/test-mode-switch.mjs）
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const assert = require('assert')
const { TimerEngine } = require('../src/lib/timer.js')

const sessions = []
const engine = new TimerEngine({
  getSettings: () => ({ focusMin: 25, shortBreakMin: 5, longBreakMin: 15, cyclesBeforeLong: 4, autoStartBreak: false, autoStartNextFocus: false }),
  onSession: (s) => sessions.push(s),
  onNotify: () => {},
  onStateChange: () => {},
})

// 1. 运行中的倒计时切走再切回：剩余时间保留、暂停态、可继续
engine.control('mode', 'countdown')
engine.control('countdownDuration', 6 * 60_000)
engine.control('start')
engine.endsAt = Date.now() + 357_000 // 模拟已跑 3 秒（剩 5:57）
engine.control('mode', 'stopwatch')
assert.strictEqual(engine.mode, 'stopwatch')
engine.control('mode', 'countdown')
let st = engine.snapshot()
assert.strictEqual(st.mode, 'countdown')
assert.ok(st.remainingMs > 350_000 && st.remainingMs <= 357_000, '倒计时剩余保留，实际 ' + st.remainingMs)
assert.strictEqual(st.running, false)
assert.strictEqual(st.durationMs, 6 * 60_000)
engine.control('start')
st = engine.snapshot()
assert.strictEqual(st.running, true, '切回后可继续')
assert.ok(st.remainingMs <= 357_000)

// 2. 正计时累计跨切换保留
engine.control('mode', 'stopwatch')
engine.control('start')
engine.elapsedMs += 12_345
engine.control('mode', 'countdown')
engine.control('mode', 'stopwatch')
st = engine.snapshot()
assert.ok(st.elapsedMs >= 12_345, '正计时累计保留，实际 ' + st.elapsedMs)
assert.strictEqual(st.running, false)

// 3. 番茄钟专注相位 + 关联任务跨切换保留
engine.control('mode', 'pomodoro')
engine.control('task', { id: 't1', title: '写周报' })
engine.control('start')
engine.endsAt = Date.now() + 20 * 60_000 // 模拟已专注 5 分钟
engine.control('mode', 'countdown')
engine.control('mode', 'pomodoro')
st = engine.snapshot()
assert.strictEqual(st.phase, 'focus')
assert.ok(st.remainingMs <= 20 * 60_000 + 1000 && st.remainingMs > 19 * 60_000, '番茄钟剩余保留，实际 ' + st.remainingMs)
assert.strictEqual(st.taskTitle, '写周报')

// 4. 切回后重置：已专注 ≥60s 以 completed:false 计入（约 5 分钟），不再清零丢失
sessions.length = 0
engine.control('reset')
assert.strictEqual(sessions.length, 1, '应记录中断专注：' + JSON.stringify(sessions))
assert.strictEqual(sessions[0].completed, false)
assert.ok(Math.abs(sessions[0].durationMs - 5 * 60_000) < 5_000, '中断时长 ≈5 分钟，实际 ' + sessions[0].durationMs)

// 5. 倒计时的自定义时长与备注跨切换保留
engine.control('mode', 'countdown')
engine.control('countdownLabel', '泡面')
engine.control('mode', 'stopwatch')
engine.control('mode', 'countdown')
st = engine.snapshot()
assert.strictEqual(st.label, '泡面')
assert.strictEqual(st.durationMs, 6 * 60_000)

// 6. 番茄钟中途切走不产生中断日志（段未结束）
sessions.length = 0
engine.control('start')
engine.control('mode', 'stopwatch')
assert.strictEqual(sessions.length, 0, '切走不应记日志')

console.log('ALL ENGINE TESTS PASSED')

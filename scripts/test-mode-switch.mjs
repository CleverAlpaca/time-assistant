// 引擎并行计时测试（node scripts/test-mode-switch.mjs）
// 三组计时器互相独立：视图切换不打断、后台到点照常结算、侧栏条目随重置/停止消失（新的在上）
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const assert = require('assert')
const { TimerEngine } = require('../src/lib/timer.js')

const sessions = []
const notes = []
const engine = new TimerEngine({
  getSettings: () => ({ focusMin: 25, shortBreakMin: 5, longBreakMin: 15, cyclesBeforeLong: 2, autoStartBreak: true, autoStartNextFocus: false }),
  onSession: (s) => sessions.push(s),
  onNotify: (n) => notes.push(n),
  onStateChange: () => {},
})
const side = (st, m) => (st.sidebar || []).find((x) => x.mode === m)

// 1. 视图切换不打断：倒计时后台继续跑
engine.control('mode', 'countdown')
engine.control('countdownDuration', 6 * 60_000)
engine.control('start')
engine.timers.countdown.endsAt = Date.now() + 357_000 // 模拟已跑 3 秒
engine.control('mode', 'stopwatch') // 纯切视图
let st = engine.snapshot()
assert.strictEqual(st.view, 'stopwatch')
assert.strictEqual(st.mode, 'stopwatch')
let cd = side(st, 'countdown')
assert.ok(cd && cd.running === true, '倒计时在后台继续运行')
assert.ok(cd.ms <= 357_000 && cd.ms > 350_000, '剩余时间正确，实际 ' + (cd && cd.ms))
engine.tick()
st = engine.snapshot()
cd = side(st, 'countdown')
assert.ok(cd && cd.running && cd.ms <= 357_000, 'tick 后仍在倒计')

// 2. 后台到点自动结算：通知 + 会话 + 侧栏条目消失
engine.control('mode', 'pomodoro')
engine.timers.countdown.endsAt = Date.now() - 1
notes.length = 0
sessions.length = 0
engine.tick()
assert.strictEqual(sessions.length, 1, '后台完成记完整会话')
assert.strictEqual(sessions[0].completed, true)
assert.strictEqual(sessions[0].durationMs, 6 * 60_000)
assert.ok(notes.some((n) => n.title === '倒计时结束'), '后台完成弹通知')
st = engine.snapshot()
assert.ok(!side(st, 'countdown'), '完成后侧栏条目消失')

// 3. 暂停的计时器保留在侧栏，切回视图后可继续
engine.control('mode', 'countdown')
engine.control('countdownDuration', 6 * 60_000)
engine.control('start')
engine.control('pause')
st = engine.snapshot()
cd = side(st, 'countdown')
assert.ok(cd && !cd.running && cd.ms > 359_000 && cd.ms <= 360_000, '暂停任务显示在侧栏')
engine.control('mode', 'pomodoro') // 切走
st = engine.snapshot()
assert.ok(side(st, 'countdown'), '切走后暂停任务仍在侧栏')
engine.control('mode', 'countdown')
engine.control('start')
st = engine.snapshot()
assert.strictEqual(st.running, true, '切回后可继续')

// 4. 重置后从侧栏消失（时长/备注配置保留）
engine.control('reset')
st = engine.snapshot()
assert.ok(!side(st, 'countdown'), '重置后条目消失')
assert.strictEqual(engine.timers.countdown.durationMs, 6 * 60_000, '时长配置保留')

// 5. 三组并行：番茄钟专注与计时器同时运行互不干涉（新任务在侧栏上方）
engine.control('mode', 'pomodoro')
engine.control('task', { id: 't1', title: '写周报' })
engine.control('start')
engine.timers.pomodoro.endsAt = Date.now() + 25 * 60_000
engine.control('mode', 'stopwatch')
engine.control('start')
engine.tick()
engine.tick()
st = engine.snapshot()
assert.strictEqual(st.view, 'stopwatch')
assert.ok(st.elapsedMs >= 0 && st.running, '计时器在跑')
const pomo = side(st, 'pomodoro')
assert.ok(pomo && pomo.running && pomo.phase === 'focus', '番茄钟同时在后台跑')
assert.ok(st.sidebar.length === 2, '侧栏两条任务，实际 ' + st.sidebar.length)
assert.strictEqual(st.sidebar[0].mode, 'stopwatch', '新任务排在上面')
assert.strictEqual(st.sidebar[1].mode, 'pomodoro', '旧任务排在下面')
assert.ok(st.elapsedMs < 60_000)

// 6. 番茄钟后台到点：自动进入短休（autoStartBreak=true）+ 记会话 + 周期 +1
sessions.length = 0
notes.length = 0
engine.timers.pomodoro.endsAt = Date.now() - 1
engine.tick()
st = engine.snapshot()
assert.strictEqual(engine.timers.pomodoro.phase, 'short')
assert.strictEqual(engine.timers.pomodoro.cycleCount, 1)
assert.strictEqual(engine.timers.pomodoro.running, true, '自动开始短休')
assert.strictEqual(sessions.length, 1, '专注会话已记录')
assert.strictEqual(sessions[0].completed, true)
assert.ok(notes.some((n) => n.title === '专注完成 🍅'), '专注完成通知')
assert.ok(notes.some((n) => n.title.includes('短休')), '进入短休通知')
assert.ok(side(st, 'pomodoro') && side(st, 'pomodoro').phase === 'short', '侧栏显示短休')

// 7. 计时器停止：≥60s 记 completed:true 并消失；短休不受影响
engine.control('mode', 'stopwatch')
engine.timers.stopwatch.elapsedMs += 90_000
sessions.length = 0
engine.control('reset') // 停止
st = engine.snapshot()
assert.strictEqual(sessions.length, 1, '计时器停止入统计')
assert.strictEqual(sessions[0].completed, true)
assert.ok(sessions[0].durationMs >= 90_000)
assert.ok(!side(st, 'stopwatch'), '停止后条目消失')
assert.ok(side(st, 'pomodoro'), '短休不受影响')

// 8. 重置番茄钟：任务消失、相位与周期归零、关联任务保留
engine.control('mode', 'pomodoro')
engine.control('reset')
st = engine.snapshot()
assert.ok(!side(st, 'pomodoro'), '重置后番茄钟条目消失')
assert.strictEqual(engine.timers.pomodoro.phase, 'focus')
assert.strictEqual(engine.timers.pomodoro.cycleCount, 0)
assert.strictEqual(engine.timers.pomodoro.task.title, '写周报', '关联任务保留')
assert.strictEqual(engine.timers.pomodoro.durationMs, 25 * 60_000)

// 9. 从未开始的计时器不出现在侧栏
assert.strictEqual(engine.snapshot().sidebar.length, 0, '全部清空后侧栏为空')

console.log('ALL ENGINE TESTS PASSED')

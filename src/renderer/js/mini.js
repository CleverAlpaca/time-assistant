// 悬浮计时窗：置顶小窗，显示剩余/累计时间；点击主体回到主窗口
;(function () {
  const $ = (s) => document.querySelector(s)
  const pad = (n) => String(n).padStart(2, '0')

  function fmt(ms, centis) {
    const x = Math.max(0, Math.floor(ms))
    const sec = Math.floor(x / 1000)
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = sec % 60
    const main = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
    // 计时器精确到百分秒；番茄钟/倒计时精确到秒
    return centis ? { main, frac: '.' + String(Math.floor((x % 1000) / 10)).padStart(2, '0') } : { main, frac: '' }
  }

  function render(st) {
    const isStopwatch = st.mode === 'stopwatch'
    const ms = isStopwatch ? st.elapsedMs : st.remainingMs
    const f = fmt(ms, st.mode === 'stopwatch')
    $('#mini-time').innerHTML = f.frac ? `${f.main}<span style="font-size:0.5em">${f.frac}</span>` : f.main
    const name =
      st.mode === 'pomodoro'
        ? st.phase === 'focus'
          ? '专注'
          : st.phase === 'short'
            ? '短休'
            : '长休'
        : st.mode === 'countdown'
          ? '倒计时'
          : '计时器'
    $('#mini-label').textContent = st.running ? name : '已暂停'
    const isBreak = st.mode === 'pomodoro' && st.phase !== 'focus'
    $('#mini-time').style.color = isBreak ? 'var(--green)' : 'var(--accent)'
  }

  async function init() {
    const t = await timeAPI.app.themeState()
    document.documentElement.dataset.theme = t.effective
    timeAPI.on('theme:changed', ({ effective }) => (document.documentElement.dataset.theme = effective))
    timeAPI.on('timer:state', render)
    render(await timeAPI.timer.state())
    $('#mini-close').onclick = () => timeAPI.mini.toggle()
    $('#mini-content').onclick = () => timeAPI.window.show()
  }

  init()
})()

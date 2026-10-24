// 设置页
;(function () {
  function durRow(label, key, { min, max, unit = '分钟', sub = '' }) {
    return `
      <div class="set-row">
        <div class="set-label">${label}${sub ? `<div class="set-sub">${sub}</div>` : ''}</div>
        <div class="dur-input">
          <input class="input" type="number" min="${min}" max="${max}" step="1" data-set="${key}" value="${Data.settings[key]}">
          <span>${unit}</span>
        </div>
      </div>`
  }

  App.pages.settings = {
    init(root) {
      this.root = root
      this.render()
      root.addEventListener('change', (e) => this._onChange(e))
      root.addEventListener('click', (e) => this._onClick(e))
      Data.on('settings', () => this.syncControls())
      timeAPI.app.getAutostart().then((v) => {
        const el = root.querySelector('#set-autostart')
        if (el) el.checked = v
      })
    },

    show() {
      this.syncControls()
    },

    render() {
      const s = Data.settings
      this.root.innerHTML = `
        <div class="page-header"><div><h2>设置</h2></div></div>
        <div class="settings-layout">
          <div class="card settings-card">
            <h3>番茄钟</h3>
            ${durRow('专注时长', 'focusMin', { min: 1, max: 180 })}
            ${durRow('短休时长', 'shortBreakMin', { min: 1, max: 60 })}
            ${durRow('长休时长', 'longBreakMin', { min: 1, max: 90 })}
            ${durRow('长休间隔', 'cyclesBeforeLong', { min: 2, max: 8, unit: '个番茄', sub: '每完成几个番茄进入长休' })}
            <div class="set-row">
              <div class="set-label">休息到点自动开始<div class="set-sub">专注结束后自动进入休息</div></div>
              <label class="switch"><input type="checkbox" data-set="autoStartBreak" ${s.autoStartBreak ? 'checked' : ''}><span class="track"></span></label>
            </div>
            <div class="set-row">
              <div class="set-label">休息结束自动开始下一轮专注</div>
              <label class="switch"><input type="checkbox" data-set="autoStartNextFocus" ${s.autoStartNextFocus ? 'checked' : ''}><span class="track"></span></label>
            </div>
          </div>

          <div class="card settings-card">
            <h3>提醒与通知</h3>
            <div class="set-row">
              <div class="set-label">计时结束提示音<div class="set-sub">应用在前台时播放一段轻提示音</div></div>
              <label class="switch"><input type="checkbox" data-set="soundEnabled" ${s.soundEnabled ? 'checked' : ''}><span class="track"></span></label>
            </div>
          </div>

          <div class="card settings-card">
            <h3>通用</h3>
            <div class="set-row">
              <div class="set-label">外观</div>
              <div class="seg" data-seg="theme">
                <button class="seg-item" data-v="auto">跟随系统</button>
                <button class="seg-item" data-v="light">浅色</button>
                <button class="seg-item" data-v="dark">深色</button>
              </div>
            </div>
            <div class="set-row">
              <div class="set-label">点关闭按钮时</div>
              <div class="seg" data-seg="closeAction">
                <button class="seg-item" data-v="tray">最小化到托盘</button>
                <button class="seg-item" data-v="quit">退出应用</button>
              </div>
            </div>
            <div class="set-row">
              <div class="set-label">最小化到托盘<div class="set-sub">避免 Win10 下透明窗口最小化后任务栏图标空白</div></div>
              <label class="switch"><input type="checkbox" data-set="minimizeToTray" ${s.minimizeToTray ? 'checked' : ''}><span class="track"></span></label>
            </div>
            <div class="set-row">
              <div class="set-label">开机自动启动</div>
              <label class="switch"><input type="checkbox" id="set-autostart"><span class="track"></span></label>
            </div>
            <div class="set-row">
              <div class="set-label">悬浮计时窗<div class="set-sub">置顶显示剩余时间的小窗</div></div>
              <label class="switch"><input type="checkbox" data-set="miniWindow" ${s.miniWindow ? 'checked' : ''}><span class="track"></span></label>
            </div>
          </div>

          <div class="card settings-card">
            <h3>数据与关于</h3>
            <div class="set-row">
              <div class="set-label">数据保存在本机<div class="set-sub">闹钟 / 待办 / 日程 / 专注记录</div></div>
              <button class="btn btn-secondary btn-sm" id="set-open-data">打开数据文件夹</button>
            </div>
            <div style="margin-top:12px">
              <div class="about-row"><span>应用</span><span>时光助手</span></div>
              <div class="about-row"><span>版本</span><span id="set-version">…</span></div>
            </div>
          </div>
        </div>`
      this.syncControls()
      timeAPI.app.getVersion().then((v) => {
        const el = root.querySelector('#set-version')
        if (el) el.textContent = v
      })
    },

    syncControls() {
      const s = Data.settings
      this.root.querySelectorAll('[data-seg]').forEach((seg) => {
        const key = seg.dataset.seg
        seg.querySelectorAll('.seg-item').forEach((b) => b.classList.toggle('active', b.dataset.v === s[key]))
      })
      this.root.querySelectorAll('input[data-set]').forEach((el) => {
        if (el.type === 'checkbox') el.checked = !!s[el.dataset.set]
        else el.value = s[el.dataset.set]
      })
    },

    _onChange(e) {
      const el = e.target
      if (el.id === 'set-autostart') {
        timeAPI.app.setAutostart(el.checked)
        App.toast({ title: el.checked ? '已设置开机自启' : '已关闭开机自启' })
        return
      }
      const key = el.dataset.set
      if (!key) return
      if (el.type === 'checkbox') {
        Data.setSettings({ [key]: el.checked })
      } else if (el.type === 'number') {
        const v = Math.round(+el.value)
        const min = +el.min
        const max = +el.max
        if (!v || v < min || v > max) {
          App.toast({ title: `请输入 ${min}–${max} 之间的数值` })
          el.value = Data.settings[key]
          return
        }
        Data.setSettings({ [key]: v })
      }
    },

    _onClick(e) {
      const segBtn = e.target.closest('[data-seg] .seg-item')
      if (segBtn) {
        const key = segBtn.closest('[data-seg]').dataset.seg
        Data.setSettings({ [key]: segBtn.dataset.v })
        return
      }
      if (e.target.closest('#set-open-data')) timeAPI.app.openDataFolder()
    },
  }
})()

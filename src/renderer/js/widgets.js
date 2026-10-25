// 玻璃风格自定义控件：下拉选择 / 日期选择（替代原生 select 与 input[type=date] 的系统弹层）
// 弹层挂到 body 用 fixed 定位：避开 modal 的 overflow 裁剪，并可贴窗口边缘自动收拢；
// 同一时刻全局只开一个弹层，点外部 / Esc / 重新点按钮 / 窗口缩放时关闭
;(function () {
  let activeClose = null

  function closeActive() {
    if (activeClose) activeClose()
  }

  // mousedown 捕获阶段关掉已开的弹层；触发按钮(.wtrigger)与弹层内部(.wpop)除外——
  // 否则按钮的 mousedown 先关、click 又开，破坏点按钮切换开合的语义
  document.addEventListener(
    'mousedown',
    (e) => {
      if (activeClose && !e.target.closest('.wpop') && !e.target.closest('.wtrigger')) closeActive()
    },
    true
  )
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeActive()
  })
  window.addEventListener('resize', closeActive)

  function openPop(anchor, pop, alignRight, onClose) {
    closeActive()
    document.body.appendChild(pop)
    pop.hidden = false
    // 先离屏量尺寸，再贴边计算位置（放不下时向上展开）
    pop.style.left = '-9999px'
    pop.style.top = '0'
    const r = anchor.getBoundingClientRect()
    const pw = pop.offsetWidth
    const ph = pop.offsetHeight
    let left = alignRight ? r.right - pw : r.left
    left = Math.max(8, Math.min(left, window.innerWidth - pw - 8))
    let top = r.bottom + 6
    if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 6)
    pop.style.left = left + 'px'
    pop.style.top = top + 'px'
    activeClose = () => {
      pop.remove()
      if (onClose) onClose()
    }
  }

  const CAL_SVG =
    '<svg class="wdate-ico" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>'

  /**
   * 下拉选择
   * @param {object} o { options:[{value,label}], value, onChange, className, align:'left'|'right', placeholder }
   * @returns { root, get(), set(v) }
   */
  function select(o) {
    let value = o.value
    let open = false
    const root = document.createElement('div')
    root.className = 'wselect ' + (o.className || '')
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'wtrigger wselect-btn input'
    const renderBtn = () => {
      const cur = o.options.find((x) => x.value === value)
      btn.innerHTML =
        `<span class="wselect-label${!cur ? ' wph' : ''}">${cur ? cur.label : o.placeholder || ''}</span>` +
        '<span class="caret">▾</span>'
    }
    renderBtn()

    const pop = document.createElement('div')
    pop.className = 'wselect-pop wpop'
    const list = document.createElement('div')
    list.className = 'wselect-list'
    const items = o.options.map((opt) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'wselect-item'
      b.dataset.v = opt.value
      b.textContent = opt.label
      list.appendChild(b)
      return b
    })
    pop.appendChild(list)

    const close = () => {
      open = false
    }
    btn.addEventListener('click', () => {
      if (open) return closeActive()
      items.forEach((b) => b.classList.toggle('cur', b.dataset.v === value))
      openPop(btn, pop, o.align === 'right', close)
      open = true
      const curEl = items.find((b) => b.dataset.v === value)
      if (curEl) curEl.scrollIntoView({ block: 'center' })
    })
    list.addEventListener('click', (e) => {
      const b = e.target.closest('.wselect-item')
      if (!b) return
      value = b.dataset.v
      renderBtn()
      closeActive()
      if (o.onChange) o.onChange(value)
    })

    root.appendChild(btn)
    return { root, get: () => value, set(v) { value = v; renderBtn() } }
  }

  /**
   * 日期选择（值格式 YYYY-MM-DD，null/'' 为空）
   * @param {object} o { value, onChange, className('fill' 撑满), align, placeholder }
   */
  function datePicker(o) {
    let value = o.value || null
    let view = null // 弹层当前展示的 {y, m}
    let open = false
    const root = document.createElement('div')
    root.className = 'wdate ' + (o.className || '')
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'wtrigger wdate-btn input'
    btn.title = '选择日期'
    const renderBtn = () => {
      let label = o.placeholder || '年 /月/日'
      if (value) {
        const d = DU.fromKey(value)
        label = `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`
      }
      btn.innerHTML = `<span class="wdate-label${value ? '' : ' wph'}">${label}</span>${CAL_SVG}`
    }
    renderBtn()

    const pop = document.createElement('div')
    pop.className = 'wdate-pop wpop'
    const renderPop = () => {
      const todayKey = DU.dateKey(new Date())
      const first = new Date(view.y, view.m, 1)
      const start = DU.addDays(first, -(DU.isoWeekday(first) - 1))
      let cells = ''
      for (let i = 0; i < 42; i++) {
        const d = DU.addDays(start, i)
        const key = DU.dateKey(d)
        const other = d.getMonth() !== view.m ? ' other' : ''
        const today = key === todayKey ? ' today' : ''
        const cur = key === value ? ' cur' : ''
        cells += `<button type="button" class="wdate-day${other}${today}${cur}" data-date="${key}">${d.getDate()}</button>`
      }
      pop.innerHTML = `
        <div class="wdate-head">
          <button type="button" class="icon-btn wdate-nav" data-n="-12" title="上一年">«</button>
          <button type="button" class="icon-btn wdate-nav" data-n="-1" title="上个月">‹</button>
          <div class="wdate-title">${view.y} 年 ${view.m + 1} 月</div>
          <button type="button" class="icon-btn wdate-nav" data-n="1" title="下个月">›</button>
          <button type="button" class="icon-btn wdate-nav" data-n="12" title="下一年">»</button>
        </div>
        <div class="wdate-week">${DU.weekdayCN.map((w) => `<span>${w}</span>`).join('')}</div>
        <div class="wdate-grid">${cells}</div>
        <div class="wdate-foot">
          <button type="button" class="wdate-clear" data-a="clear">清除</button>
          <button type="button" data-a="today">今天</button>
        </div>`
    }
    const shiftView = (n) => {
      let y = view.y
      let m = view.m + n
      y += Math.floor(m / 12)
      m = ((m % 12) + 12) % 12
      if (y < 1900) { y = 1900; m = 0 }
      if (y > 2100) { y = 2100; m = 11 }
      view = { y, m }
      renderPop()
    }
    pop.addEventListener('click', (e) => {
      const nav = e.target.closest('.wdate-nav')
      if (nav) return shiftView(+nav.dataset.n)
      const day = e.target.closest('.wdate-day')
      if (day) return commit(day.dataset.date)
      if (e.target.closest('[data-a="clear"]')) return commit(null)
      if (e.target.closest('[data-a="today"]')) return commit(DU.dateKey(new Date()))
    })
    const commit = (v) => {
      value = v
      renderBtn()
      closeActive()
      if (o.onChange) o.onChange(value)
    }

    const close = () => {
      open = false
    }
    btn.addEventListener('click', () => {
      if (open) return closeActive()
      const base = value ? DU.fromKey(value) : new Date()
      view = { y: base.getFullYear(), m: base.getMonth() }
      renderPop()
      openPop(btn, pop, o.align === 'right', close)
      open = true
    })

    root.appendChild(btn)
    return {
      root,
      get: () => value,
      set(v) {
        value = v || null
        renderBtn()
      },
    }
  }

  window.Widgets = { select, datePicker }
})()

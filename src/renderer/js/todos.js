// 待办任务页：快速添加 / 筛选 / 优先级 / 截止提醒联动
;(function () {
  const PRIORITY_LABEL = { high: '高', mid: '中', low: '低' }

  // 待办的截止提醒以关联闹钟记录（type:'todo'）实现，随待办保存/完成自动增删
  function syncTodoAlarm(todo) {
    const existing = Data.alarms.find((a) => a.type === 'todo' && a.sourceId === todo.id)
    const need = todo.remind && todo.dueDate && todo.dueTime && !todo.done
    if (need) {
      Data.save('alarms', {
        ...existing,
        id: existing ? existing.id : undefined,
        type: 'todo',
        sourceId: todo.id,
        title: `待办：${todo.title}`,
        date: todo.dueDate,
        time: todo.dueTime,
        repeat: 'once',
        weekdays: null,
        enabled: true,
      })
    } else if (existing) {
      Data.remove('alarms', existing.id)
    }
  }

  function dueText(t) {
    if (!t.dueDate) return ''
    const today = DU.dateKey(new Date())
    const tomorrow = DU.dateKey(DU.addDays(new Date(), 1))
    const time = t.dueTime ? ` ${t.dueTime}` : ''
    if (t.dueDate < today) {
      const days = Math.round((DU.startOfDay(new Date()) - DU.startOfDay(DU.fromKey(t.dueDate))) / 86_400_000)
      return `<span class="todo-overdue">已逾期 ${days} 天${time}</span>`
    }
    if (t.dueDate === today) return `<span class="todo-overdue">今天${time}</span>`
    if (t.dueDate === tomorrow) return `明天${time}`
    return DU.fmtCN(t.dueDate) + time
  }

  function openTodoModal(existing) {
    const t = existing || { title: '', priority: 'none', dueDate: '', dueTime: '', remind: false }
    const body = App.el(`
      <div>
        <div class="form-row"><label>标题</label>
          <input class="input" id="fm-title" placeholder="要做的事…" value="${App.esc(t.title)}"></div>
        <div class="form-row"><label>优先级</label>
          <div class="seg" id="fm-pri">
            <button class="seg-item" data-v="none">无</button>
            <button class="seg-item" data-v="low">低</button>
            <button class="seg-item" data-v="mid">中</button>
            <button class="seg-item" data-v="high">高</button>
          </div>
        </div>
        <div class="form-row"><label>截止日期（可选）</label>
          <div style="display:flex;gap:10px">
            <input class="input" id="fm-date" type="date" value="${App.esc(t.dueDate || '')}" style="flex:1">
            <input class="input" id="fm-time" type="time" value="${App.esc(t.dueTime || '')}" style="flex:1">
          </div>
        </div>
        <div class="form-row" style="display:flex;align-items:center;justify-content:space-between">
          <div><label style="margin:0">到期提醒</label>
            <div class="set-sub" style="font-size:11.5px;color:var(--text-3);margin-top:2px">需要截止日期与时间</div></div>
          <label class="switch"><input type="checkbox" id="fm-remind" ${t.remind ? 'checked' : ''}><span class="track"></span></label>
        </div>
      </div>`)

    const priSeg = body.querySelector('#fm-pri')
    const syncPri = () => priSeg.querySelectorAll('.seg-item').forEach((b) => b.classList.toggle('active', b.dataset.v === t.priority))
    priSeg.addEventListener('click', (e) => {
      const b = e.target.closest('.seg-item')
      if (b) {
        t.priority = b.dataset.v
        syncPri()
      }
    })
    syncPri()

    App.modal({
      title: existing ? '编辑待办' : '新建待办',
      body,
      actions: [
        {
          label: '保存',
          onClick: (close) => {
            const title = body.querySelector('#fm-title').value.trim()
            if (!title) return App.toast({ title: '请输入标题' })
            const dueDate = body.querySelector('#fm-date').value || null
            const dueTime = body.querySelector('#fm-time').value || null
            let remind = body.querySelector('#fm-remind').checked
            if (remind && (!dueDate || !dueTime)) {
              remind = false
              App.toast({ title: '开启提醒需要日期和时间', body: '已为你关闭到期提醒' })
            }
            Data.save('todos', {
              ...existing,
              id: existing ? existing.id : undefined,
              title,
              priority: t.priority,
              dueDate,
              dueTime,
              remind,
              done: existing ? existing.done : false,
              createdAt: existing ? existing.createdAt : Date.now(),
              completedAt: existing ? existing.completedAt : null,
            }).then((saved) => syncTodoAlarm(saved))
            close()
          },
        },
      ],
    })
  }

  App.pages.todos = {
    filter: 'all',
    init(root) {
      this.root = root
      root.innerHTML = `
        <div class="page-header">
          <div><h2>待办任务</h2><div class="page-sub">设置截止时间的待办可自动提醒</div></div>
        </div>
        <div class="todo-layout">
          <div class="todo-add">
            <input class="input" id="td-input" placeholder="添加待办，回车保存…">
            <input class="input" id="td-date" type="date" title="截止日期（可选）">
            <select class="input" id="td-pri" title="优先级" style="width:auto">
              <option value="none">无优先级</option>
              <option value="high">高</option>
              <option value="mid">中</option>
              <option value="low">低</option>
            </select>
            <button class="btn btn-primary" id="td-add">添加</button>
          </div>
          <div class="seg todo-filters" id="td-filters">
            <button class="seg-item active" data-f="today">今天</button>
            <button class="seg-item" data-f="upcoming">即将到期</button>
            <button class="seg-item" data-f="all">全部</button>
            <button class="seg-item" data-f="done">已完成</button>
          </div>
          <div class="todo-list" id="td-list"></div>
        </div>`

      const input = root.querySelector('#td-input')
      const quickAdd = async () => {
        const title = input.value.trim()
        if (!title) return
        const saved = await Data.save('todos', {
          title,
          priority: root.querySelector('#td-pri').value,
          dueDate: root.querySelector('#td-date').value || null,
          dueTime: null,
          remind: false,
          done: false,
          createdAt: Date.now(),
          completedAt: null,
        })
        syncTodoAlarm(saved)
        input.value = ''
        root.querySelector('#td-date').value = ''
      }
      root.querySelector('#td-add').onclick = quickAdd
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') quickAdd()
      })

      root.querySelector('#td-filters').addEventListener('click', (e) => {
        const b = e.target.closest('.seg-item')
        if (!b) return
        this.filter = b.dataset.f
        this.render()
      })
      root.querySelector('#td-list').addEventListener('click', (e) => this._onClick(e))
      Data.on('todos', () => this.render())
      this.render()
    },

    show() {
      this.render()
    },

    render() {
      const today = DU.dateKey(new Date())
      this.root.querySelector('#td-filters').querySelectorAll('.seg-item').forEach((b) => b.classList.toggle('active', b.dataset.f === this.filter))

      let list = Data.todos.filter((t) => !t.done)
      if (this.filter === 'today') list = list.filter((t) => t.dueDate && t.dueDate <= today)
      else if (this.filter === 'upcoming') list = list.filter((t) => t.dueDate && t.dueDate > today)
      else if (this.filter === 'done') list = Data.todos.filter((t) => t.done)

      const priOrder = { high: 0, mid: 1, low: 2, none: 3 }
      list.sort((a, b) => {
        if (this.filter === 'done') return (b.completedAt || 0) - (a.completedAt || 0)
        if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1
        if (a.dueDate && !b.dueDate) return -1
        if (!a.dueDate && b.dueDate) return 1
        if (priOrder[a.priority] !== priOrder[b.priority]) return priOrder[a.priority] - priOrder[b.priority]
        return b.createdAt - a.createdAt
      })

      const box = this.root.querySelector('#td-list')
      if (!list.length) {
        const hints = { today: '今天没有到期的待办', upcoming: '没有即将到期的待办', all: '待办清单是空的', done: '还没有完成过的待办' }
        box.innerHTML = `<div class="card empty"><span class="empty-icon">✅</span>${hints[this.filter]}</div>`
        return
      }
      box.innerHTML = list
        .map((t) => {
          const pri = t.priority && t.priority !== 'none' ? `<span class="badge badge-${t.priority}">${PRIORITY_LABEL[t.priority]}</span>` : ''
          const due = dueText(t)
          const hasAlarm = t.remind && t.dueDate && t.dueTime && !t.done
          return `
        <div class="todo-item${t.done ? ' done' : ''}" data-id="${t.id}">
          <button class="todo-check" title="${t.done ? '标记未完成' : '完成'}">${t.done ? '✓' : ''}</button>
          <div class="todo-main">
            <div class="todo-title">${App.esc(t.title)}</div>
            <div class="todo-meta">${pri}${due ? `<span>${due}</span>` : ''}${hasAlarm ? '<span title="到期提醒已开启">🔔 提醒</span>' : ''}</div>
          </div>
          <button class="icon-btn td-edit" title="编辑">✎</button>
          <button class="icon-btn danger td-del" title="删除">🗑</button>
        </div>`
        })
        .join('')
    },

    _onClick(e) {
      const item = e.target.closest('.todo-item')
      if (!item) return
      const todo = Data.todos.find((t) => t.id === item.dataset.id)
      if (!todo) return
      if (e.target.closest('.todo-check')) {
        const done = !todo.done
        Data.save('todos', { ...todo, done, completedAt: done ? Date.now() : null }).then((saved) => syncTodoAlarm(saved))
      } else if (e.target.closest('.td-edit')) {
        openTodoModal(todo)
      } else if (e.target.closest('.td-del')) {
        App.confirmDlg(`删除待办「${todo.title}」？`).then(async (ok) => {
          if (!ok) return
          const linked = Data.alarms.find((a) => a.type === 'todo' && a.sourceId === todo.id)
          if (linked) await Data.remove('alarms', linked.id)
          Data.remove('todos', todo.id)
        })
      }
    },
  }
})()

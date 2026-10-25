// 农历 / 节气 / 节日 离线计算（零依赖，供日历模块使用）
// - 农历：1900-2100 经典年表数据（含闰月），锚定 1900-01-31 = 庚子年正月初一
// - 节气：寿星天文历法通用公式，21 世纪（2000-2099）内可用，超范围不显示
;(function (global) {
  // 农历年信息表（1900-2100，共 201 项）
  // 位布局：bit16 闰月大小(1=30天) | bit4-15 十二个月大小 | bit0-3 闰月月份(0=无闰)
  const LUNAR_INFO = [
    0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2,
    0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977,
    0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970,
    0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950,
    0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557,
    0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0,
    0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0,
    0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6,
    0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570,
    0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x05ac0, 0x0ab60, 0x096d5, 0x092e0,
    0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5,
    0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930,
    0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530,
    0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45,
    0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0,
    0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0,
    0x0a2e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4,
    0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0,
    0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160,
    0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252,
    0x0d520,
  ]

  const MONTH_NAMES = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊']
  const DAY_NAMES = [
    '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
    '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
    '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十',
  ]
  const GAN = '甲乙丙丁戊己庚辛壬癸'
  const ZHI = '子丑寅卯辰巳午未申酉戌亥'
  const ZODIAC = '鼠牛虎兔龙蛇马羊猴鸡狗猪'

  // 节气（寿星公式 21 世纪 C 值，从小寒起），1-2 月需用上一年份后两位计算
  // 注：立春的流传值 3.87 精度不足（2026 等年份差一天），此处 4.08 由
  // 2000/2001/2004/2005/2017/2018/2021/2025/2026/2029/2049/2054/2058 共 13 个
  // 权威锚点反推，全部吻合（新华社：本世纪 2/3 立春共 39 次）
  const TERMS = ['小寒', '大寒', '立春', '雨水', '惊蛰', '春分', '清明', '谷雨', '立夏', '小满', '芒种', '夏至', '小暑', '大暑', '立秋', '处暑', '白露', '秋分', '寒露', '霜降', '立冬', '小雪', '大雪', '冬至']
  const TERM_C = [5.4055, 20.12, 4.08, 18.73, 5.63, 20.646, 4.81, 20.1, 5.52, 21.04, 5.678, 21.37, 7.108, 22.83, 7.5, 23.13, 7.646, 23.042, 8.318, 23.438, 7.438, 22.36, 7.18, 21.94]

  // 公历节日（月-日）
  const SOLAR_FESTIVALS = {
    '1-1': '元旦', '2-14': '情人节', '3-8': '妇女节', '3-12': '植树节', '4-1': '愚人节',
    '5-1': '劳动节', '5-4': '青年节', '6-1': '儿童节', '7-1': '建党节', '8-1': '建军节',
    '9-10': '教师节', '10-1': '国庆节', '12-24': '平安夜', '12-25': '圣诞节',
  }
  // 农历节日（农历月-日）
  const LUNAR_FESTIVALS = {
    '1-1': '春节', '1-15': '元宵节', '2-2': '龙抬头', '5-5': '端午节', '7-7': '七夕',
    '7-15': '中元节', '8-15': '中秋节', '9-9': '重阳节', '12-8': '腊八节', '12-23': '小年',
  }

  // 法定节假日（国务院办公厅年度通知原文核实，逐年公布、无法用公式推算）
  // rest = 放假日（含调休借来的连休天），work = 调休上班日
  // 2025：国办发明电〔2024〕8号；2026：国办发明电〔2025〕7号（gov.cn 公报原文）
  const HOLIDAYS = {
    2025: {
      rest: [
        '01-01',
        '01-28', '01-29', '01-30', '01-31', '02-01', '02-02', '02-03', '02-04',
        '04-04', '04-05', '04-06',
        '05-01', '05-02', '05-03', '05-04', '05-05',
        '05-31', '06-01', '06-02',
        '10-01', '10-02', '10-03', '10-04', '10-05', '10-06', '10-07', '10-08',
      ],
      work: ['01-26', '02-08', '04-27', '09-28', '10-11'],
    },
    2026: {
      rest: [
        '01-01', '01-02', '01-03',
        '02-15', '02-16', '02-17', '02-18', '02-19', '02-20', '02-21', '02-22', '02-23',
        '04-04', '04-05', '04-06',
        '05-01', '05-02', '05-03', '05-04', '05-05',
        '06-19', '06-20', '06-21',
        '09-25', '09-26', '09-27',
        '10-01', '10-02', '10-03', '10-04', '10-05', '10-06', '10-07',
      ],
      work: ['01-04', '02-14', '02-28', '05-09', '09-20', '10-10'],
    },
  }

  /** 某公历日期的法定节假日状态：'rest' 放假 | 'work' 调休上班 | null 普通日 */
  function holidayOf(dateKey) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey || '')
    if (!m) return null
    const y = HOLIDAYS[+m[1]]
    if (!y) return null
    const md = m[2] + '-' + m[3]
    if (y.rest.includes(md)) return 'rest'
    if (y.work.includes(md)) return 'work'
    return null
  }

  const info = (y) => LUNAR_INFO[y - 1900]
  const leapMonthOf = (y) => info(y) & 0xf
  const leapDaysOf = (y) => (leapMonthOf(y) ? ((info(y) & 0x10000) ? 30 : 29) : 0)
  const monthDaysOf = (y, m) => ((info(y) & (0x10000 >> m)) ? 30 : 29)
  const yearDaysOf = (y) => {
    let d = 348
    for (let i = 0x8000; i > 0x8; i >>= 1) if (info(y) & i) d++
    return d + leapDaysOf(y)
  }

  const BASE = Date.UTC(1900, 0, 31) // 庚子年正月初一

  /** 公历 → 农历。y/m/d 为公历年、月(1-12)、日。超出 1900-2100 返回 null */
  function solar2lunar(y, m, d) {
    const offset = Math.round((Date.UTC(y, m - 1, d) - BASE) / 86400000)
    if (offset < 0) return null
    let ly = 1900
    let temp = offset
    while (ly <= 2100 && temp >= yearDaysOf(ly)) {
      temp -= yearDaysOf(ly)
      ly++
    }
    if (ly > 2100) return null

    // 构造当年农历月序列（正常月 + 闰月插在闰月号之后），逐月扣减
    const leapM = leapMonthOf(ly)
    const seq = []
    for (let i = 1; i <= 12; i++) {
      seq.push([i, false])
      if (leapM > 0 && i === leapM) seq.push([i, true])
    }
    let lm = 1
    let isLeap = false
    let days = 30
    let hit = false
    for (const [mo, lep] of seq) {
      days = lep ? leapDaysOf(ly) : monthDaysOf(ly, mo)
      if (temp < days) {
        lm = mo
        isLeap = lep
        hit = true
        break
      }
      temp -= days
    }
    if (!hit) return null

    const ld = temp + 1
    const monthName = (isLeap ? '闰' : '') + MONTH_NAMES[lm - 1]
    return {
      year: ly,
      month: lm,
      day: ld,
      isLeap,
      monthName,
      dayName: DAY_NAMES[ld - 1],
      // 初一显示月名（如"九月"），除夕特判由调用方处理
      label: ld === 1 ? monthName + '月' : DAY_NAMES[ld - 1],
      ganZhi: GAN[(ly - 4) % 10] + ZHI[(ly - 4) % 12],
      zodiac: ZODIAC[(ly - 4) % 12],
    }
  }

  /** 某公历日期的节气（2000-2099），无则返回 null */
  function termOf(y, m, d) {
    if (y < 2000 || y > 2099) return null
    for (let n = 0; n < 24; n++) {
      const termMonth = (n >> 1) + 1
      if (termMonth !== m) continue
      // 1-2 月的节气用上一年份的后两位参与计算
      const yy = n < 4 ? (y - 1) % 100 : y % 100
      const leapCount = Math.floor(yy / 4)
      const day = Math.floor(yy * 0.2422 + TERM_C[n]) - leapCount
      if (day === d) return TERMS[n]
    }
    return null
  }

  const pad = (n) => String(n).padStart(2, '0')

  /**
   * 日历格用的每日信息
   * @returns {{label:string, type:'festival'|'term'|'lunar', festival:string|null, term:string|null,
   *            lunarFull:string|null}} type 决定显示优先级与配色：节日 > 节气 > 农历
   */
  function dayInfo(dateKey) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey || '')
    if (!m) return { label: '', type: 'lunar', festival: null, term: null, lunarFull: null }
    const y = +m[1]
    const mo = +m[2]
    const d = +m[3]
    const lu = solar2lunar(y, mo, d)
    const term = termOf(y, mo, d)

    let festival = SOLAR_FESTIVALS[mo + '-' + d] || null
    if (lu) {
      const luNext = solar2lunar(y, mo, d + 1) // 日期溢出时 Date.UTC 自动进位
      if (luNext && luNext.month === 1 && luNext.day === 1 && !luNext.isLeap) festival = '除夕'
      const lf = LUNAR_FESTIVALS[lu.month + '-' + lu.day]
      if (lf) festival = lf
    }

    let label = lu ? lu.label : ''
    let type = 'lunar'
    if (festival) {
      label = festival
      type = 'festival'
    } else if (term) {
      label = term
      type = 'term'
    }
    return {
      label,
      type,
      festival,
      term,
      lunarFull: lu ? `${lu.ganZhi}年（${lu.zodiac}）· ${lu.isLeap ? '闰' : ''}${lu.monthName}月${lu.dayName}` : null,
    }
  }

  global.Lunar = { solar2lunar, termOf, dayInfo, holidayOf, TERMS }

  // node 环境下暴露用于锚点测试
  if (typeof module !== 'undefined' && module.exports) module.exports = { solar2lunar, termOf, dayInfo, holidayOf }
})(typeof window !== 'undefined' ? window : globalThis)

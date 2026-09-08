// services/icsScheduleParser.js
// ICS 课表解析（TZID 感知，scheduleImporter 与 wakeupApi 共用，避免二者互相依赖成环）
//
// 与旧实现的关键差异：
// - 不信任 ical.js 内置时区注册表（ical-expander 加载的是 2012 版规则）换算绝对时刻，
//   而是直接读取 ICAL.Time 的"作者墙钟"字段（year~minute，ical.js 不会回写这些字段）
//   与 dtstart 属性的原始 TZID 参数（不受注册表命中与否影响）。
// - 所有 日历日/星期/周次/学期开始 均在锚时区的日历日域（YYYY-MM-DD）内计算，
//   不再经由服务器本地时区。
//
// 语义规则：
// - 浮动时间（无 TZID）：直通作者墙钟（在任何时区都按同一钟点理解）。
// - IANA TZID 事件：作者墙钟按该 TZID 书写。
//   * 事件 TZID == 锚时区 → 直通（无需瞬时换算，天然免夏令时误差）；
//   * 事件 TZID ≠ 锚时区 → 经绝对时刻换算到锚时区墙钟；
// - 未知 TZID（文件自定义 VTIMEZONE 等非 IANA）：按浮动直通并记 note。
// - 锚时区 = 用户显式时区 ?? 日历主时区（各事件 IANA TZID 多数值）?? null（全浮动）。

import ICalExpander from 'ical-expander'
import {
  isValidIanaTimeZone, normalizeTimeZone, utcMsToTzParts, wallPartsToUtcMs,
  weekdayOfDateStr, weekOfDateStr, mondayOfDateStr, isValidDateStr
} from '../utils/timeZoneUtils.js'

/** 读取 dtstart 属性的原始 TZID 参数（属性级，不受 ical.js 时区注册表影响） */
function getPropertyTzid(ev) {
  try {
    const comp = ev?.component
    const prop = comp && typeof comp.getFirstProperty === 'function' ? comp.getFirstProperty('dtstart') : null
    if (prop && typeof prop.getParameter === 'function') {
      const tzid = prop.getParameter('tzid')
      if (typeof tzid === 'string' && tzid.trim()) return tzid.trim()
    }
  } catch (err) { /* 忽略损坏的组件 */ }
  return null
}

/** ICAL.Time 的作者墙钟分量（ical.js 不回写，恒为文件作者写入值） */
function authoredParts(timeObj) {
  return {
    year: timeObj.year,
    month: timeObj.month,
    day: timeObj.day,
    hour: timeObj.hour,
    minute: timeObj.minute,
    second: timeObj.second || 0
  }
}

/** 作者墙钟字段 → "YYYY-MM-DD" */
function partsToDateStr(p) {
  return [p.year, String(p.month).padStart(2, '0'), String(p.day).padStart(2, '0')].join('-')
}

/** 作者墙钟字段 → "HH:MM" */
function partsToTimeStr(p) {
  return [String(p.hour).padStart(2, '0'), String(p.minute).padStart(2, '0')].join(':')
}

/**
 * 提取课程名称/地点/教师（与旧 ICS 解析一致：location 空格切分末段为教师，其次 description 末行）
 */
function extractCourseInfo(ev) {
  const summary = ev.summary || '未知课程'
  const rawLocation = (ev.location || '').trim()
  const description = (ev.description || '').trim()
  let location = ''
  let teacher = ''
  if (rawLocation) {
    const parts = rawLocation.split(/\s+/)
    if (parts.length >= 2) {
      teacher = parts.pop()
      location = parts.join(' ')
    } else {
      location = rawLocation
    }
  }
  if (!teacher && description) {
    const lines = description.split('\n').filter(l => l.trim())
    if (lines.length > 0) {
      teacher = lines[lines.length - 1].replace(/[。.]$/, '').trim()
    }
  }
  return { summary, location, teacher }
}

/**
 * 解析 ICS 文本为课程明细（聚合周次、未合并连堂课）
 * @param {string} icsText
 * @param {{ userTZ?: string|null }} [options] userTZ: 用户显式设置的时区（优先于日历推断作锚）
 * @returns {{
 *   ok: true,
 *   courses: Array<{name:string, day:number, startTime:string, endTime:string, weeks:number[], location:string, teacher:string}>,
 *   semesterStart: string,
 *   importTimeZone: string|null,   // 无用户显式时区且识别出日历主时区 → 该主时区，供落盘推断；否则 null
 *   calendarTZ: string|null,       // 识别出的日历主时区（仅供参考/提示）
 *   notes: string[]                // 提示/警告（换算、跨日、未知 TZID 等）
 * } | { ok: false, message: string }}
 */
export function parseIcsScheduleCourses(icsText, { userTZ = null } = {}) {
  const expander = new ICalExpander({ ics: icsText, maxIterations: 5000 })
  let all
  try {
    // between 的边界本身是绝对时刻宽区间（2000-2100），不参与语义
    all = expander.between(new Date(2000, 0, 1), new Date(2100, 0, 1))
  } catch (err) {
    return { ok: false, message: `ICS 文件解析失败：${err.message}` }
  }
  const occurrences = [...(all.events || []), ...(all.occurrences || [])]
  if (occurrences.length === 0) {
    return { ok: false, message: '未在文件中找到任何课程事件' }
  }

  // 第一遍：判定每个事件的时间模式，统计日历主时区
  const tzidCounts = new Map()
  const entries = occurrences.map(occ => {
    const ev = occ.item || occ
    const tzid = getPropertyTzid(ev)
    let mode = 'floating'
    let ianaName = null
    if (tzid) {
      if (isValidIanaTimeZone(tzid)) {
        mode = 'iana'
        ianaName = normalizeTimeZone(tzid)
      } else {
        mode = 'unknown' // 自定义 VTIMEZONE 等非 IANA：按浮动直通（与 ical.js 旧行为一致但显式化）
      }
    }
    if (mode === 'iana') {
      tzidCounts.set(ianaName, (tzidCounts.get(ianaName) || 0) + 1)
    }
    return { occ, ev, mode, ianaName }
  })
  // 日历主时区：多数值（并列时取先出现的）
  let calendarTZ = null
  let maxCount = 0
  for (const [name, count] of tzidCounts) {
    if (count > maxCount) {
      maxCount = count
      calendarTZ = name
    }
  }

  const userNorm = userTZ ? normalizeTimeZone(userTZ) : null
  const anchor = userNorm || calendarTZ || null // null = 全浮动直通
  const notes = []
  if (userNorm && calendarTZ && calendarTZ !== userNorm) {
    notes.push(`⏰ 日历时区 ${calendarTZ}，已换算为你设置的时区 ${userNorm}`)
  } else if (calendarTZ) {
    notes.push(`⏰ 日历时区：${calendarTZ}`)
  }
  let unknownTzidCount = 0
  let skippedCrossDay = 0

  // 第二遍：逐事件换算到锚时区墙钟，收集目标日历日
  const converted = []
  for (const { occ, ev, mode, ianaName } of entries) {
    if (mode === 'unknown') unknownTzidCount++
    const info = extractCourseInfo(ev)
    const start = occ.startDate
    const end = occ.endDate
    if (!start || !end) continue

    let targetStart
    let targetEnd
    if (anchor === null || mode !== 'iana' || ianaName === anchor) {
      // 直通：浮动 / 未知 TZID / 事件时区即锚
      targetStart = authoredParts(start)
      targetEnd = authoredParts(end)
    } else {
      // 跨时区换算：事件 TZID 墙钟 → 绝对时刻 → 锚时区墙钟
      const startMs = wallPartsToUtcMs(authoredParts(start), ianaName)
      const endMs = wallPartsToUtcMs(authoredParts(end), ianaName)
      if (startMs.edge !== 'normal') {
        notes.push(`⚠️ ${info.summary} 的起始时间落在夏令时切换间隙附近，已按最接近时刻换算`)
      }
      targetStart = utcMsToTzParts(startMs.ms, anchor)
      targetEnd = utcMsToTzParts(endMs.ms, anchor)
    }

    const startDs = partsToDateStr(targetStart)
    const endDs = partsToDateStr(targetEnd)
    const startTime = partsToTimeStr(targetStart)
    const endTime = partsToTimeStr(targetEnd)
    if (!isValidDateStr(startDs) || !isValidDateStr(endDs)) continue
    if (startDs !== endDs) {
      // 存储模型为"同日 + HH:MM"，跨日事件无法表达：跳过并提示（旧实现会存出永不命中的脏数据）
      skippedCrossDay++
      continue
    }
    converted.push({
      info, day: weekdayOfDateStr(startDs), startDs, startTime, endTime
    })
  }
  if (unknownTzidCount > 0) {
    notes.push(`ℹ️ ${unknownTzidCount} 个事件使用自定义/未知时区标识，已按文件书写时间直通处理`)
  }
  if (skippedCrossDay > 0) {
    notes.push(`⚠️ ${skippedCrossDay} 次跨日课程事件无法在现课表格式中表达，已跳过`)
  }

  if (converted.length === 0) {
    return { ok: false, message: '未能解析出有效的课程数据' }
  }

  // 学期开始 = 最早目标日历日所在周的周一（锚时区日历域）
  let earliestDs = null
  for (const c of converted) {
    if (!earliestDs || c.startDs < earliestDs) earliestDs = c.startDs
  }
  const semesterStart = mondayOfDateStr(earliestDs)

  // 聚合：同 key（课程+星期+时间+地点+教师）收集周次
  const courseMap = new Map()
  for (const c of converted) {
    const week = weekOfDateStr(semesterStart, c.startDs)
    if (week === null) continue
    const key = `${c.info.summary}|${c.day}|${c.startTime}|${c.endTime}|${c.info.location}|${c.info.teacher}`
    if (!courseMap.has(key)) {
      courseMap.set(key, {
        name: c.info.summary, day: c.day, startTime: c.startTime, endTime: c.endTime,
        weeks: new Set(), location: c.info.location, teacher: c.info.teacher
      })
    }
    courseMap.get(key).weeks.add(week)
  }

  const courses = Array.from(courseMap.values()).map(c => ({
    ...c,
    weeks: Array.from(c.weeks).sort((a, b) => a - b)
  }))
  if (courses.length === 0) {
    return { ok: false, message: '未能解析出有效的课程数据' }
  }

  // importTimeZone：仅当用户没有显式时区且识别出日历主时区时写入（供落盘推断）
  const importTimeZone = !userNorm ? calendarTZ : null

  return {
    ok: true,
    courses,
    semesterStart,
    importTimeZone,
    calendarTZ,
    notes
  }
}

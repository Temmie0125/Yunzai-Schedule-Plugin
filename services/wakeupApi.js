// services/wakeupApi.js
import { ConfigManager } from '../components/ConfigManager.js'

/**
 * 从 WakeUp2ICS API 获取课表数据
 * 调用 POST {serviceUrl}/parse 解析 WakeUp 分享口令
 * @param {string} code - 分享口令
 * @returns {Promise<object>} 标准课表数据 { tableName, semesterStart, courses }
 */
export async function fetchScheduleFromAPI(code) {
  const config = ConfigManager.getConfig()
  const serviceUrl = (config.wakeupServiceUrl || 'https://wakeup.cpc.cn.eu.org/').replace(/\/$/, '')
  const authToken = (config.wakeupAuthToken || '').trim()

  const headers = { 'Content-Type': 'application/json' }
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`
  }

  const url = `${serviceUrl}/parse`

  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ code }),
      signal: AbortSignal.timeout(15000)
    })
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error('请求WakeUp服务超时，请稍后重试')
    }
    throw new Error(`请求WakeUp服务失败: ${err.message}`)
  }

  if (!response.ok) {
    throw new Error(`WakeUp服务返回错误: HTTP ${response.status}`)
  }

  // 检查响应类型：可能是 JSON 或 ICS
  const contentType = response.headers.get('content-type') || ''

  if (contentType.includes('text/calendar') || contentType.includes('application/ics')) {
    // ICS 格式响应
    const icsText = await response.text()
    return await parseIcsToSchedule(icsText)
  }

  // JSON 格式响应
  let result
  try {
    result = await response.json()
  } catch (err) {
    throw new Error(`解析WakeUp服务响应失败: ${err.message}`)
  }

  if (!result.success) {
    throw new Error(result.message || 'WakeUp服务解析失败')
  }

  const data = result.data

  // 处理不同格式的返回数据
  if (typeof data === 'string') {
    // 旧格式: 多行JSON字符串（原始 WakeUp 数据格式）
    return parseScheduleData(data)
  }

  if (typeof data === 'object' && data !== null) {
    // 检查是否有 shareData 字段（旧版口令的响应格式：data 是 { shareData: "多行JSON" }）
    if (data.shareData && typeof data.shareData === 'string') {
      let rawData = data.shareData
      // shareData 中可能包含字面量 \n（两个字符），需要替换为实际换行符
      if (rawData.includes('\\n')) {
        rawData = rawData.replace(/\\n/g, '\n')
      }
      return parseScheduleData(rawData)
    }
    // 新格式: 结构化JSON对象（包含 courses 数组等）
    return parseWakeupJsonData(data)
  }

  throw new Error('无法识别的WakeUp服务返回数据格式')
}

/**
 * 解析旧格式（多行JSON字符串）
 * 格式: 5行JSON
 *   行0: 时间元数据
 *   行1: 节次时间定义 [{node, startTime, endTime}, ...]
 *   行2: 课表元数据 {tableName, startDate}
 *   行3: 课程名称映射 [{id, courseName}, ...]
 *   行4: 课程安排 [{id, day, startWeek, endWeek, type, startNode, step, teacher, room, credit}, ...]
 * @param {string} rawData - 多行JSON字符串
 * @returns {object} 标准课表数据
 */
function parseScheduleData(rawData) {
  const data = rawData.split('\n').map(line => JSON.parse(line))

  // 解析节点信息
  const nodesInfo = Object.fromEntries(data[1].map(node => [node.node, node]))

  // 解析课程名称
  const courseInfo = Object.fromEntries(data[3].map(c => [c.id, c.courseName]))

  const tableName = data[2].tableName
  const semesterStart = data[2].startDate

  const courses = data[4].map(course => {
    const weeks = []
    for (let i = course.startWeek; i <= course.endWeek; i++) {
      if (course.type === 0 || course.type % 2 === i % 2) weeks.push(i)
    }

    let startTime, endTime
    if (course.ownTime) {
      startTime = course.startTime
      endTime = course.endTime
    } else {
      startTime = nodesInfo[course.startNode].startTime
      endTime = nodesInfo[course.startNode + course.step - 1].endTime
    }

    return {
      name: courseInfo[course.id],
      teacher: course.teacher || '',
      weeks,
      day: course.day.toString(),
      startTime,
      endTime,
      location: course.room || '',
      startNode: course.startNode,
      step: course.step,
      credit: course.credit,
      type: course.type
    }
  })

  return { tableName, semesterStart, courses }
}

/**
 * 解析新格式（结构化JSON对象）
 * 支持两种课程格式:
 *   1. WakeUp格式: 课程使用 startNode/step/startWeek/endWeek/type，数据包含 timeSlots/nodes 和 courseNames
 *   2. 标准格式: 课程使用 startTime/endTime/weeks
 * @param {object} data - API返回的 data 对象
 * @returns {object} 标准课表数据 { tableName, semesterStart, courses }
 */
function parseWakeupJsonData(data) {
  const tableName = data.schedule_name || data.tableName || 'WakeUp课表'
  const semesterStart = data.startDate || data.semesterStart || null

  const rawCourses = data.courses || []
  if (!rawCourses.length) {
    throw new Error('课表数据中没有课程信息')
  }

  // 判断课程格式类型
  const sample = rawCourses[0]
  const isWakeupFormat = sample &&
    (sample.hasOwnProperty('startNode') || sample.hasOwnProperty('startWeek')) &&
    !sample.hasOwnProperty('startTime')

  let courses

  if (isWakeupFormat) {
    // --- WakeUp 格式：需要通过 timeSlots/nodes 和 courseNames 解析 ---

    // 构建节点→时间映射
    let nodeTimeMap = new Map()
    if (data.timeSlots && Array.isArray(data.timeSlots)) {
      // timeSlots 可能是 [{node, startTime, endTime}] 或 [{number, startTime, endTime}]
      for (const ts of data.timeSlots) {
        const key = ts.node || ts.number
        if (key != null) {
          nodeTimeMap.set(key, { start: ts.startTime, end: ts.endTime })
        }
      }
    } else if (data.nodes && Array.isArray(data.nodes)) {
      for (const n of data.nodes) {
        nodeTimeMap.set(n.node, { start: n.startTime, end: n.endTime })
      }
    }

    // 构建课程ID→名称映射
    let courseNameMap = new Map()
    if (data.courseNames && Array.isArray(data.courseNames)) {
      for (const c of data.courseNames) {
        courseNameMap.set(c.id, c.courseName || c.name)
      }
    } else if (data.courseNameMap && typeof data.courseNameMap === 'object') {
      courseNameMap = new Map(Object.entries(data.courseNameMap))
    }

    courses = rawCourses.map(course => {
      // 解析名称
      const name = course.name || courseNameMap.get(course.id) || '未知课程'

      // 解析时间
      let startTime, endTime
      if (course.ownTime && course.startTime && course.endTime) {
        startTime = course.startTime
        endTime = course.endTime
      } else if (nodeTimeMap.size > 0 && course.startNode != null && course.step != null) {
        const startSlot = nodeTimeMap.get(course.startNode)
        const endSlot = nodeTimeMap.get(course.startNode + course.step - 1)
        if (!startSlot || !endSlot) {
          logger.warn(`[WakeUpAPI] 无法找到节次 ${course.startNode} 或 ${course.startNode + course.step - 1} 的时间定义，跳过课程 ${name}`)
          return null
        }
        startTime = startSlot.start
        endTime = endSlot.end
      } else {
        logger.warn(`[WakeUpAPI] 课程 ${name} 缺少时间信息，跳过`)
        return null
      }

      // 解析周次
      let weeks
      if (course.weeks && Array.isArray(course.weeks)) {
        weeks = course.weeks
      } else if (course.startWeek != null && course.endWeek != null) {
        weeks = []
        const type = course.type || 0
        for (let w = course.startWeek; w <= course.endWeek; w++) {
          if (type === 0 || type % 2 === w % 2) weeks.push(w)
        }
      } else {
        logger.warn(`[WakeUpAPI] 课程 ${name} 缺少周次信息，跳过`)
        return null
      }

      return {
        name,
        teacher: course.teacher || '',
        location: course.room || course.location || '',
        day: course.day,
        startTime,
        endTime,
        weeks,
        startNode: course.startNode,
        step: course.step
      }
    }).filter(c => c !== null)

  } else {
    // --- 标准格式：课程直接包含 startTime/endTime/weeks ---
    courses = rawCourses.map(course => {
      if (!course.name || !course.day || !course.startTime || !course.endTime) {
        logger.warn(`[WakeUpAPI] 课程缺少必要字段，跳过: ${JSON.stringify(course)}`)
        return null
      }

      let weeks
      if (course.weeks && Array.isArray(course.weeks)) {
        weeks = course.weeks
      } else if (course.startWeek != null && course.endWeek != null) {
        weeks = []
        const type = course.type || 0
        for (let w = course.startWeek; w <= course.endWeek; w++) {
          if (type === 0 || type % 2 === w % 2) weeks.push(w)
        }
      } else {
        logger.warn(`[WakeUpAPI] 课程 ${course.name} 缺少周次信息，跳过`)
        return null
      }

      return {
        name: course.name,
        teacher: course.teacher || '',
        location: course.location || course.room || course.position || '',
        day: course.day,
        startTime: course.startTime,
        endTime: course.endTime,
        weeks,
        startNode: course.startNode || course.startSection,
        step: course.step || (course.startSection && course.endSection ? course.endSection - course.startSection + 1 : undefined)
      }
    }).filter(c => c !== null)
  }

  if (!courses.length) {
    throw new Error('解析后没有有效的课程数据')
  }

  return { tableName, semesterStart, courses }
}

/**
 * 从 ICS 文本解析课表数据（ICS 格式响应的兜底处理）
 * @param {string} icsText - ICS 文件文本
 * @returns {object} 标准课表数据 { tableName, semesterStart, courses }
 */
async function parseIcsToSchedule(icsText) {
  // 动态导入 ical-expander
  let ICalExpander
  try {
    const module = await import('ical-expander')
    ICalExpander = module.default || module.ICalExpander
  } catch {
    throw new Error('ICS 格式需要 ical-expander 依赖，但未能加载')
  }

  const expander = new ICalExpander({ ics: icsText, maxIterations: 5000 })
  const all = expander.between(new Date(2000, 0, 1), new Date(2100, 0, 1))
  const occurrences = [...(all.events || []), ...(all.occurrences || [])]

  if (occurrences.length === 0) {
    throw new Error('ICS 数据中未找到任何课程事件')
  }

  // 计算学期开始日期（最早事件所在周的周一）
  const dates = occurrences.map(o => {
    let sd = o.startDate
    if (typeof sd.toJSDate === 'function') sd = sd.toJSDate()
    return sd
  })
  const earliest = new Date(Math.min(...dates.map(d => d.getTime())))
  const semesterStartDate = new Date(earliest)
  semesterStartDate.setDate(semesterStartDate.getDate() - ((semesterStartDate.getDay() + 6) % 7))
  const semesterStart = [
    semesterStartDate.getFullYear(),
    String(semesterStartDate.getMonth() + 1).padStart(2, '0'),
    String(semesterStartDate.getDate()).padStart(2, '0')
  ].join('-')

  // 计算周数
  const semesterStartMs = semesterStartDate.getTime()
  const msPerWeek = 7 * 24 * 60 * 60 * 1000
  const getWeek = (date) => {
    const diffMs = date.getTime() - semesterStartMs
    return Math.floor(diffMs / msPerWeek) + 1
  }

  const courseMap = new Map()
  for (const occ of occurrences) {
    let startDate = occ.startDate
    let endDate = occ.endDate
    if (typeof startDate.toJSDate === 'function') startDate = startDate.toJSDate()
    if (typeof endDate.toJSDate === 'function') endDate = endDate.toJSDate()

    const ev = occ.item || occ
    const summary = ev.summary || '未知课程'

    // 从 location 提取教师（WakeUp ICS 格式：地点 教师）
    let rawLocation = (ev.location || '').trim()
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

    // 从 description 提取教师（新格式）
    if (!teacher && ev.description) {
      const lines = ev.description.split('\n').filter(l => l.trim())
      if (lines.length > 0) {
        teacher = lines[lines.length - 1].replace(/[。.]$/, '').trim()
      }
    }

    const weekday = startDate.getDay() || 7
    const startTime = [startDate.getHours(), startDate.getMinutes()]
      .map(n => String(n).padStart(2, '0')).join(':')
    const endTime = [endDate.getHours(), endDate.getMinutes()]
      .map(n => String(n).padStart(2, '0')).join(':')

    const week = getWeek(startDate)
    if (week === null || week < 1) continue

    const key = `${summary}|${weekday}|${startTime}|${endTime}|${location}|${teacher}`
    if (!courseMap.has(key)) {
      courseMap.set(key, {
        name: summary, day: weekday, startTime, endTime,
        weeks: new Set(), location, teacher
      })
    }
    courseMap.get(key).weeks.add(week)
  }

  const courses = Array.from(courseMap.values()).map(c => ({
    ...c,
    weeks: Array.from(c.weeks).sort((a, b) => a - b)
  }))

  if (!courses.length) {
    throw new Error('未能从 ICS 数据中解析出有效的课程')
  }

  return { tableName: 'WakeUp课表', semesterStart, courses }
}

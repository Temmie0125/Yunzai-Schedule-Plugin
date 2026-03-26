// services/wakeupApi.js
import https from 'node:https'

/**
 * 从WakeUp API获取课表数据
 * @param {string} code - 分享口令
 * @returns {Promise<object>} 解析后的课表数据
 */
export function fetchScheduleFromAPI(code) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: { version: '280', 'User-Agent': 'Mozilla/5.0' }
    }
    const urls = [
      `https://api.wakeup.fun/share_schedule/get?key=${code}`,
      `https://i.wakeup.fun/share_schedule/get?key=${code}`
    ]

    const tryFetch = (index) => {
      if (index >= urls.length) return reject(new Error('所有API请求失败'))
      const req = https.get(urls[index], options, (res) => {
        let raw = ''
        res.on('data', chunk => raw += chunk)
        res.on('end', () => {
          try {
            const result = JSON.parse(raw)
            if (result?.data) resolve(parseScheduleData(result.data))
            else tryFetch(index + 1)
          } catch {
            tryFetch(index + 1)
          }
        })
      })
      req.on('error', () => tryFetch(index + 1))
      req.setTimeout(10000, () => { req.destroy(); tryFetch(index + 1) })
    }
    tryFetch(0)
  })
}

/**
 * 解析原始数据
 * @param {string} rawData - API返回的原始数据（多行JSON）
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
      id: course.id,
      name: courseInfo[course.id],
      teacher: course.teacher,
      weeks,
      day: course.day.toString(),
      startTime,
      endTime,
      location: course.room,
      startNode: course.startNode,
      step: course.step,
      credit: course.credit,
      type: course.type
    }
  })

  return { tableName, semesterStart, courses }
}
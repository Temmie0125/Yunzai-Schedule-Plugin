// services/wakeupApi.js
import https from 'node:https'
import http from 'node:http'
import { ConfigManager } from '../components/ConfigManager.js'

/** 
 * 从WakeUp API获取课表数据（原直连方式，现在已不可用，仅作为保留）
 * @param {string} code - 分享口令
 * @returns {Promise<object>} 解析后的课表数据
 */
function fetchScheduleFromDirect(code) {
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
 * 通过中转服务获取课表数据
 * @param {string} code - 分享口令
 * @param {string} proxyUrl - 中转服务地址, 请填写http://${URL}:19178
 * @param {string} apiToken - API Token
 * @returns {Promise<object>}
 */
function fetchScheduleFromProxy(code, proxyUrl, apiToken) {
  return new Promise((resolve, reject) => {
    // 解析URL
    let urlObj
    try {
      urlObj = new URL(proxyUrl)
    } catch (err) {
      return reject(new Error(`无效的中转服务地址: ${proxyUrl}`))
    }
    const isHttps = urlObj.protocol === 'https:'
    const requestModule = isHttps ? https : http

    const postData = JSON.stringify({
      shareToken: code,
      apiToken: apiToken
    })

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: '/api/schedule',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 15000  // 15秒超时
    }

    const req = requestModule.request(options, (res) => {
      let raw = ''
      res.on('data', chunk => raw += chunk)
      res.on('end', () => {
        try {
          const response = JSON.parse(raw);
          if (response.code === 0 && response.data) {
            const decoded = Buffer.from(response.data, 'base64').toString('utf-8');
            let rawDataString = decoded;
            try {
              const maybeJson = JSON.parse(decoded);
              if (maybeJson && typeof maybeJson === 'object' && maybeJson.shareData) {
                if (typeof maybeJson.shareData === 'string') {
                  rawDataString = maybeJson.shareData;
                  try {
                    rawDataString = JSON.parse(rawDataString);
                  } catch {
                  }
                } else {
                  rawDataString = maybeJson.shareData;
                }
              }
            } catch {
            }
            if (typeof rawDataString !== 'string') {
              throw new Error('解码后的数据不是字符串格式');
            }
            resolve(parseScheduleData(rawDataString));
          } else {
            reject(new Error(response.message || '中转服务返回错误'));
          }
        } catch (err) {
          reject(new Error(`解析中转服务响应失败: ${err.message}\n原始数据: ${raw}`));
        }
      })
    })

    req.on('error', (err) => {
      reject(new Error(`请求中转服务失败: ${err.message}`))
    })

    req.on('timeout', () => {
      req.destroy()
      reject(new Error('请求中转服务超时'))
    })

    req.write(postData)
    req.end()
  })
}

/**
 * 对外主函数：根据配置自动选择直连或中转
 * @param {string} code - 分享口令
 * @returns {Promise<object>}
 */
export function fetchScheduleFromAPI(code) {
  const config = ConfigManager.getConfig()
  const { proxyUrl, apiToken } = config

  // 如果配置了中转服务地址且 Token 非空，则使用中转服务
  if (proxyUrl && proxyUrl.trim() !== '' && apiToken && apiToken.trim() !== '') {
    // logger.info('[WakeUpAPI] 使用中转服务获取课表数据')
    return fetchScheduleFromProxy(code, proxyUrl, apiToken)
  } else {
    // logger.info('[WakeUpAPI] 使用直连方式获取课表数据')
    return fetchScheduleFromDirect(code)
  }
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
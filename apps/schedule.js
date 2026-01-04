import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'

export class SchedulePlugin extends plugin {
  constructor() {
    super({
      name: "课程表插件",
      dsc: "WakeUp课程表导入与查询功能",
      event: "message",
      priority: 1000,
      rule: [
        {
          reg: "^#(设置课表|schedule set)(?:\\s+(.+))?$",
          fnc: "setSchedule"
        },
        {
          reg: "^#(清除课表|schedule (clear|delete))$",
          fnc: "clearSchedule"
        },
        {
          reg: "^#(课表设置昵称|schedule setname)(?:\\s+(.+))?$",
          fnc: "setNickname"
        },
        {
          reg: "^#(课表设置签名|schedule setsign)(?:\\s+(.+))?$",
          fnc: "setSignature"
        },
        {
          reg: "^#(今日课表|schedule today)$",
          fnc: "showTodaySchedule"
        },
        {
          reg: "^#(明日课表|schedule tomorrow)$",
          fnc: "showTomorrowSchedule"
        },
        {
          reg: "^#(课表查询|schedule query)(?:\\s+(\\d+)\\s+(\\d+))?$",
          fnc: "querySchedule"
        },
        {
          reg: "^#(我的课表|schedule info)$",
          fnc: "showUserInfo"
        },
        {
          reg: "^#(课表帮助|schedule help)$",
          fnc: "showHelp"
        }
      ]
    })

    // 数据存储路径
    this.dataPath = 'plugins/schedule/data/'
  }

  /**
   * 帮助
   */
  async showHelp(e) {
    const replyMsg = `课程表帮助\n` +
      `==========\n` +
      `【#设置课表 WakeUP分享口令】设置课程表\n` +
      `【#清除课表】清除自己的课表\n` +
      `【#课表设置昵称 昵称】修改昵称\n` +
      `【#课表设置签名 签名】设置个性签名(最多30字)\n` +  // 新增
      `【#今日课表|明日课表】查看自己今日/明日课表\n` +
      `【#课表查询 周数 星期】查看自己某日的课表\n` +
      `【#我的课表】查看自己的相关信息\n` +
      `【#课程表|群课表】查看（视奸）群友的上课状态\n` +
      `【#翘课|取消翘课】开关翘课状态`
    return e.reply(replyMsg);
  }

  /**
   * 设置课表
   */
  async setSchedule() {
    const userId = this.e.user_id
    const message = this.e.msg

    // 提取口令
    let code = message.match(/^#(?:设置课表|schedule set)\s+(.+)$/)?.[1]

    if (!code) {
      // 如果没有参数，进入交互模式
      this.setContext("waitingForCode")
      await this.reply("请发送你的WakeUp课程表分享口令（可以从WakeUp应用分享获取）", false, { at: true })
      return true
    }

    // 处理口令
    code = code.trim()

    // 如果是分享格式，提取其中的口令
    const match = code.match(/「([0-9a-zA-Z\-_]+?)」/u)
    if (match) {
      code = match[1]
    } else if (!/^[0-9a-zA-Z\-_]+$/u.test(code)) {
      await this.reply("口令格式不正确，请确保是WakeUp课程表的正确分享口令")
      return false
    }

    // 获取课程表数据
    try {
      const scheduleData = await this.fetchScheduleFromAPI(code)
      if (!scheduleData) {
        await this.reply("获取课程表失败，请检查口令是否正确或是否已过期")
        return false
      }

      // 尝试获取昵称
      let nickname = await this.getUserNickname(userId, this.e)

      // 如果无法获取昵称，提示用户设置
      if (!nickname) {
        nickname = userId.toString()
        const replyMsg = `课程表设置成功！\n` +
          `课表名称：${scheduleData.tableName}\n` +
          `学期开始：${scheduleData.semesterStart}\n` +
          `共 ${scheduleData.courses.length} 门课程\n\n` +
          `⚠️ 未获取到您的昵称，可使用 #课表设置昵称 命令设置昵称，以便在群内显示`

        await this.reply(replyMsg)
      } else {
        await this.reply(`课程表设置成功！\n` +
          `课表名称：${scheduleData.tableName}\n` +
          `学期开始：${scheduleData.semesterStart}\n` +
          `共 ${scheduleData.courses.length} 门课程\n` +
          `昵称：${nickname}`)
      }

      // 保存数据（包含昵称）
      this.saveScheduleData(userId, scheduleData, nickname)

    } catch (error) {
      logger.error(`设置课表失败: ${error}`)
      await this.reply("设置课表失败，请稍后重试")
      return false
    }

    return true
  }

  /**
   * 等待用户发送口令（上下文模式）
   */
  async waitingForCode() {
    const userId = this.e.user_id
    let code = this.e.msg.trim()

    // 结束上下文
    this.finish("waitingForCode")

    // 处理口令
    const match = code.match(/「([0-9a-zA-Z\-_]+?)」/u)
    if (match) {
      code = match[1]
    } else if (!/^[0-9a-zA-Z\-_]+$/u.test(code)) {
      await this.reply("口令格式不正确，请确保是WakeUp课程表的正确分享口令")
      return false
    }

    // 获取课程表数据
    try {
      const scheduleData = await this.fetchScheduleFromAPI(code)
      if (!scheduleData) {
        await this.reply("获取课程表失败，请检查口令是否正确或是否已过期")
        return false
      }

      // 尝试获取昵称
      let nickname = await this.getUserNickname(userId, this.e)

      // 如果无法获取昵称，提示用户设置
      if (!nickname) {
        nickname = userId.toString()
        const replyMsg = `课程表设置成功！\n` +
          `课表名称：${scheduleData.tableName}\n` +
          `学期开始：${scheduleData.semesterStart}\n` +
          `共 ${scheduleData.courses.length} 门课程\n\n` +
          `⚠️ 未获取到您的昵称，可使用 #课表设置昵称 命令设置昵称，以便在群内显示`

        await this.reply(replyMsg)
      } else {
        await this.reply(`课程表设置成功！\n` +
          `课表名称：${scheduleData.tableName}\n` +
          `学期开始：${scheduleData.semesterStart}\n` +
          `共 ${scheduleData.courses.length} 门课程\n` +
          `昵称：${nickname}`)
      }

      // 保存数据（包含昵称）
      this.saveScheduleData(userId, scheduleData, nickname)

    } catch (error) {
      logger.error(`设置课表失败: ${error}`)
      await this.reply("设置课表失败，请稍后重试")
    }

    return true
  }

  /**
   * 课表昵称
   */
  async setNickname() {
    const userId = this.e.user_id
    const message = this.e.msg

    // 提取昵称
    const match = message.match(/^#(?:课表设置昵称|schedule setname)\s+(.+)$/)
    if (!match) {
      this.setContext("waitingForNickname")
      await this.reply("请发送你想要设置的昵称", false, { at: true })
      return true
    }

    const nickname = match[1].trim()

    // 昵称长度检查
    if (nickname.length > 20) {
      await this.reply("昵称太长了，请控制在20个字符以内")
      return false
    }

    // 保存昵称
    const success = await this.saveUserNickname(userId, nickname)

    if (success) {
      await this.reply(`昵称设置成功：${nickname}`)
      logger.info(`用户 ${userId} 设置昵称为：${nickname}`)
    } else {
      await this.reply("昵称设置失败，请重试")
    }

    return true
  }

  /**
   * 等待用户发送昵称（上下文模式）
   */
  async waitingForNickname() {
    const userId = this.e.user_id
    const nickname = this.e.msg.trim()

    // 结束上下文
    this.finish("waitingForNickname")

    // 昵称长度检查
    if (nickname.length > 20) {
      await this.reply("昵称太长了，请控制在20个字符以内")
      return false
    }

    // 保存昵称
    const success = await this.saveUserNickname(userId, nickname)

    if (success) {
      await this.reply(`昵称设置成功：${nickname}`)
      logger.info(`用户 ${userId} 设置昵称为：${nickname}`)
    } else {
      await this.reply("昵称设置失败，请重试")
    }

    return true
  }
  /**
 * 设置个性签名
 */
  async setSignature() {
    const userId = this.e.user_id
    const message = this.e.msg

    // 提取签名
    const match = message.match(/^#(?:课表设置签名|schedule setsign)\s+(.+)$/)
    if (!match) {
      this.setContext("waitingForSignature")
      await this.reply("请发送你想要设置的个性签名（最多30字）", false, { at: true })
      return true
    }

    let signature = match[1].trim()

    // 签名长度检查
    if (signature.length > 30) {
      await this.reply("签名太长了，请控制在30字以内")
      return false
    }

    // 保存签名
    const success = await this.saveUserSignature(userId, signature)

    if (success) {
      await this.reply(`个性签名设置成功：${signature}`)
      logger.info(`用户 ${userId} 设置个性签名：${signature}`)
    } else {
      await this.reply("签名设置失败，请重试")
    }

    return true
  }
  /**
 * 等待用户发送签名（上下文模式）
 */
  async waitingForSignature() {
    const userId = this.e.user_id
    let signature = this.e.msg.trim()

    // 结束上下文
    this.finish("waitingForSignature")

    // 签名长度检查
    if (signature.length > 30) {
      await this.reply("签名太长了，请控制在30字以内")
      return false
    }

    // 保存签名
    const success = await this.saveUserSignature(userId, signature)

    if (success) {
      await this.reply(`个性签名设置成功：${signature}`)
      logger.info(`用户 ${userId} 设置个性签名：${signature}`)
    } else {
      await this.reply("签名设置失败，请重试")
    }

    return true
  }

  /**
   * 保存用户个性签名
   */
  async saveUserSignature(userId, signature) {
    try {
      const filePath = path.join(this.dataPath, `${userId}.json`)

      if (fs.existsSync(filePath)) {
        // 读取现有数据
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
        // 更新签名
        data.signature = signature
        data.updateTime = new Date().toISOString()
        // 保存数据
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
      } else {
        // 如果还没有课程表数据，创建新的数据文件
        const data = {
          tableName: '未设置',
          semesterStart: new Date().toISOString().split('T')[0],
          updateTime: new Date().toISOString(),
          nickname: userId.toString(),
          signature: signature,  // 新增签名字段
          courses: []
        }
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
      }

      return true
    } catch (error) {
      logger.error(`保存用户 ${userId} 签名失败: ${error}`)
      return false
    }
  }

  /**
   * 显示用户课表信息
   */
  async showUserInfo() {
    const userId = this.e.user_id
    const scheduleData = this.loadScheduleData(userId)

    if (!scheduleData) {
      await this.reply("你还没有设置课程表，请使用 #设置课表 命令导入课表")
      return false
    }

    // 获取当前周数
    const currentWeek = this.calculateCurrentWeek(scheduleData.semesterStart)

    // 统计课程数量
    const totalCourses = scheduleData.courses.length
    const thisWeekCourses = scheduleData.courses.filter(course =>
      course.weeks.includes(currentWeek)
    ).length

    let reply = `📊 你的课表信息\n`
    reply += "=".repeat(20) + "\n"
    reply += `👤 昵称：${scheduleData.nickname || userId}\n`
    // 新增：显示签名
    if (scheduleData.signature) {
      reply += `💭 签名：${scheduleData.signature}\n`
    }
    reply += `📚 课表：${scheduleData.tableName}\n`
    reply += `📅 学期：${scheduleData.semesterStart}\n`
    reply += `🔄 当前周数：第${currentWeek}周\n`
    reply += `📈 课程统计：\n`
    reply += `   总课程数：${totalCourses} 门\n`
    reply += `   本周课程：${thisWeekCourses} 门\n`
    reply += `⏰ 最后更新：${new Date(scheduleData.updateTime).toLocaleString()}\n\n`
    reply += `使用命令：\n`
    reply += `#今日课表 - 查看今日课程\n`
    reply += `#明日课表 - 查看明日课程\n`
    reply += `#课表查询 [周数] [星期] - 查询特定日期课程\n`
    reply += `#课表设置昵称 [昵称] - 修改昵称`

    await this.reply(reply)
    return true
  }

  /**
   * 获取用户昵称
   */
  async getUserNickname(userId, event) {
    // 尝试从现有数据中获取昵称
    const existingData = this.loadScheduleData(userId)
    if (existingData && existingData.nickname) {
      return existingData.nickname
    }

    // 如果是群聊，尝试获取群名片或昵称
    if (event.isGroup) {
      try {
        // 尝试获取群名片
        if (event.sender && event.sender.card) {
          return event.sender.card.trim()
        }

        // 尝试获取昵称
        if (event.sender && event.sender.nickname) {
          return event.sender.nickname.trim()
        }
      } catch (error) {
        logger.warn(`获取用户 ${userId} 昵称失败: ${error}`)
      }
    }

    // 私聊或获取失败时返回null
    return null
  }

  /**
   * 保存用户昵称
   */
  async saveUserNickname(userId, nickname) {
    try {
      const filePath = path.join(this.dataPath, `${userId}.json`)

      if (fs.existsSync(filePath)) {
        // 读取现有数据
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
        // 更新昵称
        data.nickname = nickname
        data.updateTime = new Date().toISOString()
        // 保存数据
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
      } else {
        // 创建新的数据文件
        const data = {
          tableName: '未设置',
          semesterStart: new Date().toISOString().split('T')[0],
          updateTime: new Date().toISOString(),
          nickname: nickname,
          courses: []
        }
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
      }

      return true
    } catch (error) {
      logger.error(`保存用户 ${userId} 昵称失败: ${error}`)
      return false
    }
  }

  /**
   * 保存课程表数据（包含昵称）
   */
  saveScheduleData(userId, scheduleData, nickname = null) {
    const filePath = path.join(this.dataPath, `${userId}.json`)

    // 构建完整的数据对象
    const fullData = {
      tableName: scheduleData.tableName,
      semesterStart: scheduleData.semesterStart,
      updateTime: new Date().toISOString(),
      nickname: nickname || userId.toString(),
      courses: scheduleData.courses
    }

    fs.writeFileSync(filePath, JSON.stringify(fullData, null, 2), 'utf8')
    logger.info(`用户 ${userId} (${nickname || '未设置昵称'}) 的课程表已保存`)
  }

  /**
   * 清除课表
   */
  async clearSchedule() {
    const userId = this.e.user_id
    const filePath = path.join(this.dataPath, `${userId}.json`)

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
      await this.reply("你的课程表已清除")
      logger.info(`用户 ${userId} 的课程表已清除`)
    } else {
      await this.reply("你还没有设置课程表")
    }

    return true
  }

  /**
   * 显示今日课表（使用昵称）
   */
  async showTodaySchedule() {
    const userId = this.e.user_id
    const schedule = this.loadScheduleData(userId)

    if (!schedule) {
      await this.reply("请先使用 #设置课表 命令导入你的课程表")
      return false
    }

    // 获取今天是星期几 (0=周日, 1=周一, ..., 6=周六)
    const today = new Date().getDay()
    // 转换为课表格式 (1=周一, ..., 7=周日)
    const day = today === 0 ? 7 : today

    // 计算当前周数
    const currentWeek = this.calculateCurrentWeek(schedule.semesterStart)

    // 筛选今日课程
    const todayCourses = schedule.courses.filter(course =>
      course.day === day.toString() && course.weeks.includes(currentWeek)
    )

    // 使用昵称显示
    const displayName = schedule.nickname || `用户${userId}`

    if (todayCourses.length === 0) {
      await this.reply(`${displayName} 的第${currentWeek}周 星期${day}没有课程`)
      return true
    }

    // 按时间排序
    todayCourses.sort((a, b) => a.startTime.localeCompare(b.startTime))

    // 生成回复
    let reply = `${displayName} 的第${currentWeek}周 星期${day} 课程安排\n`
    reply += "=".repeat(25) + "\n"

    todayCourses.forEach((course, index) => {
      reply += `${index + 1}. ${course.name}\n`
      reply += `   👨‍🏫 ${course.teacher || '未知教师'}\n`
      reply += `   🕐 ${course.startTime} - ${course.endTime}\n`
      reply += `   📍 ${course.location || '未知地点'}\n`
      if (index < todayCourses.length - 1) reply += "\n"
    })

    await this.reply(reply)
    return true
  }

  /**
   * 显示明日课表（使用昵称）
   */
  async showTomorrowSchedule() {
    const userId = this.e.user_id
    const schedule = this.loadScheduleData(userId)

    if (!schedule) {
      await this.reply("请先使用 #设置课表 命令导入你的课程表")
      return false
    }

    // 获取明天是星期几
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const day = tomorrow.getDay() === 0 ? 7 : tomorrow.getDay()

    // 计算当前周数
    const currentWeek = this.calculateCurrentWeek(schedule.semesterStart)

    // 筛选明日课程
    const tomorrowCourses = schedule.courses.filter(course =>
      course.day === day.toString() && course.weeks.includes(currentWeek)
    )

    // 使用昵称显示
    const displayName = schedule.nickname || `用户${userId}`

    if (tomorrowCourses.length === 0) {
      await this.reply(`${displayName} 的第${currentWeek}周 星期${day}没有课程`)
      return true
    }

    // 按时间排序
    tomorrowCourses.sort((a, b) => a.startTime.localeCompare(b.startTime))

    // 生成回复
    let reply = `${displayName} 的明日（第${currentWeek}周 星期${day}）课程安排\n`
    reply += "=".repeat(25) + "\n"

    tomorrowCourses.forEach((course, index) => {
      reply += `${index + 1}. ${course.name}\n`
      reply += `   👨‍🏫 ${course.teacher || '未知教师'}\n`
      reply += `   🕐 ${course.startTime} - ${course.endTime}\n`
      reply += `   📍 ${course.location || '未知地点'}\n`
      if (index < tomorrowCourses.length - 1) reply += "\n"
    })

    await this.reply(reply)
    return true
  }

  /**
   * 查询特定日期课程
   */
  async querySchedule() {
    const userId = this.e.user_id
    const schedule = this.loadScheduleData(userId)

    if (!schedule) {
      await this.reply("请先使用 #设置课表 命令导入你的课程表")
      return false
    }

    const matches = this.e.msg.match(/^#(?:课表查询|schedule query)(?:\s+(\d+)\s+(\d+))?$/)
    let week, day

    if (matches && matches[1] && matches[2]) {
      // 用户指定了周数和星期
      week = parseInt(matches[1])
      day = parseInt(matches[2])

      if (day < 1 || day > 7) {
        await this.reply("星期数应在1-7之间（1=周一，7=周日）")
        return false
      }
    } else {
      // 显示当前周数，提示用户输入
      const currentWeek = this.calculateCurrentWeek(schedule.semesterStart)
      await this.reply(`当前是第${currentWeek}周\n请使用命令格式：#课表查询 [周数] [星期]\n例如：#课表查询 ${currentWeek} 1`)
      return true
    }

    // 筛选课程
    const targetCourses = schedule.courses.filter(course =>
      course.day === day.toString() && course.weeks.includes(week)
    )

    // 使用昵称显示
    const displayName = schedule.nickname || `用户${userId}`

    if (targetCourses.length === 0) {
      await this.reply(`${displayName} 的第${week}周 星期${day}没有课程`)
      return true
    }

    // 按时间排序
    targetCourses.sort((a, b) => a.startTime.localeCompare(b.startTime))

    // 生成回复
    let reply = `${displayName} 的第${week}周 星期${day} 课程安排\n`
    reply += "=".repeat(25) + "\n"

    targetCourses.forEach((course, index) => {
      reply += `${index + 1}. ${course.name}\n`
      reply += `   👨‍🏫 ${course.teacher || '未知教师'}\n`
      reply += `   🕐 ${course.startTime} - ${course.endTime}\n`
      reply += `   📍 ${course.location || '未知地点'}\n`
      if (index < targetCourses.length - 1) reply += "\n"
    })

    await this.reply(reply)
    return true
  }

  /**
   * 加载课程表数据
   */
  loadScheduleData(userId) {
    const filePath = path.join(this.dataPath, `${userId}.json`)

    if (fs.existsSync(filePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
        return data
      } catch (error) {
        logger.error(`读取用户 ${userId} 课程表失败: ${error}`)
        return null
      }
    }

    return null
  }

  /**
   * 计算当前周数
   */
  calculateCurrentWeek(semesterStart) {
    const startDate = new Date(semesterStart)
    const now = new Date()

    // 计算天数差
    const timeDiff = now.getTime() - startDate.getTime()
    const dayDiff = Math.floor(timeDiff / (1000 * 3600 * 24))

    // 计算周数（向上取整，第一周从1开始）
    const week = Math.ceil(dayDiff / 7)

    return Math.max(1, week) // 确保周数至少为1
  }

  /**
   * 从WakeUp API获取课程表数据
   */
  async fetchScheduleFromAPI(code) {
    return new Promise((resolve, reject) => {
      const options = {
        method: 'GET',
        headers: {
          'version': '280',
          'User-Agent': 'Mozilla/5.0'
        }
      }

      const tryApis = [
        `https://api.wakeup.fun/share_schedule/get?key=${code}`,
        `https://i.wakeup.fun/share_schedule/get?key=${code}`
      ]

      const tryFetch = (urlIndex) => {
        if (urlIndex >= tryApis.length) {
          reject(new Error('所有API请求都失败'))
          return
        }

        const url = tryApis[urlIndex]
        const req = https.get(url, options, (res) => {
          let data = ''

          res.on('data', (chunk) => {
            data += chunk
          })

          res.on('end', () => {
            try {
              const result = JSON.parse(data)
              if (result && result.data) {
                // 解析数据
                const scheduleData = this.parseScheduleData(result.data)
                resolve(scheduleData)
              } else {
                // 尝试下一个API
                tryFetch(urlIndex + 1)
              }
            } catch (e) {
              // 尝试下一个API
              tryFetch(urlIndex + 1)
            }
          })
        })

        req.on('error', (error) => {
          // 尝试下一个API
          tryFetch(urlIndex + 1)
        })

        req.setTimeout(10000, () => {
          req.destroy()
          tryFetch(urlIndex + 1)
        })
      }

      tryFetch(0)
    })
  }

  /**
   * 解析课程表数据
   */
  parseScheduleData(rawData) {
    const data = rawData.split('\n').map(json => JSON.parse(json))

    // 提取节点信息
    const nodesInfo = {}
    data[1].forEach(node => {
      nodesInfo[node.node] = node
    })

    // 提取课程信息
    const courseInfo = {}
    data[3].forEach(course => {
      courseInfo[course.id] = course.courseName
    })

    // 基本信息
    const tableName = data[2].tableName
    const semesterStart = data[2].startDate

    // 解析课程
    const courses = []
    data[4].forEach(course => {
      // 计算上课周数
      const weeks = []
      for (let i = course.startWeek; i <= course.endWeek; i++) {
        if (course.type === 0 || course.type % 2 === i % 2) {
          weeks.push(i)
        }
      }

      // 计算上课时间
      let startTime, endTime
      if (course.ownTime) {
        startTime = course.startTime
        endTime = course.endTime
      } else {
        startTime = nodesInfo[course.startNode].startTime
        endTime = nodesInfo[course.startNode + course.step - 1].endTime
      }

      courses.push({
        id: course.id,
        name: courseInfo[course.id],
        teacher: course.teacher,
        weeks: weeks,
        day: course.day.toString(), // 星期几 (1-7)
        startTime: startTime,
        endTime: endTime,
        location: course.room,
        startNode: course.startNode,
        step: course.step,
        credit: course.credit,
        type: course.type
      })
    })

    return {
      tableName,
      semesterStart,
      updateTime: new Date().toISOString(),
      courses
    }
  }
}

export default SchedulePlugin
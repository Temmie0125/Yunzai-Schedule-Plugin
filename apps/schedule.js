//import fs from 'node:fs'
//import path from 'node:path'
//import https from 'node:https'
import { DataManager } from '../components/DataManager.js'
import { fetchScheduleFromAPI } from '../services/wakeupApi.js'
import { calculateCurrentWeek } from '../utils/timeUtils.js'

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
    //this.dataPath = 'plugins/schedule/data/'
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
 * 设置课表（修改版本，保留原有昵称和签名）
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
      return true
    }

    // 获取课程表数据
    try {
      const scheduleData = await fetchScheduleFromAPI(code)
      if (!scheduleData) return this.reply('获取课表失败，请检查口令')
      const oldData = DataManager.loadSchedule(userId)
      let nickname = oldData?.nickname
      let signature = oldData?.signature
      if (!nickname) {
        nickname = (await DataManager.getUserNickname(userId, this.e)) || userId.toString()
      }
      DataManager.saveSchedule(userId, scheduleData, nickname, signature)
      let reply = `课程表设置成功！\n课表名称：${scheduleData.tableName}\n学期开始：${scheduleData.semesterStart}\n共 ${scheduleData.courses.length} 门课程\n昵称：${nickname}`
      if (signature) reply += `\n签名：${signature}`
      if (nickname === userId.toString()) {
        reply += `\n⚠️ 建议使用 #课表设置昵称 设置昵称`
      }
      await this.reply(reply)
    } catch (err) {
      logger.error(`设置课表失败: ${err}`)
      await this.reply('设置课表失败，请稍后重试')
    }
    return true
  }


  /**
   * 等待用户发送口令（上下文模式，修改版本）
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
      return true
    }
    // 获取课程表数据
    try {
      const scheduleData = await fetchScheduleFromAPI(code)
      if (!scheduleData) return this.reply('获取课表失败，请检查口令')
      const oldData = DataManager.loadSchedule(userId)
      let nickname = oldData?.nickname
      let signature = oldData?.signature
      if (!nickname) {
        nickname = (await DataManager.getUserNickname(userId, this.e)) || userId.toString()
      }
      DataManager.saveSchedule(userId, scheduleData, nickname, signature)
      let reply = `课程表设置成功！\n课表名称：${scheduleData.tableName}\n学期开始：${scheduleData.semesterStart}\n共 ${scheduleData.courses.length} 门课程\n昵称：${nickname}`
      if (signature) reply += `\n签名：${signature}`
      if (nickname === userId.toString()) {
        reply += `\n⚠️ 建议使用 #课表设置昵称 设置昵称`
      }
      await this.reply(reply)
    } catch (err) {
      logger.error(`设置课表失败: ${err}`)
      await this.reply('设置课表失败，请稍后重试')
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
    const success = await DataManager.saveUserNickname(userId, nickname)

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
    const success = await DataManager.saveUserNickname(userId, nickname)

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
    const success = await DataManager.saveUserSignature(userId, signature)

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
    const success = await DataManager.saveUserSignature(userId, signature)

    if (success) {
      await this.reply(`个性签名设置成功：${signature}`)
      logger.info(`用户 ${userId} 设置个性签名：${signature}`)
    } else {
      await this.reply("签名设置失败，请重试")
    }

    return true
  }


  /**
   * 显示用户课表信息
   */
  async showUserInfo() {
    const userId = this.e.user_id
    const scheduleData = DataManager.loadSchedule(userId)

    if (!scheduleData) {
      await this.reply("你还没有设置课程表，请使用 #设置课表 命令导入课表")
      return false
    }

    // 获取当前周数
    const currentWeek = calculateCurrentWeek(scheduleData.semesterStart);
    const maxWeek = Math.max(...scheduleData.courses.flatMap(c => c.weeks), 0);
    if (maxWeek > 0 && currentWeek > maxWeek) {
      await this.reply("📅 本学期课程已全部结束，请使用 #设置课表 导入新学期课程。");
      return true;
    }

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
   * 清除课表
   */
  async clearSchedule() {
    const userId = this.e.user_id;
    const result = DataManager.clearUserCourses(userId);
    if (result.success) {
      await this.reply("你的课程表已清除");
    } else {
      if (!result.exists) {
        await this.reply("你还没有设置课程表");
      } else {
        await this.reply("清除课程表失败，请稍后重试");
      }
    }
    return true;
  }
  /**
   * 显示今日课表（使用昵称）
   */
  async showTodaySchedule() {
    const userId = this.e.user_id
    const schedule = DataManager.loadSchedule(userId)

    if (!schedule) {
      await this.reply("请先使用 #设置课表 命令导入你的课程表")
      return false
    }

    // 获取今天是星期几 (0=周日, 1=周一, ..., 6=周六)
    const today = new Date().getDay()
    // 转换为课表格式 (1=周一, ..., 7=周日)
    const day = today === 0 ? 7 : today

    // 计算当前周数
    const currentWeek = calculateCurrentWeek(schedule.semesterStart);
    const maxWeek = Math.max(...schedule.courses.flatMap(c => c.weeks), 0);
    if (maxWeek > 0 && currentWeek > maxWeek) {
      await this.reply("📅 本学期课程已全部结束，请使用 #设置课表 导入新学期课程。");
      return true;
    }

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
    const schedule = DataManager.loadSchedule(userId)
    if (!schedule) {
      await this.reply("请先使用 #设置课表 命令导入你的课程表")
      return false
    }
    // 获取明天是星期几
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const day = tomorrow.getDay() === 0 ? 7 : tomorrow.getDay()
    // 计算当前周数
    const currentWeek = calculateCurrentWeek(schedule.semesterStart);
    const maxWeek = Math.max(...schedule.courses.flatMap(c => c.weeks), 0);
    if (maxWeek > 0 && currentWeek > maxWeek) {
      await this.reply("📅 本学期课程已全部结束，请使用 #设置课表 导入新学期课程。");
      return true;
    }
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
    const schedule = DataManager.loadSchedule(userId)
    if (!schedule) {
      await this.reply("请先使用 #设置课表 命令导入你的课程表")
      return false
    }
    const matches = this.e.msg.match(/^#(?:课表查询|schedule query)(?:\s+(\d+)\s+(\d+))?$/)
    let week, day
    const currentWeek = calculateCurrentWeek(schedule.semesterStart);
    const maxWeek = Math.max(...schedule.courses.flatMap(c => c.weeks), 0);
    if (maxWeek > 0 && currentWeek > maxWeek) {
      await this.reply("📅 本学期课程已全部结束，请使用 #设置课表 导入新学期课程。");
      return true;
    }
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
      //const currentWeek = calculateCurrentWeek(schedule.semesterStart)
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
}
export default SchedulePlugin
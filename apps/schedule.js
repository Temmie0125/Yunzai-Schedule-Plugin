/*
 * @Author: Temmie0125 1179755948@qq.com
 * @Date: 2025-12-26 17:11:34
 * @LastEditors: Temmie0125 1179755948@qq.com
 * @LastEditTime: 2026-03-09 23:45:49
 * @FilePath: \实验与作业e:\bot\Yunzai\plugins\schedule\apps\schedule.js
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
//import fs from 'node:fs'
//import path from 'node:path'
//import https from 'node:https'
import { DataManager } from '../components/DataManager.js'
import { ConfigManager } from '../components/ConfigManager.js'
import { importScheduleFromCode } from '../services/scheduleImporter.js'  // 新增导入
import { calculateCurrentWeek, calculateWeekFromDate, parseDateInput } from '../utils/timeUtils.js';
const config = ConfigManager.getConfig()
const pushCron = config.pushCron  // 存储 cron 供 task 使用
export class SchedulePlugin extends plugin {
  constructor() {
    // 在 constructor 中读取配置
    
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
          reg: "^#(课表查询|schedule query)\\s*(.*)$",
          fnc: "querySchedule"
        },
        {
          reg: "^#(我的课表|schedule info)$",
          fnc: "showUserInfo"
        },
        {
          reg: "^#(课表帮助|schedule help)$",
          fnc: "showHelp"
        },
        // ===== 新增规则：直接识别包含「口令」的消息 =====
        {
          reg: ".*「[0-9a-zA-Z\\-_]+」.*",
          fnc: "handleDirectCode"
        },
        {
          reg: "^#(开启|打开)课表(订阅|提醒)$",
          fnc: "enableReminder"
        },
        {
          reg: "^#(关闭|取消)课表(订阅|提醒)$",
          fnc: "disableReminder"
        },
        /*
        {
          reg: "^#测试明日推送$",
          fnc: "testPushTomorrow"
        }
        */
      ],

      task: [
        {
          name: "推送明日课表",
          cron: pushCron,
          fnc: "pushTomorrowSchedule"
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
      `【#翘课|取消翘课】开关翘课状态\n` +
      `【#开启|关闭课表订阅】开关课表订阅通知（需要加bot好友）`
    return e.reply(replyMsg);
  }

  /**
     * 处理 #设置课表 命令
     */
  async setSchedule() {
    const userId = this.e.user_id;
    const message = this.e.msg;

    let code = message.match(/^#(?:设置课表|schedule set)\s+(.+)$/)?.[1];
    if (!code) {
      this.setContext("waitingForCode");
      await this.reply("请发送你的WakeUp课程表分享口令", false, { at: true });
      return true;
    }

    code = code.trim();
    const match = code.match(/「([0-9a-zA-Z\-_]+?)」/u);
    if (match) {
      code = match[1];
    }

    // 调用服务
    const result = await importScheduleFromCode(userId, code, this.e);
    await this.reply(result.message);
    return true;
  }

  /**
   * 上下文等待口令
   */
  async waitingForCode() {
    const userId = this.e.user_id;
    let code = this.e.msg.trim();
    this.finish("waitingForCode");

    const match = code.match(/「([0-9a-zA-Z\-_]+?)」/u);
    if (match) {
      code = match[1];
    }

    const result = await importScheduleFromCode(userId, code, this.e);
    await this.reply(result.message);
    return true;
  }

  /**
   * 直接处理包含「口令」的消息
   */
  async handleDirectCode() {
    const userId = this.e.user_id;
    const message = this.e.msg;

    const match = message.match(/「([0-9a-zA-Z\-_]+?)」/u);
    if (!match) return false;  // 没有口令，不处理

    const code = match[1];
    const result = await importScheduleFromCode(userId, code, this.e);
    await this.reply(result.message);
    return true;
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
    const userId = this.e.user_id;
    const today = new Date();
    const result = await this.getCoursesForDate(userId, today);
    if (result.error) {
      await this.reply(result.error);
      return true;
    }
    const replyMsg = this.formatCourses(result.courses, result.week, result.day, result.displayName);
    await this.reply(replyMsg);
    return true;
  }

  /**
   * 明日课表
   * @returns 
   */
  async showTomorrowSchedule() {
    const userId = this.e.user_id;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const result = await this.getCoursesForDate(userId, tomorrow);
    if (result.error) {
      await this.reply(result.error);
      return true;
    }
    const replyMsg = this.formatCourses(result.courses, result.week, result.day, result.displayName);
    await this.reply(replyMsg);
    return true;
  }

  /**
   * 查询特定日期课程
   */
  async querySchedule() {
    const userId = this.e.user_id;
    const schedule = DataManager.loadSchedule(userId);
    if (!schedule) {
      await this.reply("你还没有设置课程表，请使用 #设置课表 命令导入课表");
      return false;
    }

    // 获取命令后的参数部分（已去除命令前缀）
    const msg = this.e.msg;
    const match = msg.match(/^#(?:课表查询|schedule query)\s*(.*)$/);
    const param = match ? match[1].trim() : '';

    // 如果没有参数，显示提示
    if (!param) {
      const currentWeek = calculateCurrentWeek(schedule.semesterStart);
      await this.reply(
        `请指定查询条件：\n` +
        `1. 周数 + 星期（如 #课表查询 ${currentWeek} 1）\n` +
        `2. 日期（如 #课表查询 10-1，自动识别学期年份）`
      );
      return true;
    }
    // 1. 尝试匹配原有格式：周数 + 星期
    const weekDayMatch = msg.match(/^#(?:课表查询|schedule query)\s+(\d+)\s+(\d+)$/);
    if (weekDayMatch) {
      const week = parseInt(weekDayMatch[1]);
      const day = parseInt(weekDayMatch[2]);
      if (day < 1 || day > 7) {
        await this.reply("星期数应在1-7之间（1=周一，7=周日）");
        return false;
      }
      const maxWeek = Math.max(...schedule.courses.flatMap(c => c.weeks), 0);
      if (maxWeek > 0 && week > maxWeek) {
        await this.reply(`第${week}周已超出本学期课程周数，请确认周数是否正确`);
        return true;
      }
      const courses = schedule.courses.filter(course =>
        course.day === day.toString() && course.weeks.includes(week)
      );
      const displayName = schedule.nickname || `用户${userId}`;
      const replyMsg = this.formatCourses(courses, week, day, displayName);
      await this.reply(replyMsg);
      return true;
    }

    // 2. 尝试匹配日期格式
    const dateInput = msg.replace(/^#(?:课表查询|schedule query)\s*/, '');
    const date = parseDateInput(dateInput, schedule.semesterStart);
    if (date) {
      const result = await this.getCoursesForDate(userId, date);
      if (result.error) {
        await this.reply(result.error);
        return true;
      }
      const replyMsg = this.formatCourses(result.courses, result.week, result.day, result.displayName);
      await this.reply(replyMsg);
      return true;
    }

    // 3. 无法解析，给出提示
    const currentWeek = calculateCurrentWeek(schedule.semesterStart);
    await this.reply(
      `无法识别的查询格式。\n请使用以下格式：\n` +
      `1. #课表查询 周数 星期（如 #课表查询 ${currentWeek} 1）\n` +
      `2. #课表查询 月-日（如 #课表查询 10-1，将自动识别学期年份）`
    );
    return true;
  }
  /**
 * 获取指定日期的课程（内部使用）
 * @param {number} userId 用户QQ
 * @param {Date} date 查询日期
 * @returns {Promise<Object>} 包含 courses, week, day, displayName 或 error
 */
  async getCoursesForDate(userId, date) {
    const schedule = DataManager.loadSchedule(userId);
    if (!schedule) {
      return { error: "你还没有设置课程表，请使用 #设置课表 命令导入课表" };
    }

    const week = calculateWeekFromDate(schedule.semesterStart, date);
    if (week === null) {
      return { error: "查询日期早于学期开始日期，无法计算周数" };
    }

    const day = date.getDay() === 0 ? 7 : date.getDay(); // 1=周一 ... 7=周日

    const maxWeek = Math.max(...schedule.courses.flatMap(c => c.weeks), 0);
    if (maxWeek > 0 && week > maxWeek) {
      return { error: `第 ${week} 周已超出本学期课程周数，请确认日期是否正确` };
    }

    const courses = schedule.courses.filter(course =>
      course.day === day.toString() && course.weeks.includes(week)
    );

    const displayName = schedule.nickname || `用户${userId}`;
    return { courses, week, day, displayName };
  }
  /**
 * 开启课表订阅
 */
  async enableReminder(e) {
    const userId = e.user_id;

    // 检查是否已经是好友
    if (!Bot.fl || !Bot.fl.has(Number(userId))) {
      await e.reply(
        `❌ 订阅失败！请先添加机器人为好友，才能开启课表订阅哦~\n`
      );
      return false;
    }
    // 检查是否有课表，无课表无法订阅
    const schedule = DataManager.loadSchedule(userId);
    if (!schedule) {
      return { error: "你还没有设置课程表，请使用 #设置课表 命令导入课表" };
    }

    // 保存订阅状态
    await DataManager.setReminderStatus(userId, true);
    const parts = pushCron.split(' '); 
    const hour = parts[1];
    const minute = parts[0];
    if(minute === "*") minute = "0"
    
    await e.reply(`✅ 已开启课表订阅，每天${hour}点${minute}分将为你推送明日课表（需保持好友关系）`);
    return true;
  }
  /**
 * 关闭课表订阅
 */
  async disableReminder(e) {
    const userId = e.user_id;
    await DataManager.setReminderStatus(userId, false);
    await e.reply("✅ 已关闭课表订阅");
    return true;
  }
  /**
 * 将课程列表格式化为回复文本
 * @param {Array} courses 课程数组
 * @param {number} week 周数
 * @param {number} day 星期（1-7）
 * @param {string} displayName 显示名称
 * @returns {string} 格式化后的消息
 */
  formatCourses(courses, week, day, displayName) {
    if (courses.length === 0) {
      return `${displayName} 的第${week}周 星期${day}没有课程哦~`;
    }

    // 按时间排序
    courses.sort((a, b) => a.startTime.localeCompare(b.startTime));

    let reply = `${displayName} 的第${week}周 星期${day} 课程安排\n`;
    reply += "=".repeat(25) + "\n";
    courses.forEach((course, index) => {
      reply += `${index + 1}. ${course.name}\n`;
      reply += `   👨‍🏫 ${course.teacher || '未知教师'}\n`;
      reply += `   🕐 ${course.startTime} - ${course.endTime}\n`;
      reply += `   📍 ${course.location || '未知地点'}\n`;
      if (index < courses.length - 1) reply += "\n";
    });
    return reply;
  }
  /**
 * 推送明日课表（定时任务）
 */
  async pushTomorrowSchedule() {
    logger.info("[课表订阅] 开始推送明日课表");

    // 获取所有订阅用户
    const users = await DataManager.getAllReminderUsers();
    if (!users.length) {
      logger.info("[课表订阅] 无订阅用户，任务结束");
      return;
    }

    // 计算明天日期
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    // 遍历推送
    for (const userId of users) {
      try {
        // 1. 检查用户是否有课表
        const schedule = DataManager.loadSchedule(userId);
        if (!schedule) {
          logger.debug(`[课表订阅] 用户 ${userId} 未设置课表，跳过`);
          continue;
        }

        // 2. 获取明日课程（复用现有方法）
        const result = await this.getCoursesForDate(userId, tomorrow);
        if (result.error) {
          logger.debug(`[课表订阅] 用户 ${userId} 获取课程失败: ${result.error}`);
          continue;
        }

        // 3. 格式化消息
        const replyMsg = this.formatCourses(
          result.courses,
          result.week,
          result.day,
          result.displayName
        );
        replyMsg = `======明日课程提醒======\n` + replyMsg;

        // 4. 检查是否为好友
        if (!Bot.fl || !Bot.fl.has(Number(userId))) {
          logger.debug(`[课表订阅] 用户 ${userId} 不是机器人好友，无法私信`);
          continue;
        }

        // 5. 发送私信
        await Bot.pickFriend(userId).sendMsg(replyMsg);
        logger.info(`[课表订阅] 成功推送明日课表给用户 ${userId}`);

        // 6. 等待3秒，避免风控
        await new Promise(resolve => setTimeout(resolve, 3000));

      } catch (err) {
        logger.error(`[课表订阅] 推送用户 ${userId} 时发生错误: ${err}`);
      }
    }

    logger.info("[课表订阅] 推送完成");
  }

  /**
 * 测试推送明日课表（手动触发）
 */
  /*
    async testPushTomorrow(e) {
      // 仅允许主人使用，避免误触
      if (!e.isMaster) {
        await e.reply("❌ 仅限主人测试使用");
        return false;
      }
      await this.pushTomorrowSchedule();
      await e.reply("✅ 推送任务已执行，请查看日志");
      return true;
    }
    */
}
export default SchedulePlugin
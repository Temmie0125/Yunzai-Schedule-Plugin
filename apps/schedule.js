// import fs from 'node:fs'
// import path from 'node:path'
import { DataManager } from '../components/DataManager.js'
import { ConfigManager } from '../components/ConfigManager.js'
import { importScheduleFromCode } from '../services/scheduleImporter.js'
import { calculateCurrentWeek, calculateWeekFromDate, parseDateInput, calculateDateFromWeekAndDay } from '../utils/timeUtils.js';
import { generateHelpImage, generateUserScheduleImage } from '../components/Renderer.js'
const config = ConfigManager.getConfig()
const pushCron = config.pushCron  // 存储 cron 供 task 使用
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
        }
      ],
    })
    this.task = [
      {
        name: "推送明日课表",
        cron: pushCron,                         // 从配置读取的 cron 表达式
        fnc: () => this.pushTomorrowSchedule(), // 使用箭头函数确保 this 正确
        log: true                               // 可选，开启日志
      }
    ]
  }
  async showHelp(e) {
    const helpData = await DataManager.getHelpData()
    const img = await generateHelpImage(helpData, { e: e })
    if (img) {
      await e.reply(segment.image(img))
    } else {
      // 降级为文本帮助
      await e.reply(DataManager.getDefaultHelpText())
    }
    return true
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
    // 一般分享口令为32位，为避免误触发，小于20位的不处理
    if (code.length < 20) {
      logger.warn("[课表导入] 非标准分享口令，请检查是否有误")
      return false;
    }
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
    // 尝试生成图片
    const schedule = DataManager.loadSchedule(userId);
    const userData = {
      nickname: result.displayName,
      week: result.week,
      day: result.day,
      signature: schedule?.signature || '',
      courses: result.courses
    };
    const img = await generateUserScheduleImage(userData, today, { e: this.e });
    if (img) {
      await this.reply(segment.image(img));
    } else {
      // 降级为文本
      const replyMsg = DataManager.formatCourses(result.courses, result.week, result.day, result.displayName);
      await this.reply(replyMsg);
    }
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
    // 尝试生成图片
    const schedule = DataManager.loadSchedule(userId);
    const userData = {
      nickname: result.displayName,
      week: result.week,
      day: result.day,
      signature: schedule?.signature || '',
      courses: result.courses
    };
    const img = await generateUserScheduleImage(userData, tomorrow, { e: this.e });
    if (img) {
      await this.reply(segment.image(img));
    } else {
      // 降级为文本
      const replyMsg = DataManager.formatCourses(result.courses, result.week, result.day, result.displayName);
      await this.reply(replyMsg);
    }
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
      // 计算具体日期
      const targetDate = calculateDateFromWeekAndDay(schedule.semesterStart, week, day);
      if (!targetDate) {
        await this.reply(`无法根据学期开始日期计算第${week}周星期${day}的日期，请检查输入`);
        return true;
      }

      // 可选：验证计算出的周数是否与输入一致（防止因学期起始偏移导致的无效组合）
      const calculatedWeek = calculateWeekFromDate(schedule.semesterStart, targetDate);
      if (calculatedWeek !== week) {
        const startDay = new Date(schedule.semesterStart).getDay() === 0 ? 7 : new Date(schedule.semesterStart).getDay();
        await this.reply(`第${week}周星期${day}不存在于本学期（学期开始于星期${startDay}），请重新输入`);
        return true;
      }
      const result = await this.getCoursesForDate(userId, targetDate);
      if (result.error) {
        await this.reply(result.error);
        return true;
      }
      const userData = {
        nickname: result.displayName,
        week: result.week,
        day: result.day,
        signature: schedule?.signature || '',
        courses: result.courses
      };
      const img = await generateUserScheduleImage(userData, targetDate, { e: this.e });
      if (img) {
        await this.reply(segment.image(img));
      } else {
        const replyMsg = DataManager.formatCourses(result.courses, result.week, result.day, result.displayName);
        await this.reply(replyMsg);
      }
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
      const userData = {
        nickname: result.displayName,
        week: result.week,
        day: result.day,
        signature: schedule?.signature || '',
        courses: result.courses
      };
      const img = await generateUserScheduleImage(userData, date, { e: this.e });
      if (img) {
        await this.reply(segment.image(img));
      } else {
        const replyMsg = DataManager.formatCourses(result.courses, result.week, result.day, result.displayName);
        await this.reply(replyMsg);
      }
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
    let courses = schedule.courses.filter(course =>
      course.day === day.toString() && course.weeks.includes(week)
    );
    // 按开始时间排序（升序）
    courses.sort((a, b) => a.startTime.localeCompare(b.startTime));
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
    const minuteStr = parts[0];
    const hourStr = parts[1];
    const minuteInt = parseInt(minuteStr, 10);
    let timeDesc;
    if (minuteInt === 0) {
      timeDesc = `${hourStr}点整`;
    } else {
      const minuteFormatted = minuteInt.toString().padStart(2, '0');
      timeDesc = `${hourStr}点${minuteFormatted}分`;
    }
    await e.reply(`✅ 已开启课表订阅，每天${timeDesc}将为你推送明日课表（需保持好友关系）`);
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
        // 2. 获取明日课程
        const result = await this.getCoursesForDate(userId, tomorrow);
        if (result.error) {
          logger.debug(`[课表订阅] 用户 ${userId} 获取课程失败: ${result.error}`);
          continue;
        }
        // 准备用户数据
        const userData = {
          nickname: result.displayName,
          week: result.week,
          day: result.day,
          signature: schedule.signature || '',
          courses: result.courses
        };
        let replyMsg;
        const img = await generateUserScheduleImage(userData, tomorrow); // 无 e 对象
        if (img) {
          replyMsg = segment.image(img);
        } else {
          replyMsg = DataManager.formatCourses(result.courses, result.week, result.day, result.displayName);
          replyMsg = `======明日课程提醒======\n` + replyMsg;
        }
        if (!Bot.fl || !Bot.fl.has(Number(userId))) {
          logger.debug(`[课表订阅] 用户 ${userId} 不是机器人好友，无法私信`);
          continue;
        }
        await Bot.pickFriend(userId).sendMsg(replyMsg);
        logger.info(`[课表订阅] 成功推送明日课表给用户 ${userId}`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      } catch (err) {
        logger.error(`[课表订阅] 推送用户 ${userId} 时发生错误: ${err}`);
      }
    }
    logger.info("[课表订阅] 推送完成");
  }
}
export default SchedulePlugin
// push.js
import schedule from 'node-schedule'
import { checkFriend, getBotName } from '../components/common.js'
import { DataManager } from '../components/DataManager.js'
import { ConfigManager } from '../components/ConfigManager.js'
import { generateUserScheduleImage } from '../components/Renderer.js'
const config = ConfigManager.getConfig()
const pushCron = config.pushCron  // 存储 cron 供 task 使用
export class SchedulePush extends plugin {
  constructor() {
    super({
      name: "[Schedule] 课程表推送",
      dsc: "课表推送服务",
      event: "message",
      priority: 1000,
      rule: [
        {
          reg: "^#(开启|打开)课表(订阅|提醒)$",
          fnc: "enableReminder"
        },
        {
          reg: "^#(关闭|取消)课表(订阅|提醒)$",
          fnc: "disableReminder"
        }
      ]
    })
    this.pushJob = null;
    this.initPushTask();
    this.handleConfigChange = this.handleConfigChange.bind(this);
    if (global.scheduleEvents) {
      global.scheduleEvents.on(this.handleConfigChange);
    }
  }
  /**
   * 处理配置变化事件
   */
  handleConfigChange() {
    this.initPushTask();
  }
  /**
   * 初始化/重载推送任务（根据最新配置）
   */
  initPushTask() {
    const config = ConfigManager.getConfig();
    const pushCron = config.pushCron;
    if (!pushCron) {
      if (global.__schedulePushJob) {
        global.__schedulePushJob.cancel();
        global.__schedulePushJob = null;
        global.__schedulePushCron = null;
      }
      logger.warn('[课程表插件] 未配置cron表达式，跳过');
      return;
    }
    if (global.__schedulePushJob && global.__schedulePushCron === pushCron) {
      return;
    }
    if (global.__schedulePushJob) {
      global.__schedulePushJob.cancel();
      global.__schedulePushJob = null;
      global.__schedulePushCron = null;
    }
    try {
      logger.info('[推送任务] 开始加载定时任务...');
      global.__schedulePushJob = schedule.scheduleJob(pushCron, () => {
        SchedulePush.pushTomorrowSchedule();
      });
      global.__schedulePushCron = pushCron;
      logger.info(`[课程表插件] 已启用课表推送，cron: ${pushCron}`);
    } catch (err) {
      logger.error(`[课程表插件] 调度失败: ${err}`);
    }
  }
  /**
   * 开启课表订阅
   */
  async enableReminder(e) {
    const userId = e.user_id;
    const botName = getBotName(e);
    if (!checkFriend(userId)) {
      await e.reply(
        `❌ 订阅失败！请先添加${botName}为好友，才能开启课表订阅哦~\n`
      );
      return false;
    }
    const schedule = DataManager.loadSchedule(userId);
    if (!schedule) {
      return { error: "你还没有设置课程表，请使用 #设置课表 命令导入课表" };
    }
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
    await e.reply(`✅ 已开启课表订阅，${botName}每天${timeDesc}将为你推送明日课表（需保持好友关系哦~）`);
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
   * 增强功能：
   * 1. 学期结束自动退订并提示
   * 2. 节假日/周末不推送（调休上班日发送提示）
   */
  static async pushTomorrowSchedule() {
    logger.mark(`${logger.blue(`[课表订阅] 开始推送明日课表`)}`);
    const users = await DataManager.getAllReminderUsers();
    if (!users.length) {
      logger.mark(`${logger.green(`[课表订阅] 无订阅用户，任务结束`)}`);
      return;
    }
    let tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowWeekday = tomorrow.getDay(); // 0=周日, 1=周一...6=周六
    for (const userId of users) {
      try {
        // 1. 检查用户是否有课表
        const schedule = DataManager.loadSchedule(userId);
        if (!schedule) {
          logger.info(`[课表订阅] 用户 ${userId} 未设置课表，跳过`);
          continue;
        }
        // 先校验好友状态
        if (!checkFriend(userId)) {
          logger.warn(`[课表订阅] 用户 ${userId} 不是机器人好友，无法私信`);
          continue;
        }
        // 2. 学期结束判断（优先处理）
        if (DataManager.isSemesterEnded(schedule, tomorrow)) {
          logger.info(`[课表订阅] 用户 ${userId} 学期已结束，自动关闭订阅`);
          await DataManager.setReminderStatus(userId, false);
          await Bot.pickFriend(userId).sendMsg(
            `📢 学期已结束，您的课表订阅已自动关闭。如需下学期的提醒，请重新设置课表后开启订阅。`
          );
          continue;
        }
        // 3. 节假日/调休判断
        const holidayInfo = DataManager.getHolidayInfoForDate(tomorrow);
        if (holidayInfo) {
          if (holidayInfo.isHoliday) {
            // 节假日放假，不推送课表，发送友好提示
            const holidayName = holidayInfo.name;
            await Bot.pickFriend(userId).sendMsg(
              `🎉 明天是【${holidayName}】，休息日，无课程安排~ 祝您假期愉快！`
            );
            logger.info(`[课表订阅] 用户 ${userId} 明天是节假日 ${holidayName}，跳过推送`);
            await new Promise(resolve => setTimeout(resolve, 3000));
            continue;
          }
          if (holidayInfo.isWorkdayOnWeekend) {
            // 调休上班（周末补班），发送提示，不推送课表
            const weekNum = calculateWeekFromDate(schedule.semesterStart, tomorrow);
            const weekNumText = weekNum !== null ? weekNum : '未知';
            await Bot.pickFriend(userId).sendMsg(
              `⚠️ 明日需要调休补班，但由于各学校排课方案不同，请使用 #课表查询 ${weekNumText} <学校安排的上周几的课> 查询次日课表安排。例如#课表查询 ${weekNumText} 1`
            );
            logger.info(`[课表订阅] 用户 ${userId} 明天为调休上班日，已发送提示`);
            await new Promise(resolve => setTimeout(resolve, 3000));
            continue;
          }
        }
        // 4. 周末且非调休上班（普通周末），不推送
        if (tomorrowWeekday === 0 || tomorrowWeekday === 6) {
          logger.info(`[课表订阅] 用户 ${userId} 明天是普通周末，不推送`);
          continue;
        }
        // 5. 正常推送明日课表
        const result = await DataManager.getCoursesForDate(userId, tomorrow);
        if (result.error) {
          logger.warn(`[课表订阅] 用户 ${userId} 获取课程失败: ${result.error}`);
          continue;
        }
        const userData = {
          nickname: result.displayName,
          week: result.week,
          day: result.day,
          signature: schedule.signature || '',
          courses: result.courses
        };
        let replyMsg;
        const img = await generateUserScheduleImage(userData, tomorrow);
        if (img) {
          replyMsg = segment.image(img);
        } else {
          replyMsg = DataManager.formatCourses(result.courses, result.week, result.day, result.displayName);
          replyMsg = `======明日课程提醒======\n` + replyMsg;
        }
        await Bot.pickFriend(userId).sendMsg(replyMsg);
        logger.info(`[课表订阅] 成功推送明日课表给用户 ${userId}`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      } catch (err) {
        logger.error(`[课表订阅] 推送用户 ${userId} 时发生错误: ${err}`);
      }
    }
    logger.mark(`${logger.green("[课表订阅] 推送完成")}`);
  }
  /**
   * 插件卸载时清理
   */
  async disconnect() {
    if (global.__schedulePushJob) {
      global.__schedulePushJob.cancel();
      global.__schedulePushJob = null;
      global.__schedulePushCron = null;
    }
    if (global.scheduleEvents) {
      global.scheduleEvents.off(this.handleConfigChange);
    }
  }
}

export default SchedulePush
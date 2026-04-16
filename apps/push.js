import schedule from 'node-schedule'
import { checkFriend } from '../components/common.js'
import { DataManager } from '../components/DataManager.js'
import { ConfigManager } from '../components/ConfigManager.js'
import { generateUserScheduleImage } from '../components/Renderer.js'
const config = ConfigManager.getConfig()
const pushCron = config.pushCron  // 存储 cron 供 task 使用
export class SchedulePush extends plugin {
  constructor() {
    super({
      name: "课程表推送",
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
    // logger.info('[推送任务] 检测到配置变化，重载定时任务');
    this.initPushTask();
  }
  /**
   * 初始化/重载推送任务（根据最新配置）
   */
  initPushTask() {
    const config = ConfigManager.getConfig();
    const pushCron = config.pushCron;
    if (!pushCron) {
      // 未配置时清除可能存在的旧任务
      if (global.__schedulePushJob) {
        global.__schedulePushJob.cancel();
        global.__schedulePushJob = null;
        global.__schedulePushCron = null;
      }
      logger.warn('[课程表插件] 未配置cron表达式，跳过');
      return;
    }
    // 如果当前全局任务存在且cron相同，则无需重建
    if (global.__schedulePushJob && global.__schedulePushCron === pushCron) {
      // logger.mark(`[课程表插件] 推送任务已存在且cron未变，跳过重新创建`);
      return;
    }
    // 取消旧任务（全局）
    if (global.__schedulePushJob) {
      global.__schedulePushJob.cancel();
      global.__schedulePushJob = null;
      global.__schedulePushCron = null;
    }
    try {
      logger.info('[推送任务] 开始加载定时任务...');
      global.__schedulePushJob = schedule.scheduleJob(pushCron, () => {
        // 调用静态方法，不依赖实例
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
    // 检查是否已经是好友
    if (!checkFriend(userId)) {
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
  static async pushTomorrowSchedule() {
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
        const result = await DataManager.getCoursesForDate(userId, tomorrow);
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
        if (!checkFriend(userId)) {
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
  /**
   * 插件卸载时清理（Yunzai 可能支持 disconnect 生命周期）
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
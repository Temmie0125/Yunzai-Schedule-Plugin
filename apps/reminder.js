// apps/reminder.js
import { checkFriend, getBotName } from '../components/common.js';
import { DataManager } from '../components/DataManager.js';
import { ConfigManager } from '../components/ConfigManager.js';
import {
  startClassReminderScheduler,
  stopClassReminderScheduler,
  reloadClassReminderScheduler
} from '../components/ClassReminderScheduler.js';

const MIN_THRESHOLD = 5;
const MAX_THRESHOLD = 60;
const DEFAULT_THRESHOLD = 10;

export class ClassReminder extends plugin {
  constructor() {
    super({
      name: "[Schedule] 上课提醒",
      dsc: "上课前提醒服务",
      event: "message",
      priority: 1000,
      rule: [
        {
          reg: "^#(开启|打开)上课提醒(?:\\s*(\\d+))?$",
          fnc: "enableReminder"
        },
        {
          reg: "^#(关闭|取消)上课提醒$",
          fnc: "disableReminder"
        }
      ]
    });
    this.handleConfigChange = this.handleConfigChange.bind(this);
    if (global.scheduleEvents) {
      global.scheduleEvents.on(this.handleConfigChange);
    }
    // 确保定时器按最新配置运行
    startClassReminderScheduler();
  }

  /**
   * 配置变化时重载定时器
   */
  handleConfigChange() {
    reloadClassReminderScheduler();
  }

  /**
   * 校验阈值是否合法（5 的倍数，且 5~60）
   * @param {number} value
   * @returns {boolean}
   */
  isValidThreshold(value) {
    return Number.isInteger(value) && value >= MIN_THRESHOLD && value <= MAX_THRESHOLD && value % 5 === 0;
  }

  /**
   * 开启上课提醒：#开启上课提醒 [提醒阈值]
   */
  async enableReminder(e) {
    const userId = e.user_id;
    const botName = getBotName(e);

    // 检查全局总开关
    const config = ConfigManager.getConfig();
    if (config.classReminderEnabled !== true) {
      await e.reply(`❌ 上课提醒功能当前已被管理员全局关闭，暂时无法开启哦~`);
      return false;
    }

    if (!checkFriend(userId)) {
      await e.reply(`❌ 开启失败！请先添加${botName}为好友，才能使用上课提醒哦~\n`);
      return false;
    }

    const schedule = DataManager.loadSchedule(userId);
    if (!schedule || !schedule.courses || schedule.courses.length === 0) {
      await e.reply(`❌ 你还没有设置课程表，请先使用 #设置课表 命令导入课表后再开启上课提醒~`);
      return false;
    }

    // 解析阈值参数
    const match = e.msg.match(/^#(?:开启|打开)上课提醒(?:\s*(\d+))?$/);
    const rawArg = match && match[1] ? match[1] : null;
    const current = await DataManager.getClassReminderConfig(userId);
    let threshold;
    if (rawArg === null) {
      // 未传参数：保留已有阈值，否则使用默认值
      threshold = current.threshold && this.isValidThreshold(current.threshold)
        ? current.threshold
        : DEFAULT_THRESHOLD;
    } else {
      const value = parseInt(rawArg, 10);
      if (!this.isValidThreshold(value)) {
        await e.reply(
          `❌ 提醒阈值不合法！请输入 ${MIN_THRESHOLD}~${MAX_THRESHOLD} 之间且为 5 的倍数的分钟数，例如：#开启上课提醒 15`
        );
        return false;
      }
      threshold = value;
    }

    await DataManager.setClassReminderConfig(userId, true, threshold);

    const alreadyOpen = current.enabled && current.threshold === threshold;
    if (alreadyOpen) {
      await e.reply(`✅ 上课提醒已处于开启状态，提醒阈值为 ${threshold} 分钟。`);
    } else if (current.enabled) {
      await e.reply(`✅ 已更新上课提醒阈值，将为你提前 ${threshold} 分钟发送上课提醒（需保持好友关系哦~）`);
    } else {
      await e.reply(`✅ 已开启上课提醒，将为你提前 ${threshold} 分钟发送上课提醒（需保持好友关系哦~）`);
    }
    return true;
  }

  /**
   * 关闭上课提醒
   */
  async disableReminder(e) {
    const userId = e.user_id;
    const current = await DataManager.getClassReminderConfig(userId);
    await DataManager.setClassReminderConfig(userId, false);
    if (current.enabled) {
      await e.reply("✅ 已关闭上课提醒");
    } else {
      await e.reply("ℹ️ 你当前并未开启上课提醒，无需关闭");
    }
    return true;
  }

  /**
   * 插件卸载时清理
   */
  async disconnect() {
    stopClassReminderScheduler();
    if (global.scheduleEvents) {
      global.scheduleEvents.off(this.handleConfigChange);
    }
  }
}

export default ClassReminder;

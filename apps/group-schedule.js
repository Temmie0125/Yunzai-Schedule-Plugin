//import fs from 'node:fs'
//import path from 'node:path'
import { DataManager } from '../components/DataManager.js'
import { checkPermission, getGroupMembers, getAvatarUrl, getBotName } from '../components/common.js'
import { generateScheduleImage, generateTextSchedule } from '../components/Renderer.js'
import { calculateCurrentWeek, calculateRemainingTime, calculateTimeUntil } from '../utils/timeUtils.js'
export class GroupSchedulePlugin extends plugin {
  constructor() {
    super({
      name: "[Schedule] 群课表查询",
      dsc: "查看群成员上课状态与翘课功能",
      event: "message",
      priority: 1000,
      rule: [
        {
          reg: "^#(群课表|课程表|群友课表|cls(\\s)?tb|class(\\s)?table|schedule)$",
          fnc: "showGroupSchedule"
        },
        {
          reg: "^#?(群友在上什么课|群友在上什么课\?|群友在上什么课？)$",
          fnc: "showGroupSchedule"
        },
        {
          reg: "^#?(所有人在上什么课\\??|所有人课表|全局课表|all(\\s)?cls(\\s)?tb)$",
          fnc: "showAllUsersSchedule"
        },
        {
          reg: "^#?\\s*(?:@|\\d+)?.*在上什么课\\??$",
          fnc: "queryUserSchedule"
        },
        {
          reg: "^#(翘课|取消翘课|cl(as)?s(\\s)?skip|cl(as)?s(\\s)?no(\\s)?skip|no(\\s)?cl(as)?s(\\s)?skip|cls(\\s)?unskip)$",
          fnc: "toggleSkipClass"
        }
      ]
    })
    this.dataPath = 'plugins/schedule/data/'
    this.skipStatusPath = 'plugins/schedule/skip-status.json'
  }
  // ========== 核心方法：构建用户上课数据 ==========
  async _buildUserData(userId, scheduleData, currentDay, currentTime, fallbackNickname = null) {
    const skipStatus = await DataManager.loadSkipStatus(userId);
    const signature = scheduleData.signature || "此人很懒，还没有设置个性签名~";
    const semesterStart = scheduleData.semesterStart;
    const userCurrentWeek = calculateCurrentWeek(semesterStart);
    // 计算最大周数，判断学期是否结束
    let maxWeek = 0;
    if (scheduleData.courses && scheduleData.courses.length > 0) {
      maxWeek = Math.max(...scheduleData.courses.flatMap(course => course.weeks));
    }
    const semesterEnded = maxWeek > 0 && userCurrentWeek > maxWeek;
    if (semesterEnded) {
      return {
        userId,
        nickname: fallbackNickname || scheduleData.nickname || `用户${userId}`,
        avatar: await getAvatarUrl(userId),
        semesterEnded: true,
        status: '学期结束',
        signature,
        currentWeek: userCurrentWeek,
        hasSemesterStart: !!semesterStart
      };
    }
    // 筛选今日课程
    const todayCourses = scheduleData.courses.filter(course =>
      parseInt(course.day) === currentDay && course.weeks.includes(userCurrentWeek)
    );
    todayCourses.sort((a, b) => a.startTime.localeCompare(b.startTime));
    let currentCourse = null;
    let status = '无课程';
    let remainingTime = null;
    if (todayCourses.length > 0) {
      const ongoingCourse = todayCourses.find(course =>
        currentTime >= course.startTime && currentTime <= course.endTime
      );
      if (ongoingCourse) {
        currentCourse = ongoingCourse;
        if (skipStatus.enabled) {
          status = '翘课中';
        } else {
          status = '进行中';
          remainingTime = calculateRemainingTime(currentTime, ongoingCourse.endTime);
        }
      } else {
        const nextCourse = todayCourses.find(course => currentTime < course.startTime);
        if (nextCourse) {
          currentCourse = nextCourse;
          status = '未开始';
          remainingTime = calculateTimeUntil(currentTime, nextCourse.startTime);
        } else {
          currentCourse = todayCourses[todayCourses.length - 1];
          status = '已结束';
        }
      }
    }
    return {
      userId,
      nickname: scheduleData.nickname || fallbackNickname || `用户${userId}`,  // 优先使用课表数据的昵称
      avatar: await getAvatarUrl(userId),
      currentCourse,
      status,
      remainingTime,
      skipStatus: skipStatus.enabled,
      signature,
      currentWeek: userCurrentWeek,
      hasSemesterStart: !!semesterStart
    };
  }
  /**
 * 处理节假日逻辑
 * @param {Date} now 当前时间
 * @param {number} currentWeek 当前周数（用于提示信息中的示例）
 * @returns {Object} { shouldStop: boolean, notice: string | null }
 *   - shouldStop: true 表示遇到法定节假日，调用方应直接返回（已经发送了回复）
 *   - notice: 非空字符串表示调休上班日的提示信息，需要附加到最终消息中
 */
  async _handleHoliday(now, currentWeek = 1) {
    const holidayInfo = DataManager.getHolidayInfoForDate(now);
    if (!holidayInfo) return { shouldStop: false, notice: null };
    if (holidayInfo.isHoliday) {
      await this.reply(`今日是【${holidayInfo.name}】，法定节假日，无课程安排~`);
      return { shouldStop: true, notice: null };
    }
    if (holidayInfo.isWorkdayOnWeekend) {
      const notice = `⚠️ 今日为调休上班日（${holidayInfo.name}），实际课程安排请以学校通知为准。\n可使用 #课表查询 <你的周数> <星期几> 查询对应课表。\n例如 #课表查询 ${currentWeek} 1 可以查询第${currentWeek}周的周一课程。`;
      return { shouldStop: false, notice };
    }
    return { shouldStop: false, notice: null };
  }
  // ========== 原有方法1：获取群成员数据（带自动过期和 memberInfo 备选昵称） ==========
  async getMemberScheduleData(userId, memberInfo, currentDay, currentTime) {
    // 先检查并自动过期翘课状态
    await this.checkAndAutoExpireSkip(userId);
    const scheduleData = DataManager.loadSchedule(userId);
    if (!scheduleData) return null;
    // 优先使用群名片，其次昵称
    const fallbackNickname = memberInfo.card || memberInfo.nickname || null;
    return this._buildUserData(userId, scheduleData, currentDay, currentTime, fallbackNickname);
  }
  // ========== 原有方法2：获取任意用户数据（不带自动过期，由调用方决定） ==========
  async getUserScheduleData(userId, scheduleData, currentDay, currentTime) {
    return this._buildUserData(userId, scheduleData, currentDay, currentTime, null);
  }
  /**
   * 显示群上课情况
   */
  async showGroupSchedule() {
    const groupId = this.e.group_id
    if (!groupId) {
      await this.reply("请在群聊中使用此命令")
      return true
    }
    // 获取当前时间信息
    const now = new Date()
    // 全局当前周数，实际上不使用，但作为保留
    const currentWeek = calculateCurrentWeek()
    const currentDay = now.getDay() === 0 ? 7 : now.getDay()
    const currentTime = now.toTimeString().slice(0, 5) // HH:MM
    // 节假日处理
    const { shouldStop, notice: globalNotice } = await this._handleHoliday(now);
    if (shouldStop) return true;
    // 获取群成员列表
    const groupMembers = await getGroupMembers(groupId)
    // 收集有课表的成员信息
    const membersWithSchedule = []
    // 在原循环位置
    for (const member of groupMembers) {
      const data = await this.getMemberScheduleData(member.user_id, member, currentDay, currentTime);
      if (data) {
        membersWithSchedule.push(data);
      }
    }
    // 修改showGroupSchedule方法的最后部分
    if (membersWithSchedule.length === 0) {
      await this.reply("本群暂无成员设置课程表");
      return true;
    }
    // 发送课表消息
    await this.sendScheduleMessage(membersWithSchedule, currentWeek, currentDay, globalNotice);
    return true;
  }
  async showAllUsersSchedule() {
    if (!checkPermission(this.e)) {
      await this.reply("只有群管理员或主人可以使用此命令");
      return true;
    }
    const now = new Date();
    const currentWeek = calculateCurrentWeek();      // 需要从 timeUtils 导入
    const currentDay = now.getDay() === 0 ? 7 : now.getDay();
    const currentTime = now.toTimeString().slice(0, 5);
    // 节假日处理
    const { shouldStop, notice: globalNotice } = await this._handleHoliday(now);
    if (shouldStop) return true;
    // 获取所有用户课表
    const allUsers = DataManager.getAllUserSchedules();
    if (allUsers.length === 0) {
      await this.reply("暂无任何用户设置课程表");
      return true;
    }
    // 收集每个用户的上课状态
    const allUsersData = [];
    for (const { userId, schedule } of allUsers) {
      // 自动过期翘课状态
      await this.checkAndAutoExpireSkip(userId);
      const userData = await this.getUserScheduleData(userId, schedule, currentDay, currentTime);
      if (userData) {
        allUsersData.push(userData);
      }
    }
    if (allUsersData.length === 0) {
      await this.reply("所有用户的课程表均为空或已结束");
      return true;
    }
    /*
    // 限制显示数量
    const MAX_DISPLAY = 50;
    if (allUsersData.length > MAX_DISPLAY) {
      await this.reply(`共有 ${allUsersData.length} 位用户设置了课表，当前仅展示前 ${MAX_DISPLAY} 位。`);
      allUsersData.length = MAX_DISPLAY;
    }
    */
    await this.sendScheduleMessage(allUsersData, currentWeek, currentDay, globalNotice);
    return true;
  }
  /**
 * 发送课表消息
 */
  async sendScheduleMessage(members, currentWeek, currentDay, globalNotice = null) {
    try {
      // 生成图片
      let replyMsg = [];
      const image = await generateScheduleImage(members, currentWeek, currentDay, { e: this.e });
      if (globalNotice) {
        replyMsg.push(globalNotice)
      }
      if (image) {
        replyMsg.push(segment.image(image));
        await this.reply(replyMsg);
        return true;
      } else {
        // 降级为文本消息
        logger.error(`发送课表图片失败`);
        this.reply(generateTextSchedule(members, currentWeek, currentDay));
        return false;
      }
    } catch (error) {
      logger.error(`发送课表消息失败: ${error}`);
      await this.reply("生成课表失败，请稍后重试");
      return false;
    }
  }
  /**
   * 查询指定用户的上课状态
   */
  async queryUserSchedule() {
    const groupId = this.e.group_id;
    const botName = getBotName(this.e);
    if (!groupId) {
      await this.reply("请在群聊中使用此命令");
      return true;
    }
    // 解析目标用户 ID：优先使用 @，否则从消息中提取第一个数字
    let targetId = null;
    if (this.e.at) {
      targetId = this.e.at;
    } else {
      const msg = this.e.msg;
      const match = msg.match(/(\d+)/);
      if (match) {
        targetId = parseInt(match[1]);
      }
    }
    if (!targetId) {
      await this.reply("请@某人或提供QQ号");
      return true;
    }
    targetId = Number(targetId);
    // 获取群成员列表，验证目标成员是否在群内
    const groupMembers = await getGroupMembers(groupId);
    const targetMember = groupMembers.find(m => m.user_id === targetId);
    if (!targetMember) {
      await this.reply(`${botName}似乎未找到成员${targetId}，可能不在本群...`);
      return true;
    }
    // 当前时间信息
    const now = new Date();
    const currentDay = now.getDay() === 0 ? 7 : now.getDay();
    const currentTime = now.toTimeString().slice(0, 5);
    // 节假日处理
    const { shouldStop, notice: globalNotice } = await this._handleHoliday(now);
    if (shouldStop) return true;
    // 获取该成员的上课状态数据
    const memberData = await this.getMemberScheduleData(targetId, targetMember, currentDay, currentTime);
    if (!memberData) {
      await this.reply(`用户 ${targetMember.card || targetMember.nickname || targetId} 还未设置课程表`);
      return true;
    }
    // 发送图片（仅包含该成员）
    await this.sendScheduleMessage([memberData], calculateCurrentWeek(), currentDay, globalNotice);
    return true;
  }
  /**
   * 切换翘课状态
   */
  async toggleSkipClass() {
    const userId = this.e.user_id
    const message = this.e.msg
    // 检查是否有课程表
    const scheduleData = DataManager.loadSchedule(userId)
    if (!scheduleData) {
      await this.reply("你还没有设置课表哦，请先使用 #设置课表 或者 #导入课表 命令导入课程表~")
      return true
    }
    // 先检查当前翘课状态是否过期 
    const quitSkip = await this.checkAndAutoExpireSkip(userId)
    if (quitSkip) {
      await this.reply("今日没有课程了，怎么翘啊~好好休息吧~");
      return true;
    }
    const currentStatus = await DataManager.loadSkipStatus(userId)
    let newStatus
    if (message.includes("取消") || message.includes("no") || message.includes("un")) {
      if (!currentStatus.enabled) {
        return this.reply("你还未处于翘课模式，无需取消~")
      }
      newStatus = false
    } else {
      if (currentStatus.enabled) {
        return this.reply("你已经处于翘课模式，无需再次开启~")
      }
      newStatus = true
    }
    let autoCancelMsg = '';
    // 在 toggleSkipClass 中，计算结束时间的代码块
    let expireTime = null;
    if (newStatus) {
      const now = new Date();
      const currentWeek = calculateCurrentWeek(scheduleData.semesterStart);
      const currentDay = now.getDay() === 0 ? 7 : now.getDay();
      const currentTime = now.toTimeString().slice(0, 5);
      const todayCourses = scheduleData.courses.filter(course =>
        parseInt(course.day) === currentDay && course.weeks.includes(currentWeek)
      );
      // 过滤出未结束的课程（结束时间 > 当前时间）
      const futureCourses = todayCourses.filter(course => course.endTime > currentTime);
      if (futureCourses.length === 0) {
        await this.reply("今日课程已经全部结束，无法翘课~");
        return true;
      }
      futureCourses.sort((a, b) => a.startTime.localeCompare(b.startTime));
      const targetCourse = futureCourses[0]; // 第一个未结束的课程
      // 构造结束时间点：今日的 targetCourse.endTime 对应的 Date 对象
      const [hour, minute] = targetCourse.endTime.split(':');
      const expireDate = new Date(now);
      expireDate.setHours(parseInt(hour), parseInt(minute), 0, 0);
      expireTime = expireDate.toISOString();
      autoCancelMsg = `，将在『${targetCourse.name}』结束时（${targetCourse.endTime}）自动取消`;
    }
    // 更新状态
    await DataManager.saveSkipStatus(userId, newStatus, expireTime);
    const nickname = scheduleData.nickname || `用户${userId}`;
    let replyMsg = `『${nickname}』${newStatus ? '已开启翘课模式' : '已取消翘课模式'}`;
    if (newStatus && autoCancelMsg) {
      replyMsg += autoCancelMsg;
    }
    await this.reply(replyMsg);
    return true;
  }
  /**
   * 检查并自动过期翘课状态
   * @param {*} userId 用户QQ号
   */
  async checkAndAutoExpireSkip(userId) {
    const skipInfo = await DataManager.loadSkipStatus(userId);
    if (!skipInfo.enabled) return false; // 未翘课
    const { expireTime } = skipInfo;
    if (!expireTime) {
      // 旧数据无过期时间，为了兼容直接清除
      await DataManager.saveSkipStatus(userId, false);
      return true;
    }
    const now = new Date();
    if (now >= new Date(expireTime)) {
      // 已过期，清除翘课状态
      await DataManager.saveSkipStatus(userId, false);
      return true;
    }
    return false;
  }
}
export default GroupSchedulePlugin
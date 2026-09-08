//import fs from 'node:fs'
//import path from 'node:path'
import { DataManager } from '../components/DataManager.js'
import { ConfigManager } from '../components/ConfigManager.js'
import { checkPermission, getGroupMembers, getAvatarUrl, getBotName, makeForwardMsg } from '../components/common.js'
import { generateScheduleImage, generateTextSchedule } from '../components/Renderer.js'
import { calculateRemainingTime, calculateTimeUntil, effectiveTimeZone, nowPartsForSchedule, weekForDateStr } from '../utils/timeUtils.js'
import { dateStrToLocalMidnight, tzDateStrToUtcMs, weekdayOfDateStr } from '../utils/timeZoneUtils.js'
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
    // this.dataPath = 'plugins/schedule/data/'  数据目录
    // this.skipStatusPath = 'plugins/schedule/skip-status.json'  翘课状态存储
  }
  // ========== 构建用户上课数据 ==========
  // 每位成员的"现在/今天/星期/周次"按其课表有效解释时区（显式设置 → ICS推断 → 插件配置 → 系统）独立计算
  async _buildUserData(userId, scheduleData, fallbackNickname = null) {
    const skipStatus = await DataManager.loadSkipStatus(userId);
    const signature = scheduleData.signature || "此人很懒，还没有设置个性签名~";
    const semesterStart = scheduleData.semesterStart;
    // 当前周数：设置了个人学期开始日期的用户严格按日期计算，未开学时返回 null（不再截断为第1周导致误显示课程）；
    // 无学期开始日期的老数据仍回退到配置中的默认学期开始日期
    const ctx = nowPartsForSchedule(scheduleData);
    const currentDay = weekdayOfDateStr(ctx.dateStr);
    const currentTime = ctx.timeHHMM;
    const userCurrentWeek = weekForDateStr(semesterStart, ctx.dateStr);
    // 学期未开始：不展示任何课程，等待开学
    if (userCurrentWeek === null) {
      return {
        userId,
        nickname: fallbackNickname || scheduleData.nickname || `用户${userId}`,
        avatar: await getAvatarUrl(userId),
        semesterNotStarted: true,
        status: '学期未开始',
        semesterStartDate: semesterStart,
        signature,
        currentWeek: 1,
        hasSemesterStart: true
      };
    }
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
  async _handleHoliday(now, currentWeek = 1, skipHolidayReply = false) {
    const holidayInfo = DataManager.getHolidayInfoForDate(now);
    if (!holidayInfo) return { shouldStop: false, notice: null, holidayName: null, isHoliday: false };
    if (holidayInfo.isHoliday) {
      if (!skipHolidayReply) {
        await this.reply(`今日是【${holidayInfo.name}】，法定节假日，无课程安排~`);
      }
      return { shouldStop: true, notice: null, holidayName: holidayInfo.name, isHoliday: true };
    }
    if (holidayInfo.isWorkdayOnWeekend) {
      const notice = `⚠️ 今日为调休上班日（${holidayInfo.name}），实际课程安排请以学校通知为准。\n可使用 #课表查询 <你的周数> <星期几> 查询对应课表。\n例如 #课表查询 ${currentWeek} 1 可以查询第${currentWeek}周的周一课程。`;
      return { shouldStop: false, notice, holidayName: null, isHoliday: false };
    }
    return { shouldStop: false, notice: null, holidayName: null, isHoliday: false };
  }
  // ========== 获取群成员数据（带自动过期和 memberInfo 备选昵称） ==========
  // 成员"现在"状态一律按成员课表的有效解释时区在 _buildUserData 内自行计算
  async getMemberScheduleData(userId, memberInfo) {
    // 先检查并自动过期翘课状态
    await this.checkAndAutoExpireSkip(userId);
    const scheduleData = DataManager.loadSchedule(userId);
    if (!scheduleData) return null;
    // 优先使用群名片，其次昵称
    const fallbackNickname = memberInfo.card || memberInfo.nickname || null;
    return this._buildUserData(userId, scheduleData, fallbackNickname);
  }
  // ========== 获取任意用户数据（不带自动过期，由调用方决定） ==========
  async getUserScheduleData(userId, scheduleData) {
    return this._buildUserData(userId, scheduleData, null);
  }
  // ========== 命令发起人上下文：群级头部/节假日闸门以发起人课表解释时区为准（无课表退化为插件/系统时区） ==========
  _nowCtx() {
    const requesterSchedule = DataManager.loadSchedule(this.e.user_id);
    return nowPartsForSchedule(requesterSchedule);
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
    // 当前时间信息：群级头部/节假日闸门以命令发起人课表解释时区为准（无课表退化为插件/系统时区）；
    // 各成员的"现在在上什么课"状态在 _buildUserData 内按成员自己的时区计算
    const requesterCtx = this._nowCtx()
    const currentWeek = weekForDateStr(undefined, requesterCtx.dateStr) // 全局展示周数（配置默认学期口径，同旧 calculateCurrentWeek()）
    const currentDay = weekdayOfDateStr(requesterCtx.dateStr)
    const now = dateStrToLocalMidnight(requesterCtx.dateStr)
    // 节假日处理（先跳过自动回复，待检测调课后再决定）
    let { shouldStop, notice: globalNotice, holidayName, isHoliday } = await this._handleHoliday(now, currentWeek, true);

    const groupMembers = await getGroupMembers(groupId)
    const membersWithSchedule = []
    let hasAnyRescheduled = false;
    for (const member of groupMembers) {
      const data = await this.getMemberScheduleData(member.user_id, member);
      if (data) {
        membersWithSchedule.push(data);
      }
      // 检查是否有调课课程（成员学期按群级"今天"日历日折算周次）
      if (isHoliday && !hasAnyRescheduled) {
        const schedule = DataManager.loadSchedule(member.user_id);
        if (schedule && schedule.semesterStart) {
          const memberWeek = weekForDateStr(schedule.semesterStart, requesterCtx.dateStr);
          if (memberWeek !== null && DataManager.hasRescheduledCoursesForDate(schedule, memberWeek, currentDay)) {
            hasAnyRescheduled = true;
          }
        }
      }
    }
    // 节假日：只有存在调课成员时才继续渲染
    if (isHoliday && !hasAnyRescheduled) {
      await this.reply(`今日是【${holidayName}】，法定节假日，无课程安排~`);
      return true;
    }
    if (isHoliday && hasAnyRescheduled) {
      globalNotice = `⚠️ 今日为法定节假日（${holidayName}），以下显示含调课成员的课程安排，请注意甄别。`;
    }
    if (shouldStop && !hasAnyRescheduled) return true;
    if (membersWithSchedule.length === 0) {
      await this.reply("本群暂无成员设置课程表");
      return true;
    }
    // 发送课表消息
    const config = ConfigManager.getConfig();
    const sortedMembers = this._sortMembers(membersWithSchedule, config.sortMode);
    this.reply("正在渲染图片，请稍等一下哦~>_<~", false, { recallMsg: 5 });
    await this.sendScheduleMessage(sortedMembers, currentWeek, currentDay, globalNotice);
    return true;
  }
  async showAllUsersSchedule() {
    if (!checkPermission(this.e)) {
      await this.reply("只有群管理员或主人可以使用此命令");
      return true;
    }
    // 群级头部/节假日闸门以命令发起人课表解释时区为准；各用户状态按各自时区计算
    const requesterCtx = this._nowCtx();
    const currentWeek = weekForDateStr(undefined, requesterCtx.dateStr);
    const currentDay = weekdayOfDateStr(requesterCtx.dateStr);
    const now = dateStrToLocalMidnight(requesterCtx.dateStr);
    // 节假日处理（先跳过自动回复，待检测调课后再决定）
    let { shouldStop, notice: globalNotice, holidayName, isHoliday } = await this._handleHoliday(now, currentWeek, true);
    // 获取所有用户课表
    const allUsers = DataManager.getAllUserSchedules();
    if (allUsers.length === 0) {
      if (!isHoliday) await this.reply("暂无任何用户设置课程表");
      else await this.reply(`今日是【${holidayName}】，法定节假日，无课程安排~`);
      return true;
    }
    // 收集每个用户的上课状态
    const allUsersData = [];
    let hasAnyRescheduled = false;
    for (const { userId, schedule } of allUsers) {
      // 自动过期翘课状态
      await this.checkAndAutoExpireSkip(userId);
      const userData = await this.getUserScheduleData(userId, schedule);
      if (userData) {
        allUsersData.push(userData);
      }
      // 检查是否有调课课程
      if (isHoliday && !hasAnyRescheduled && schedule.semesterStart) {
        const memberWeek = weekForDateStr(schedule.semesterStart, requesterCtx.dateStr);
        if (memberWeek !== null && DataManager.hasRescheduledCoursesForDate(schedule, memberWeek, currentDay)) {
          hasAnyRescheduled = true;
        }
      }
    }
    if (allUsersData.length === 0 && !isHoliday) {
      await this.reply("所有用户的课程表均为空或已结束");
      return true;
    }
    // 节假日：只有存在调课成员时才继续渲染
    if (isHoliday && !hasAnyRescheduled) {
      await this.reply(`今日是【${holidayName}】，法定节假日，无课程安排~`);
      return true;
    }
    if (isHoliday && hasAnyRescheduled) {
      globalNotice = `⚠️ 今日为法定节假日（${holidayName}），以下显示含调课成员的课程安排，请注意甄别。`;
    }
    /*
    // 限制显示数量
    const MAX_DISPLAY = 50;
    if (allUsersData.length > MAX_DISPLAY) {
      await this.reply(`共有 ${allUsersData.length} 位用户设置了课表，当前仅展示前 ${MAX_DISPLAY} 位。`);
      allUsersData.length = MAX_DISPLAY;
    }
    */
    const config = ConfigManager.getConfig();
    const sortedMembers = this._sortMembers(allUsersData, config.sortMode);
    this.reply("正在渲染图片，请稍等一下哦~>_<~", false, { recallMsg: 5 });
    await this.sendScheduleMessage(sortedMembers, currentWeek, currentDay, globalNotice);
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
        let reply = makeForwardMsg(this.e, generateTextSchedule(members, currentWeek, currentDay), "群课表")
        this.reply(reply);
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
    // 当前时间信息：节假日闸门/回复头以命令发起人时区为准，目标成员"现在"状态按成员自己时区计算
    const requesterCtx = this._nowCtx();
    const currentDay = weekdayOfDateStr(requesterCtx.dateStr);
    const now = dateStrToLocalMidnight(requesterCtx.dateStr);
    // 节假日处理（先跳过自动回复，待检测调课后再决定）
    let { shouldStop, notice: globalNotice, holidayName, isHoliday } = await this._handleHoliday(now, weekForDateStr(undefined, requesterCtx.dateStr), true);
    // 获取该成员的上课状态数据（成员课表时区）
    const memberData = await this.getMemberScheduleData(targetId, targetMember);
    if (!memberData) {
      if (isHoliday) {
        await this.reply(`今日是【${holidayName}】，法定节假日，无课程安排~`);
      } else {
        await this.reply(`用户 ${targetMember.card || targetMember.nickname || targetId} 还未设置课程表`);
      }
      return true;
    }
    // 节假日：检查该成员是否有调课课程
    if (isHoliday) {
      const schedule = DataManager.loadSchedule(targetId);
      let week = null;
      if (schedule && schedule.semesterStart) {
        week = weekForDateStr(schedule.semesterStart, requesterCtx.dateStr);
      }
      if (!schedule || week === null || !DataManager.hasRescheduledCoursesForDate(schedule, week, currentDay)) {
        await this.reply(`今日是【${holidayName}】，法定节假日，该成员无课程安排~`);
        return true;
      }
      globalNotice = `⚠️ 今日为法定节假日（${holidayName}），以下显示为调课后的课程安排。`;
    }
    // 发送图片（仅包含该成员）
    await this.sendScheduleMessage([memberData], weekForDateStr(undefined, requesterCtx.dateStr), currentDay, globalNotice);
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
    // 计算结束时间
    let expireTime = null;
    if (newStatus) {
      // "现在/今天"按该用户课表有效解释时区计算
      const ctx = nowPartsForSchedule(scheduleData);
      const currentWeek = weekForDateStr(scheduleData.semesterStart, ctx.dateStr);
      const currentDay = weekdayOfDateStr(ctx.dateStr);
      const currentTime = ctx.timeHHMM;
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
      // 构造结束时间点：用户时区"今天"的 targetCourse.endTime → 绝对时刻（跨时区/夏令时正确）
      const { ms } = tzDateStrToUtcMs(ctx.dateStr, targetCourse.endTime, effectiveTimeZone(scheduleData));
      expireTime = new Date(ms).toISOString();
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
  /**
 * 根据配置对成员列表排序
 * @param {Array} members - 成员数据数组
 * @param {string} sortMode - 排序模式："userId" 或 "courseStatus"
 * @returns {Array} 排序后的新数组
 */
  _sortMembers(members, sortMode) {
    // 防御性拷贝，避免修改原数组
    const list = [...members];
    if (sortMode === 'courseStatus') {
      // 分为两组：有剩余课程（进行中/未开始/翘课中） 和 其他
      const hasClass = [];
      const noClass = [];
      for (const m of list) {
        if (m.status === '进行中' || m.status === '未开始' || m.status === '翘课中') {
          hasClass.push(m);
        } else {
          noClass.push(m);
        }
      }
      // 有课组：按当前课程的开始时间升序（时间格式 HH:MM 可直接字符串比较）
      hasClass.sort((a, b) => {
        const startA = a.currentCourse?.startTime || '99:99';
        const startB = b.currentCourse?.startTime || '99:99';
        return startA.localeCompare(startB);
      });
      // 无课组：按状态优先级排序 → 同类按 QQ 号升序
      const statusOrder = ['已结束', '无课程', '学期结束', '学期未开始'];
      noClass.sort((a, b) => {
        const idxA = statusOrder.indexOf(a.status);
        const idxB = statusOrder.indexOf(b.status);
        // 未知状态排在最后
        const priorityA = idxA === -1 ? 999 : idxA;
        const priorityB = idxB === -1 ? 999 : idxB;
        if (priorityA !== priorityB) {
          return priorityA - priorityB;
        }
        return Number(a.userId) - Number(b.userId);
      });
      return hasClass.concat(noClass);
    }
    // 默认按 QQ 号升序
    return list.sort((a, b) => Number(a.userId) - Number(b.userId));
  }
}
export default GroupSchedulePlugin
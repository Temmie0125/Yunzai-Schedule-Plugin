import { DataManager } from '../components/DataManager.js'
import { ConfigManager } from '../components/ConfigManager.js'
import {
    calculateCurrentWeek,
    calculateWeekFromDate,
    parseDateInput,
    calculateDateFromWeekAndDay,
    parseWeekday,
    getDateByRelativeWeek,
    parseChineseDateToMD
} from '../utils/timeUtils.js';
import { generateUserScheduleImage, generateUserInfoImage, generateWeeklyScheduleImage } from '../components/Renderer.js'

export class ScheduleQuery extends plugin {
    constructor() {
        super({
            name: "[Schedule] 课程表查询",
            dsc: "课表查询功能",
            event: "message",
            priority: 1000,
            rule: [
                // ===== 查询命令区 =====
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
                    reg: "^#(本周课表|下周课表|上周课表|这周课表)$",
                    fnc: "showWeeklyScheduleShortcut"
                },
                {
                    reg: "^#(第\\d+周课表)$",
                    fnc: "showWeeklyScheduleByNumber"
                }
            ]
        })
    }
    /**
     * 显示用户课表信息
     */
    async showUserInfo() {
        const userId = this.e.user_id;
        const scheduleData = DataManager.loadSchedule(userId);
        if (!scheduleData) {
            await this.reply("你还没有设置课程表，请使用 #设置课表 命令导入课表");
            return false;
        }
        const currentWeek = calculateCurrentWeek(scheduleData.semesterStart);
        const maxWeek = Math.max(...scheduleData.courses.flatMap(c => c.weeks), 0);
        if (maxWeek > 0 && currentWeek > maxWeek) {
            await this.reply("📅 本学期课程已全部结束，请使用 #设置课表 导入新学期课程。");
            return true;
        }
        const totalCourses = scheduleData.courses.length;
        const thisWeekCourses = scheduleData.courses.filter(course =>
            course.weeks.includes(currentWeek)
        ).length;
        // --- 新增：根据配置和聊天环境处理课表名称 ---
        const config = ConfigManager.getConfig();
        const showTableName = config.showTableName !== false; // 默认为 true
        const isGroup = !!this.e.group_id; // 判断是否为群聊
        let tableName = scheduleData.tableName;
        if (isGroup && !showTableName) {
            // 群聊且配置为隐藏时，使用昵称或“你”替换
            const nickname = scheduleData.nickname || "你";
            tableName = `${nickname}的课表`;
        }
        // --- 处理结束 ---
        // 准备图片数据
        const userInfoData = {
            nickname: scheduleData.nickname,
            signature: scheduleData.signature,
            tableName: tableName,
            semesterStart: scheduleData.semesterStart,
            currentWeek,
            totalCourses,
            thisWeekCourses,
            updateTime: scheduleData.updateTime
        };
        // 尝试生成图片
        const img = await generateUserInfoImage(userId, userInfoData, { e: this.e });
        if (img) {
            await this.reply(segment.image(img));
        } else {
            // 降级为文本（原有逻辑）
            let reply = `📊 你的课表信息\n`;
            reply += "=".repeat(20) + "\n";
            reply += `👤 昵称：${scheduleData.nickname || userId}\n`;
            if (scheduleData.signature) {
                reply += `💭 签名：${scheduleData.signature}\n`;
            }
            reply += `📚 课表：${scheduleData.tableName}\n`;
            reply += `📅 学期：${scheduleData.semesterStart}\n`;
            reply += `🔄 当前周数：第${currentWeek}周\n`;
            reply += `📈 课程统计：\n`;
            reply += `   总课程数：${totalCourses} 门\n`;
            reply += `   本周课程：${thisWeekCourses} 门\n`;
            reply += `⏰ 最后更新：${new Date(scheduleData.updateTime).toLocaleString()}\n\n`;
            reply += `使用命令：\n`;
            reply += `#今日课表 - 查看今日课程\n`;
            reply += `#明日课表 - 查看明日课程\n`;
            reply += `#课表查询 [周数] [星期] - 查询特定日期课程\n`;
            reply += `#课表设置昵称 [昵称] - 修改昵称`;
            await this.reply(reply);
        }
        return true;
    }
    /**
     * 显示今日课表（使用昵称）
     */
    async showTodaySchedule() {
        const userId = this.e.user_id;
        const today = new Date();
        const result = await DataManager.getCoursesForDate(userId, today);
        if (result.error) {
            await this.reply(result.error);
            return true;
        }
        // 获取当天的节假日/调休信息
        const holidayInfo = DataManager.getHolidayInfoForDate(today);
        let globalNotice = null;
        let isReschedule = false
        const schedule = DataManager.loadSchedule(userId);
        const todayWeek = result.week;
        const todayDay = result.day;
        isReschedule = DataManager.hasRescheduledCoursesForDate(schedule, todayWeek, todayDay)
        if (holidayInfo) {
            if (holidayInfo.isHoliday) {
                // 检查是否有调课课程，有则继续渲染
               //  const schedule = DataManager.loadSchedule(userId);
                if (schedule && isReschedule) {
                    globalNotice = `⚠️ 今日为法定节假日（${holidayInfo.name}），已为你显示调课后的课程安排。`;
                } else {
                    return this.reply(`今日是【${holidayInfo.name}】，法定节假日，无课程安排~`);
                }
            } else if (holidayInfo.isWorkdayOnWeekend) {
                // 仅当没有调课时才给出提示
                if (!isReschedule) {
                    globalNotice = `⚠️ 今日为调休上班日（${holidayInfo.name}），实际课程安排请以学校通知为准。\n可使用 #课表查询 命令查询对应课表。`;
                }
            }
        }
        // 尝试生成图片
        await this._sendScheduleReply(userId, today, result, schedule, globalNotice);
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
        const result = await DataManager.getCoursesForDate(userId, tomorrow);
        if (result.error) {
            await this.reply(result.error);
            return true;
        }
        // 尝试生成图片
        const schedule = DataManager.loadSchedule(userId);
        await this._sendScheduleReply(userId, tomorrow, result, schedule);
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
                `2. 日期（如 #课表查询 10-1，自动识别学期年份）\n` +
                `3. 整周查询（如 #课表查询 本周、下周、第${currentWeek}周）`
            );
            return true;
        }
        // 0. 先检测整周查询模式
        const weeklyResult = this._parseWeeklyQuery(param, schedule);
        if (weeklyResult) {
            return await this._showWeeklySchedule(userId, schedule, weeklyResult.week, weeklyResult.label);
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
            const result = await DataManager.getCoursesForDate(userId, targetDate);
            if (result.error) {
                await this.reply(result.error);
                return true;
            }
            await this._sendScheduleReply(userId, targetDate, result, schedule);
            return true;
        }
        // 2. 尝试匹配日期格式
        const dateInput = msg.replace(/^#(?:课表查询|schedule query)\s*/, '');
        let date = parseDateInput(dateInput, schedule.semesterStart);
        // 2.5 如果数字格式失败，尝试中文自然语言日期（如 10月1日、十一月十一日）
        if (!date) {
            const chineseMD = parseChineseDateToMD(dateInput);
            if (chineseMD) {
                date = parseDateInput(chineseMD, schedule.semesterStart);
            }
        }
        if (date) {
            const result = await DataManager.getCoursesForDate(userId, date);
            if (result.error) {
                await this.reply(result.error);
                return true;
            }
            await this._sendScheduleReply(userId, date, result, schedule);
            return true;
        }
        // 尝试匹配自然语言周数
        const naturalDate = this.parseNaturalLanguageQuery(param, schedule.semesterStart);
        if (naturalDate) {
            const result = await DataManager.getCoursesForDate(userId, naturalDate);
            if (result.error) {
                await this.reply(result.error);
                return true;
            }
            await this._sendScheduleReply(userId, naturalDate, result, schedule);
            return true;
        }
        // 3. 无法解析，给出提示
        const currentWeek = calculateCurrentWeek(schedule.semesterStart);
        await this.reply(
            `日期不存在或者格式有误~ 请使用以下格式：\n` +
            `1. #课表查询 周数 星期（如 #课表查询 ${currentWeek} 1）\n` +
            `2. #课表查询 月-日 或 月/日（如 #课表查询 10-1）\n` +
            `3. #课表查询 中文日期（如 #课表查询 10月1日 或 十一月十一）\n` +
            `4. #课表查询 本周/上周/下周 + 星期几（如 #课表查询 本周三）`
        );
        return true;
    }
    /**
      * 解析自然语言课表查询参数
      * @param {string} param - 用户输入的参数部分（如 "本周三"、"上周五"、"周一"）
      * @param {string} semesterStart - 学期开始日期 YYYY-MM-DD (仅用于辅助，非必需)
      * @returns {Date|null} 成功返回日期对象，失败返回 null
    */
    parseNaturalLanguageQuery(param, semesterStart) {
        if (!param) return null;
        // 1. 判断相对周偏移
        let weekOffset = 0; // 默认本周
        let remaining = param;
        if (param.startsWith('上')) {
            weekOffset = -1;
            remaining = param.slice(1);
        } else if (param.startsWith('下')) {
            weekOffset = 1;
            remaining = param.slice(1);
        } else if (param.startsWith('本')) {
            weekOffset = 0;
            remaining = param.slice(1);
        }
        // 2. 解析星期几
        const weekday = parseWeekday(remaining);
        if (!weekday) return null;

        // 3. 根据相对周和星期几计算具体日期
        const targetDate = getDateByRelativeWeek(weekOffset, weekday, new Date());
        return targetDate;
    }

    /**
     * 通用课表回复（图片优先，降级文本）
     * @param {string} userId - 用户ID
     * @param {Date} targetDate - 查询的日期
     * @param {Object} result - getCoursesForDate 返回的结果
     * @param {Object} schedule - 用户课表数据
     */
    async _sendScheduleReply(userId, targetDate, result, schedule, globalNotice = null) {
        const userData = {
            nickname: result.displayName,
            week: result.week,
            day: result.day,
            signature: schedule?.signature || '',
            courses: result.courses,
            hasRescheduled: result.courses.some(c => c.rescheduled === true)
        };
        if (globalNotice) {
            await this.reply(globalNotice);
        }
        await this.reply("正在渲染图片，请稍等一下哦~>_<~", false, { recallMsg: 5 });
        const img = await generateUserScheduleImage(userData, targetDate, { e: this.e });
        if (img) {
            await this.reply(segment.image(img));
        } else {
            const replyMsg = DataManager.formatCourses(result.courses, result.week, result.day, result.displayName);
            await this.reply(replyMsg);
        }
    }

    // ========== 周课表查询功能 ==========

    /**
     * #本周课表 / #下周课表 / #上周课表 快捷命令
     */
    async showWeeklyScheduleShortcut() {
        const userId = this.e.user_id;
        const schedule = DataManager.loadSchedule(userId);
        if (!schedule) {
            await this.reply("你还没有设置课程表，请使用 #设置课表 命令导入课表");
            return true;
        }
        const msg = this.e.msg;
        let weekOffset = 0;
        let label = '本周';
        if (/^#下周课表$/.test(msg)) { weekOffset = 1; label = '下周'; }
        else if (/^#上周课表$/.test(msg)) { weekOffset = -1; label = '上周'; }
        // 本周/这周 → offset=0

        const currentWeek = calculateCurrentWeek(schedule.semesterStart);
        const targetWeek = currentWeek + weekOffset;
        return await this._showWeeklySchedule(userId, schedule, targetWeek, label);
    }

    /**
     * #第N周课表 快捷命令
     */
    async showWeeklyScheduleByNumber() {
        const userId = this.e.user_id;
        const schedule = DataManager.loadSchedule(userId);
        if (!schedule) {
            await this.reply("你还没有设置课程表，请使用 #设置课表 命令导入课表");
            return true;
        }
        const match = this.e.msg.match(/^#第(\d+)周课表$/);
        if (!match) return true;
        const week = parseInt(match[1]);
        return await this._showWeeklySchedule(userId, schedule, week, `第${week}周`);
    }

    /**
     * 解析整周查询参数
     * @param {string} param - 用户输入的参数
     * @param {Object} schedule - 用户课表
     * @returns {{week: number, label: string}|null}
     */
    _parseWeeklyQuery(param, schedule) {
        if (!param) return null;
        // 匹配：本周 / 这周 / 下周 / 上周
        if (/^(本周|这周)$/.test(param)) {
            const week = calculateCurrentWeek(schedule.semesterStart);
            return { week, label: '本周' };
        }
        if (/^下周$/.test(param)) {
            const week = calculateCurrentWeek(schedule.semesterStart) + 1;
            return { week, label: '下周' };
        }
        if (/^上周$/.test(param)) {
            const week = calculateCurrentWeek(schedule.semesterStart) - 1;
            return { week, label: '上周' };
        }
        // 匹配：第N周 / 第N个周
        const weekNumMatch = param.match(/^第(\d+)周$/);
        if (weekNumMatch) {
            const week = parseInt(weekNumMatch[1]);
            return { week, label: `第${week}周` };
        }
        return null;
    }

    /**
     * 核心：渲染并发送周课表图片
     * @param {string} userId
     * @param {Object} schedule - 用户课表
     * @param {number} week - 目标周数
     * @param {string} label - 显示标签（如"第7周"）
     */
    async _showWeeklySchedule(userId, schedule, week, label) {
        // 校验周数有效性
        if (week < 1) {
            await this.reply("周数不能小于1，请输入正确的周数");
            return true;
        }
        const maxWeek = Math.max(...schedule.courses.flatMap(c => c.weeks), 0);
        if (maxWeek > 0 && week > maxWeek) {
            await this.reply(`第${week}周已超出本学期课程周数（最大第${maxWeek}周）`);
            return true;
        }

        // 构建7天数据
        const weekdayLabels = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const days = [];

        for (let d = 1; d <= 7; d++) {
            const targetDate = calculateDateFromWeekAndDay(schedule.semesterStart, week, d);
            const dateStr = targetDate
                ? targetDate.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
                : '--';
            const isToday = targetDate && targetDate.getTime() === today.getTime();

            // 筛选该天的课程
            const dayCourses = schedule.courses.filter(c =>
                parseInt(c.day) === d && c.weeks.includes(week)
            );
            dayCourses.sort((a, b) => a.startTime.localeCompare(b.startTime));

            days.push({
                label: weekdayLabels[d - 1],
                date: dateStr,
                isToday,
                courses: dayCourses.map(c => ({
                    name: c.name,
                    teacher: c.teacher || '',
                    startTime: c.startTime,
                    endTime: c.endTime,
                    location: c.location || '',
                    rescheduled: c.rescheduled || false,
                    originalDate: c.originalDate || ''
                }))
            });
        }

        // 计算日期范围（周一~周日）
        const monDate = calculateDateFromWeekAndDay(schedule.semesterStart, week, 1);
        const sunDate = calculateDateFromWeekAndDay(schedule.semesterStart, week, 7);
        let dateRange = '';
        if (monDate && sunDate) {
            dateRange = `${monDate.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} - ${sunDate.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}`;
        }

        await this.reply("正在渲染周课表，请稍等一下哦~>_<~", false, { recallMsg: 5 });
        const img = await generateWeeklyScheduleImage({
            nickname: schedule.nickname || `用户${userId}`,
            week,
            dateRange,
            signature: schedule.signature || '',
            days
        }, { e: this.e });

        if (img) {
            await this.reply(segment.image(img));
        } else {
            // 降级为文本
            let textReply = `📅 ${schedule.nickname || userId} 的第${week}周课表\n`;
            textReply += `${dateRange ? `📆 ${dateRange}\n` : ''}`;
            textReply += "=".repeat(25) + "\n";
            for (const day of days) {
                textReply += `\n📌 ${day.label} (${day.date})${day.isToday ? ' [今天]' : ''}\n`;
                if (day.courses.length === 0) {
                    textReply += "   无课程\n";
                } else {
                    for (const c of day.courses) {
                        const prefix = c.rescheduled ? '🔄 ' : '';
                        textReply += `   ${prefix}${c.name} | ${c.startTime}-${c.endTime}\n`;
                        const detail = [c.teacher, c.location].filter(Boolean).join(' | ');
                        if (detail) textReply += `      ${detail}\n`;
                    }
                }
            }
            await this.reply(textReply);
        }
        return true;
    }
}
export default ScheduleQuery
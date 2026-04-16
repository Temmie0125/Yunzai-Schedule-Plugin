import { DataManager } from '../components/DataManager.js'
import { ConfigManager } from '../components/ConfigManager.js'
import { calculateCurrentWeek, calculateWeekFromDate, parseDateInput, calculateDateFromWeekAndDay } from '../utils/timeUtils.js';
import { generateUserScheduleImage, generateUserInfoImage } from '../components/Renderer.js'

export class ScheduleQuery extends plugin {
    constructor() {
        super({
            name: "课程表查询",
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
        if (holidayInfo) {
            if (holidayInfo.isHoliday) {
                globalNotice = `今日是【${holidayInfo.name}】，法定节假日，无课程安排~`;
                // 节假日直接返回，跳过渲染
                return e.reply(globalNotice);
            } else if (holidayInfo.isWorkdayOnWeekend) {
                globalNotice = `⚠️ 今日为调休上班日（${holidayInfo.name}），实际课程安排请以学校通知为准。\n可使用 #课表查询 ${currentWeek} <星期几> 查询对应课表（例如 #课表查询 ${currentWeek} 1 查询周一课程）。`;
            }
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
        let replyMessage = [];
        if (globalNotice) replyMessage.push(globalNotice);
        const img = await generateUserScheduleImage(userData, today, { e: this.e });
        if (img) {
            replyMessage.push(segment.image(img));
            await this.reply(replyMessage);
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
        const result = await DataManager.getCoursesForDate(userId, tomorrow);
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
            const result = await DataManager.getCoursesForDate(userId, targetDate);
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
            const result = await DataManager.getCoursesForDate(userId, date);
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
}
export default ScheduleQuery
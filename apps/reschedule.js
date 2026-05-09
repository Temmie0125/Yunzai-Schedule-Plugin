import { DataManager } from '../components/DataManager.js'
import { parseDateInput, parseChineseDateToMD, parseWeekday, getDateByRelativeWeek } from '../utils/timeUtils.js';

export class ScheduleReschedule extends plugin {
    constructor() {
        super({
            name: "[Schedule] 调课管理",
            dsc: "调课与撤销调课功能",
            event: "message",
            priority: 1000,
            rule: [
                {
                    reg: "^#调课\\s+",
                    fnc: "rescheduleCommand"
                },
                {
                    reg: "^#撤销调课\\s*",
                    fnc: "undoRescheduleCommand"
                }
            ]
        })
    }

    /**
     * 解析日期参数（支持数字日期和自然语言）
     * @param {string} param - 日期字符串
     * @param {string} semesterStart - 学期开始日期
     * @returns {Date|null}
     */
    _parseDate(param, semesterStart) {
        // 尝试数字日期格式
        let date = parseDateInput(param, semesterStart);
        if (date) return date;

        // 尝试中文日期格式
        const chineseMD = parseChineseDateToMD(param);
        if (chineseMD) {
            date = parseDateInput(chineseMD, semesterStart);
            if (date) return date;
        }

        // 尝试自然语言周数（本周三、下周一等）
        return this._parseNaturalDate(param);
    }

    /**
     * 解析自然语言日期
     * @param {string} param
     * @returns {Date|null}
     */
    _parseNaturalDate(param) {
        if (!param) return null;
        let weekOffset = 0;
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
        const weekday = parseWeekday(remaining);
        if (!weekday) return null;
        return getDateByRelativeWeek(weekOffset, weekday, new Date());
    }

    /**
     * #调课 <原日期> <新日期>
     */
    async rescheduleCommand() {
        const userId = this.e.user_id;
        const schedule = DataManager.loadSchedule(userId);
        if (!schedule) {
            await this.reply("你还没有设置课程表，请使用 #设置课表 命令导入课表");
            return true;
        }

        const msg = this.e.msg;
        const match = msg.match(/^#调课\s+(.+?)\s+(.+)$/);
        if (!match) {
            await this.reply(
                "调课命令格式有误，请使用：\n" +
                "#调课 <原日期> <新日期>\n" +
                "例如：#调课 5-5 5-9\n" +
                "支持格式：MM-DD、MM/DD、中文日期（如 5月5日）、自然语言（如 本周三）"
            );
            return true;
        }

        const param1 = match[1].trim();
        const param2 = match[2].trim();

        const originalDate = this._parseDate(param1, schedule.semesterStart);
        if (!originalDate) {
            await this.reply(`无法解析原日期「${param1}」，请使用 MM-DD、中文日期或自然语言（如 本周三）格式`);
            return true;
        }

        const newDate = this._parseDate(param2, schedule.semesterStart);
        if (!newDate) {
            await this.reply(`无法解析新日期「${param2}」，请使用 MM-DD、中文日期或自然语言（如 本周三）格式`);
            return true;
        }

        // 检查两个日期是否相同
        if (originalDate.toDateString() === newDate.toDateString()) {
            await this.reply("原日期和新日期相同，无需调课~");
            return true;
        }

        const result = DataManager.rescheduleCourses(userId, originalDate, newDate);

        if (!result.success) {
            if (result.hasConflict) {
                // 有冲突，询问用户是否调换
                const origDateStr = originalDate.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
                const newDateStr = newDate.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
                const origCourseNames = result.origCourses.map(c => c.name).join('、');
                const newCourseNames = result.newCourses.map(c => c.name).join('、');

                // 保存上下文供后续确认
                this.setContext("confirmSwap", 60);
                this.e._swapOriginalDate = originalDate;
                this.e._swapNewDate = newDate;

                await this.reply(
                    `⚠️ 调课冲突检测\n` +
                    `原日期 ${origDateStr} 有课程：${origCourseNames}\n` +
                    `新日期 ${newDateStr} 已有课程：${newCourseNames}\n\n` +
                    `是否调换两天的课程安排？\n` +
                    `回复「是」或「确认」进行调换，回复「否」或「取消」放弃操作。`
                );
                return true;
            }
            await this.reply(result.error);
            return true;
        }

        const origDateStr = originalDate.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
        const newDateStr = newDate.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
        await this.reply(`✅ 已成功将 ${origDateStr} 的课程调至 ${newDateStr}。\n可使用 #撤销调课 ${newDateStr} 撤销调课。`);
        return true;
    }

    /**
     * 确认调换（上下文回调）
     */
    async confirmSwap() {
        const msg = this.e.msg.trim();
        const confirmed = /^(是|确认|好|可以|行|彳亍|yes|ok|y)$/i.test(msg);
        const cancelled = /^(否|不|取消|算了|别|no|n)$/i.test(msg);

        if (cancelled) {
            this.finish("confirmSwap");
            await this.reply("已取消调课操作~");
            return true;
        }

        if (!confirmed) {
            await this.reply("请回复「是」或「否」来确认是否调换两天的课程。");
            return true;
        }

        const originalDate = this.e._swapOriginalDate;
        const newDate = this.e._swapNewDate;

        if (!originalDate || !newDate) {
            this.finish("confirmSwap");
            await this.reply("调课信息已过期，请重新输入调课命令。");
            return true;
        }

        const result = DataManager.swapDayCourses(this.e.user_id, originalDate, newDate);

        this.finish("confirmSwap");

        if (result.success) {
            const origDateStr = originalDate.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
            const newDateStr = newDate.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
            await this.reply(`✅ 已成功调换 ${origDateStr} 与 ${newDateStr} 两天的课程安排。`);
        } else {
            await this.reply(`❌ 调换失败：${result.error}`);
        }
        return true;
    }

    /**
     * #撤销调课 <日期>
     */
    async undoRescheduleCommand() {
        const userId = this.e.user_id;
        const schedule = DataManager.loadSchedule(userId);
        if (!schedule) {
            await this.reply("你还没有设置课程表，请使用 #设置课表 命令导入课表");
            return true;
        }

        const msg = this.e.msg;
        const match = msg.match(/^#撤销调课\s*(.*)$/);
        const param = match[1].trim();

        if (!param) {
            await this.reply(
                "请指定要撤销调课的日期：\n" +
                "#撤销调课 <日期>\n" +
                "例如：#撤销调课 5-9"
            );
            return true;
        }

        const date = this._parseDate(param, schedule.semesterStart);
        if (!date) {
            await this.reply(`无法解析日期「${param}」，请使用 MM-DD、中文日期或自然语言格式`);
            return true;
        }

        const result = DataManager.undoReschedule(userId, date);

        if (result.success) {
            const dateStr = date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
            await this.reply(`✅ 已成功撤销 ${dateStr} 的调课，恢复了 ${result.count} 门课程到原始时间。`);
        } else {
            await this.reply(result.error);
        }
        return true;
    }
}

export default ScheduleReschedule

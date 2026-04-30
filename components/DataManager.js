// components/DataManager.js
import fs from 'node:fs'
import path from 'node:path'
import { ConfigManager } from './ConfigManager.js'
import { calculateWeekFromDate } from '../utils/timeUtils.js';
const DATA_PATH = path.join(process.cwd(), 'plugins/schedule/data/')
const SKIP_STATUS_PATH = path.join(DATA_PATH, 'skip-status.json')
const REMINDER_STATUS_PATH = path.join(DATA_PATH, 'reminder-status.json');
const BIRTHDAY_DATA_PATH = path.join(DATA_PATH, 'birthdayData.json');
const HOLIDAY_RESOURCE_PATH = path.join(process.cwd(), 'plugins/schedule/resources/holiday/'); // 节假日数据目录
// 节假日数据缓存（Map<年份, 节假日对象>）
let holidayCache = new Map();
export class DataManager {
    /**
     * 加载用户课表数据
     * @param {string|number} userId
     * @returns {object|null}
     */
    static loadSchedule(userId) {
        const filePath = path.join(DATA_PATH, `${userId}.json`)
        if (!fs.existsSync(filePath)) return null
        try {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'))
        } catch (err) {
            logger.error(`读取用户 ${userId} 课表失败: ${err}`)
            return null
        }
    }

    /**
 * 获取所有已设置课表的用户数据（仅包含有效课程的用户）
 * @returns {Array<{userId: string, schedule: object}>} 用户ID与课表对象的数组
 */
    static getAllUserSchedules() {
        if (!fs.existsSync(DATA_PATH)) return [];
        const files = fs.readdirSync(DATA_PATH).filter(f =>
            f.endsWith('.json') &&
            !['skip-status.json', 'reminder-status.json', 'birthdayData.json'].includes(f)
        );
        const result = [];
        for (const file of files) {
            const userId = path.basename(file, '.json');
            // 检查文件名是否为纯数字（QQ号）
            if (!/^\d+$/.test(userId)) continue;

            const schedule = this.loadSchedule(userId);
            if (schedule && schedule.courses && schedule.courses.length > 0) {
                result.push({ userId, schedule });
            }
        }
        return result;
    }

    /**
     * 保存用户昵称
     */
    static async saveUserNickname(userId, nickname) {
        try {
            const filePath = path.join(DATA_PATH, `${userId}.json`)
            // 确保目录存在
            const dir = path.dirname(filePath)
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

            if (fs.existsSync(filePath)) {
                // 读取现有数据
                const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
                // 更新昵称
                data.nickname = nickname
                data.updateTime = new Date().toISOString()
                // 保存数据
                fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
            } else {
                // 创建新的数据文件
                const data = {
                    tableName: '未设置',
                    semesterStart: new Date().toISOString().split('T')[0],
                    updateTime: new Date().toISOString(),
                    nickname: nickname,
                    courses: []
                }
                fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
            }

            return true
        } catch (error) {
            logger.error(`保存用户 ${userId} 昵称失败: ${error}`)
            return false
        }
    }

    /**
   * 保存用户个性签名
   */
    static async saveUserSignature(userId, signature) {
        try {
            const filePath = path.join(DATA_PATH, `${userId}.json`)
            // 确保目录存在
            const dir = path.dirname(filePath)
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

            if (fs.existsSync(filePath)) {
                // 读取现有数据
                const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
                // 更新签名
                data.signature = signature
                data.updateTime = new Date().toISOString()
                // 保存数据
                fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
            } else {
                // 如果还没有课程表数据，创建新的数据文件
                const data = {
                    tableName: '未设置',
                    semesterStart: new Date().toISOString().split('T')[0],
                    updateTime: new Date().toISOString(),
                    nickname: userId.toString(),
                    signature: signature,  // 新增签名字段
                    courses: []
                }
                fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
            }

            return true
        } catch (error) {
            logger.error(`保存用户 ${userId} 签名失败: ${error}`)
            return false
        }
    }

    /**
     * 保存用户课表数据（保留原昵称/签名）
     * @param {string|number} userId
     * @param {object} scheduleData - 从API获取的课表数据
     * @param {string} [nickname] - 昵称（若未传则保留原有或userId）
     * @param {string} [signature] - 签名（若未传则保留原有）
     */
    static saveSchedule(userId, scheduleData, nickname = null, signature = null) {
        const filePath = path.join(DATA_PATH, `${userId}.json`)
        const existing = this.loadSchedule(userId) || {}

        const fullData = {
            tableName: scheduleData.tableName,
            semesterStart: scheduleData.semesterStart,
            updateTime: new Date().toISOString(),
            nickname: nickname || existing.nickname || userId.toString(),
            signature: signature !== null ? signature : (existing.signature || ''),
            courses: scheduleData.courses
        }

        // 确保目录存在
        const dir = path.dirname(filePath)
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

        fs.writeFileSync(filePath, JSON.stringify(fullData, null, 2), 'utf8')
        logger.info(`用户 ${userId} 课表保存成功，昵称: ${fullData.nickname}`)
    }
    /**
   * 获取指定日期的课程
   * @param {number} userId 用户QQ
   * @param {Date} date 查询日期
   * @returns {Promise<Object>} 包含 courses, week, day, displayName 或 error
   */
    static async getCoursesForDate(userId, date) {
        const schedule = this.loadSchedule(userId);
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
            // 转换为数字避免数值类型问题
            parseInt(course.day) === day && course.weeks.includes(week)
        );
        // 按开始时间排序（升序）
        courses.sort((a, b) => a.startTime.localeCompare(b.startTime));
        const displayName = schedule.nickname || `用户${userId}`;
        return { courses, week, day, displayName };
    }

    /**
 * 清除用户的课程数据，保留基本信息
 * @param {string|number} userId
 * @returns {{ success: boolean, exists: boolean }}
 *   success: 操作是否成功
 *   exists:  文件是否存在（若文件不存在，success 为 false）
 */
    static clearUserCourses(userId) {
        const filePath = path.join(DATA_PATH, `${userId}.json`);

        // 文件不存在，直接返回
        if (!fs.existsSync(filePath)) {
            return { success: false, exists: false };
        }

        try {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            // 清空课程，保留其他信息
            data.courses = [];
            data.updateTime = new Date().toISOString();

            // 确保目录存在（理论上已有，但为安全可保留）
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

            fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
            logger.info(`用户 ${userId} 课程数据已清除，基本信息保留`);
            return { success: true, exists: true };
        } catch (err) {
            logger.error(`清除用户 ${userId} 课程数据失败: ${err}`);
            return { success: false, exists: true };
        }
    }

    // ---------- 翘课状态 ----------
    // 加载单个用户的翘课状态（返回 { enabled, expireTime }）
    static async loadSkipStatus(userId) {
        const all = await this.loadAllSkipStatus();
        const raw = all[userId];
        if (raw === undefined) return { enabled: false, expireTime: null };
        if (typeof raw === 'boolean') {
            // 旧格式，转换为新格式，没有过期时间，设为 null
            return { enabled: raw, expireTime: null };
        }
        return raw;
    }

    // 加载所有翘课状态
    static async loadAllSkipStatus() {
        if (!fs.existsSync(SKIP_STATUS_PATH)) return {};
        try {
            return JSON.parse(fs.readFileSync(SKIP_STATUS_PATH, 'utf8'));
        } catch {
            return {};
        }
    }

    // 保存翘课状态（支持 enabled 和 expireTime）
    static async saveSkipStatus(userId, enabled, expireTime = null) {
        const all = await this.loadAllSkipStatus();
        if (enabled) {
            all[userId] = { enabled, expireTime };
        } else {
            delete all[userId];
        }
        const dir = path.dirname(SKIP_STATUS_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(SKIP_STATUS_PATH, JSON.stringify(all, null, 2), 'utf8');
    }

    // 可选：提供仅修改 enabled 的便捷方法
    static async setSkipEnabled(userId, enabled, expireTime = null) {
        await this.saveSkipStatus(userId, enabled, expireTime);
    }

    // ---------- 辅助 ----------
    static async getUserNickname(userId, event) {
        // 先从已有数据获取
        const data = this.loadSchedule(userId)
        if (data?.nickname) return data.nickname
        // 尝试获得用户昵称：群名片->直接昵称
        const nickname = event.sender?.card || event.sender?.nickname || null
        return nickname
    }

    /**
    * 将课程列表格式化为回复文本
    * @param {Array} courses 课程数组
    * @param {number} week 周数
    * @param {number} day 星期（1-7）
    * @param {string} displayName 显示名称
    * @returns {string} 格式化后的消息
    */
    static formatCourses(courses, week, day, displayName) {
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

    // 添加辅助方法：读取帮助配置文件
    static async getHelpData() {
        const configPath = path.join(process.cwd(), 'plugins/schedule/config/help.json')
        let helpData = {}
        try {
            helpData = JSON.parse(fs.readFileSync(configPath, 'utf8'))
        } catch (err) {
            logger.error('[课程表插件] 读取帮助配置失败，使用默认数据', err)
            helpData = this.getDefaultHelpData()
        }
        return helpData
    }
    // 默认帮助数据（当配置文件不存在时使用）
    static getDefaultHelpData() {
        return {
            title: "课程表帮助",
            subTitle: "Yunzai-Bot & 课程表插件",
            bg: "",
            groups: [
                {
                    group: "基础功能",
                    list: [
                        { icon: 1, title: "#设置课表", desc: "导入WakeUP分享口令" },
                        { icon: 2, title: "#清除课表", desc: "清除自己的课程表" },
                        { icon: 3, title: "#课表设置昵称", desc: "修改显示昵称" },
                        { icon: 4, title: "#课表设置签名", desc: "设置个性签名(最多30字)" }
                    ]
                },
                {
                    group: "查询功能",
                    list: [
                        { icon: 5, title: "#今日课表", desc: "查看今日课程" },
                        { icon: 6, title: "#明日课表", desc: "查看明日课程" },
                        { icon: 7, title: "#课表查询", desc: "查询指定日期课程" },
                        { icon: 8, title: "#我的课表", desc: "查看自己的课表信息" }
                    ]
                },
                {
                    group: "群互动",
                    list: [
                        { icon: 9, title: "#群课表", desc: "查看群友上课状态" },
                        { icon: 10, title: "#翘课", desc: "开启/关闭翘课模式" },
                        { icon: 11, title: "#开启课表订阅", desc: "开启明日课表推送(需加好友)" }
                    ]
                }
            ]
        }
    }

    // 保留原有文本帮助作为降级
    static getDefaultHelpText() {
        return `课程表帮助
==========
【#设置课表 WakeUP分享口令】设置课程表
【#清除课表】清除自己的课表
【#课表设置昵称 昵称】修改昵称
【#课表设置签名 签名】设置个性签名(最多30字)
【#今日课表|明日课表】查看自己今日/明日课表
【#课表查询 周数 星期】查看自己某日的课表
【#我的课表】查看自己的相关信息
【#课程表|群课表】查看（视奸）群友的上课状态
【#翘课|取消翘课】开关翘课状态
【#开启|关闭课表订阅】开关课表订阅通知（需要加bot好友）`
    }

    /**
     * 加载所有订阅状态
     * @returns {Promise<Object>} 键为用户ID，值为 true
     */
    static async loadReminderStatus() {
        if (!fs.existsSync(REMINDER_STATUS_PATH)) return {};
        try {
            return JSON.parse(fs.readFileSync(REMINDER_STATUS_PATH, 'utf8'));
        } catch {
            return {};
        }
    }

    /**
     * 保存订阅状态
     * @param {Object} status 
     */
    static async saveReminderStatus(status) {
        const dir = path.dirname(REMINDER_STATUS_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(REMINDER_STATUS_PATH, JSON.stringify(status, null, 2), 'utf8');
    }

    /**
     * 设置单个用户的订阅状态
     * @param {string|number} userId 
     * @param {boolean} enabled 
     */
    static async setReminderStatus(userId, enabled) {
        const status = await this.loadReminderStatus();
        if (enabled) {
            status[userId] = true;
        } else {
            delete status[userId];
        }
        await this.saveReminderStatus(status);
    }

    /**
     * 获取所有开启订阅的用户ID列表
     * @returns {Promise<string[]>}
     */
    static async getAllReminderUsers() {
        const status = await this.loadReminderStatus();
        // 只保留状态为 true 的用户
        return Object.keys(status).filter(userId => status[userId] === true);
    }
    /**
     * 加载生日数据
     */
    static loadBirthdayData() {
        if (!fs.existsSync(BIRTHDAY_DATA_PATH)) return {};
        try {
            return JSON.parse(fs.readFileSync(BIRTHDAY_DATA_PATH, 'utf8'));
        } catch (err) {
            logger.error('[生日数据] 加载失败:', err);
            return {};
        }
    }
    /**
     * 保存生日数据
     * @param {*} 生日数据 
     */
    static saveBirthdayData(data) {
        const dir = path.dirname(BIRTHDAY_DATA_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(BIRTHDAY_DATA_PATH, JSON.stringify(data, null, 2), 'utf8');
        return true;
    }
    /**
       * 转换为原生格式
       */
    static convertToNativeFormat(scheduleData) {
        return {
            tableName: scheduleData.tableName,
            semesterStart: scheduleData.semesterStart,
            updateTime: scheduleData.updateTime,
            nickname: scheduleData.nickname,
            signature: scheduleData.signature,
            courses: scheduleData.courses.map(c => ({
                name: c.name,
                teacher: c.teacher,
                location: c.location,
                day: c.day,
                startTime: c.startTime,
                endTime: c.endTime,
                weeks: c.weeks
            }))
        };
    }
    /**
     * 转换为拾光JSON
     * @param {*} scheduleData 
     * @returns Shiguang JSON
     */
    static convertToShiguangFormat(scheduleData) {
        const defaultTimeSlots = this.getDefaultTimeSlots();
        const courses = scheduleData.courses.map((course) => ({
            id: this.generateShortUuid(),
            name: course.name,
            teacher: course.teacher || '',
            position: course.location || '',
            day: Number(course.day),           // 确保为数字
            weeks: course.weeks,
            color: 9,
            isCustomTime: true,
            customStartTime: course.startTime,
            customEndTime: course.endTime
        }));

        // 格式化日期为 YYYY-MM-DD
        let semesterStart = scheduleData.semesterStart;
        if (semesterStart) {
            const date = new Date(semesterStart);
            if (!isNaN(date.getTime())) {
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                semesterStart = `${year}-${month}-${day}`;
            }
        }

        return {
            courses,
            timeSlots: defaultTimeSlots,
            config: { semesterStartDate: semesterStart }
        };
    }
    /**
     * 生成标准UUID
     * @returns UUID
     */
    static generateShortUuid() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
    /**
 * 获取默认时间段（可根据需要从配置文件读取）
 */
    static getDefaultTimeSlots() {
        // 从配置管理器获取，若无则使用硬编码默认值
        const config = ConfigManager.getConfig();
        if (config.timeSlots && Array.isArray(config.timeSlots)) {
            return config.timeSlots;
        }
        // 默认大学作息时间表
        return [
            { number: 1, startTime: "08:00", endTime: "08:45" },
            { number: 2, startTime: "08:50", endTime: "09:35" },
            { number: 3, startTime: "09:50", endTime: "10:35" },
            { number: 4, startTime: "10:40", endTime: "11:25" },
            { number: 5, startTime: "11:30", endTime: "12:15" },
            { number: 6, startTime: "14:00", endTime: "14:45" },
            { number: 7, startTime: "14:50", endTime: "15:35" },
            { number: 8, startTime: "15:45", endTime: "16:30" },
            { number: 9, startTime: "16:35", endTime: "17:20" },
            { number: 10, startTime: "18:30", endTime: "19:15" },
            { number: 11, startTime: "19:20", endTime: "20:05" },
            { number: 12, startTime: "20:10", endTime: "20:55" },
            { number: 13, startTime: "21:10", endTime: "21:55" }
        ];
    }
    /**
     * 加载指定年份的节假日数据
     * @param {number} year - 年份
     * @returns {object|null} holiday 对象（key: MM-DD, value: 节假日信息）
     */
    static loadHolidayData(year) {
        if (holidayCache.has(year)) return holidayCache.get(year);
        const filePath = path.join(HOLIDAY_RESOURCE_PATH, `${year}.json`);
        if (!fs.existsSync(filePath)) {
            logger.warn(`[课程表插件] 节假日数据文件不存在: ${filePath}`);
            return null;
        }
        try {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            const holidays = data.holiday || {};
            holidayCache.set(year, holidays);
            return holidays;
        } catch (err) {
            logger.error(`[课程表插件] 读取节假日数据失败: ${err}`);
            return null;
        }
    }
    /**
 * 获取指定日期的节假日/调休信息
 * @param {Date} date - 要查询的日期
 * @returns {{ isHoliday: boolean, isWorkdayOnWeekend: boolean, name: string } | null}
 */
    static getHolidayInfoForDate(date) {
        const year = date.getFullYear();
        const holidays = this.loadHolidayData(year);
        if (!holidays) return null;
        const monthDay = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        const holiday = holidays[monthDay];
        if (!holiday) return null;
        if (holiday.holiday === true) {
            return { isHoliday: true, isWorkdayOnWeekend: false, name: holiday.name || '节假日' };
        }
        if (holiday.holiday === false) {
            return { isHoliday: false, isWorkdayOnWeekend: true, name: holiday.name || '调休上班' };
        }
        return null;
    }
    /**
     * 判断学期是否已结束（指定日期所在的周数超出课表最大周数）
     * @param {object} schedule - 用户课表数据
     * @param {Date} date - 要判断的日期
     * @returns {boolean}
     */
    static isSemesterEnded(schedule, date) {
        const semesterStart = schedule.semesterStart;
        if (!semesterStart) return false;
        const weekNum = calculateWeekFromDate(semesterStart, date);
        if (weekNum === null) return true; // 日期早于学期开始，视为异常结束
        // 计算课表最大周数
        let maxWeek = 0;
        if (schedule.courses && schedule.courses.length > 0) {
            maxWeek = Math.max(...schedule.courses.flatMap(course => course.weeks));
        }
        // 没有课程或最大周数为0时，默认学期未结束（避免误判）
        return maxWeek > 0 && weekNum > maxWeek;
    }
}
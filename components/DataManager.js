// components/DataManager.js
import fs from 'node:fs'
import path from 'node:path'

const DATA_PATH = path.join(process.cwd(), 'plugins/schedule/data/')
const SKIP_STATUS_PATH = path.join(DATA_PATH, 'skip-status.json')
const REMINDER_STATUS_PATH = path.join(DATA_PATH, 'reminder-status.json');

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

        // 从事件中获取群名片/昵称
        if (event.isGroup && event.sender) {
            return event.sender.card || event.sender.nickname || null
        }
        return null
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
}
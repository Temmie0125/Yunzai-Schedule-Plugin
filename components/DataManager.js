/*
 * @Author: Temmie0125 1179755948@qq.com
 * @Date: 2026-03-06 13:43:00
 * @LastEditors: Temmie0125 1179755948@qq.com
 * @LastEditTime: 2026-03-09 21:18:28
 * @FilePath: \实验与作业e:\bot\Yunzai\plugins\schedule\components\DataManager.js
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
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
    /**
     * 加载翘课状态
     * @param {String} userId 用户
     * @returns true/false
     */
    static async loadSkipStatus(userId) {
        const all = await this.loadAllSkipStatus()
        return all[userId] || false
    }

    /**
     * 加载所有翘课状态
     * @returns JSON
     */
    static async loadAllSkipStatus() {
        if (!fs.existsSync(SKIP_STATUS_PATH)) return {}
        try {
            return JSON.parse(fs.readFileSync(SKIP_STATUS_PATH, 'utf8'))
        } catch {
            return {}
        }
    }

    /**
     * 保存翘课状态
     * @param {string} userId QQ号
     * @param {boolean} status 状态
     */
    static async saveSkipStatus(userId, status) {
        const all = await this.loadAllSkipStatus()
        all[userId] = status
        const dir = path.dirname(SKIP_STATUS_PATH)
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(SKIP_STATUS_PATH, JSON.stringify(all, null, 2), 'utf8')
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
        return Object.keys(status);
    }
}
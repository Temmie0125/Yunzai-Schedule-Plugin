// services/scheduleImporter.js
import { fetchScheduleFromAPI } from './wakeupApi.js'
import { DataManager } from '../components/DataManager.js'

/**
 * 从口令导入课表的核心逻辑
 * @param {string|number} userId 用户QQ号
 * @param {string} code 提取出的口令
 * @param {object} event 事件对象（用于获取默认昵称）
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function importScheduleFromCode(userId, code, event) {
    // 1. 格式校验
    if (!code || !/^[0-9a-zA-Z\-_]+$/.test(code)) {
        return {
            success: false,
            message: "口令格式不正确，请确保是WakeUp课程表的正确分享口令"
        };
    }

    try {
        // 2. 调用 API 获取课表数据
        const scheduleData = await fetchScheduleFromAPI(code);
        if (!scheduleData) {
            return {
                success: false,
                message: "获取课表失败，请检查口令"
            };
        }

        // 3. 保留原有昵称和签名
        const oldData = DataManager.loadSchedule(userId);
        let nickname = oldData?.nickname;
        let signature = oldData?.signature;
        if (!nickname) {
            nickname = (await DataManager.getUserNickname(userId, event)) || userId.toString();
        }

        // 4. 保存课表
        DataManager.saveSchedule(userId, scheduleData, nickname, signature);

        // 5. 构造成功消息
        let replyMsg = `课程表设置成功！\n课表名称：${scheduleData.tableName}\n学期开始：${scheduleData.semesterStart}\n共 ${scheduleData.courses.length} 门课程\n昵称：${nickname}`;
        if (signature) replyMsg += `\n签名：${signature}`;
        if (nickname === userId.toString()) {
            replyMsg += `\n⚠️ 建议使用 #课表设置昵称 设置昵称`;
        }
        replyMsg += `\n⚠️ 为了保障您的隐私安全，建议及时撤回口令哦~`;

        return {
            success: true,
            message: replyMsg
        };
    } catch (err) {
        logger.error(`设置课表失败: ${err}`);
        return {
            success: false,
            message: "设置课表失败，请稍后重试"
        };
    }
}
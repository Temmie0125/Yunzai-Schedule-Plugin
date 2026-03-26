// services/scheduleImporter.js
import { fetchScheduleFromAPI } from './wakeupApi.js'
import { DataManager } from '../components/DataManager.js'
import { ConfigManager } from '../components/ConfigManager.js'  // 新增
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
        // 2. 获取配置
        const config = ConfigManager.getConfig()
        const showTableName = config.showTableName ?? true
        const autoRecallCode = config.autoRecallCode ?? false

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

        // 6. 构造成功消息（根据配置决定是否显示课表名称）
        let replyMsg = `课程表设置成功！\n`
        // 判断是否在群聊且配置为关闭显示课表名称
        const inGroup = !!event.group
        if (!inGroup || showTableName) {
            replyMsg += `课表名称：${scheduleData.tableName}\n`
        }
        replyMsg += `学期开始：${scheduleData.semesterStart}\n`
        replyMsg += `共 ${scheduleData.courses.length} 门课程\n`
        replyMsg += `昵称：${nickname}`
        if (signature) replyMsg += `\n签名：${signature}`
        if (nickname === userId.toString()) {
            replyMsg += `\n⚠️ 建议使用 #课表设置昵称 设置昵称`
        }
        replyMsg += `\n⚠️ 正在尝试自动撤回您的口令，如果撤回失败请及时手动撤回口令哦~`

        // 7. 自动撤回口令（群聊且配置开启且Bot有管理员权限）
        if (inGroup && autoRecallCode) {
            const group = event.group
            // 检查Bot是否为管理员或群主
            if (group.is_admin || group.is_owner) {
                try {
                    // 撤回用户发送的口令消息
                    await group.recallMsg(event.message_id)
                    logger.mark(`[课表导入] 已自动撤回用户 ${userId} 在群 ${group.group_id} 的口令消息`)
                } catch (recallErr) {
                    logger.error(`[课表导入] 撤回口令失败: ${recallErr}`)
                }
            } else {
                logger.debug(`[课表导入] Bot在群 ${group.group_id} 无管理员权限，无法撤回`)
            }
        }

        return { success: true, message: replyMsg }
    } catch (err) {
        logger.error(`设置课表失败: ${err}`)
        return { success: false, message: "设置课表失败，请稍后重试" }
    }
}
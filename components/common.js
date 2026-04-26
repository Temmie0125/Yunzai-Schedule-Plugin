import { ConfigManager } from "./ConfigManager.js"
/**
 *
 * 制作转发消息
 * @param e
 * @param msg 消息体
 * @param dec 描述
 * @returns {Promise<boolean|*>}
 */
export async function makeForwardMsg(e, msg = [], dec = '') {
    const bot = e.bot || Bot
    let nickname = bot.nickname
    if (e.isGroup && bot.getGroupMemberInfo) try {
        const info = await bot.getGroupMemberInfo(e.group_id, bot.uin)
        nickname = info.card || info.nickname
    } catch { }
    let userInfo = {
        user_id: bot.uin,
        nickname,
    }
    let forwardMsg = []
    msg.forEach(v => {
        forwardMsg.push({
            ...userInfo,
            message: v,
        })
    })
    /** 制作转发内容 */
    if (e.group?.makeForwardMsg) {
        forwardMsg = await e.group.makeForwardMsg(forwardMsg)
    } else if (e.friend?.makeForwardMsg) {
        forwardMsg = await e.friend.makeForwardMsg(forwardMsg)
    } else {
        forwardMsg = await Bot.makeForwardMsg(forwardMsg)
    }
    if (dec) {
        /** 处理描述 */
        if (typeof (forwardMsg.data) === 'object') {
            let detail = forwardMsg.data?.meta?.detail
            if (detail) {
                detail.news = [{ text: dec }]
            }
        } else {
            forwardMsg.data = forwardMsg.data
                .replace(/\n/g, '')
                .replace(/<title color="#777777" size="26">(.+?)<\/title>/g, '___')
                .replace(/___+/, `<title color="#777777" size="26">${dec}</title>`)
        }
    }
    return forwardMsg
}
/**
 * 权限检查（群管理员或主人）
 * @param {*} e 
 * @returns Boolean
 */
export function checkPermission(e) {
    if (e.isMaster) return true
    if (!e.isGroup) return false  // 非群聊只允许主人使用
    const member = e.group.pickMember(e.user_id)
    if (e.isGroup && e.member?.role && ['owner', 'admin'].includes(e.member.role)) return true
    if (e.isGroup && (member.is_admin || member.is_owner)) return true
    return false
}
/**
 * 检查是否是好友
 * @param {*} userId 用户QQ号
 * @returns Boolean
 */
export function checkFriend(userId) {
    if (!Bot.fl || !Bot.fl.has(Number(userId))) return false
    return true
}
/**
 * 从事件对象中提取文件信息（兼容私聊和群聊）
 * @param {object} e 事件对象
 * @returns {{ fileName: string, fileSize: number, fileId: string, busid?: number } | null}
 */
export function getFileInfo(e) {
    if (!e.file) return null;
    let fileName = '';
    let fileSize = 0;
    let fileId = '';
    let busid = null;
    // 私聊文件结构：e.file.data
    if (e.file.data) {
        fileName = e.file.data.file || e.file.data.filename || '';
        fileSize = parseInt(e.file.data.file_size || e.file.data.size || 0, 10);
        fileId = e.file.data.file_id || e.file.data.id || '';
        busid = e.file.data.busid;
    }
    // 群聊文件结构：e.file 直接包含 id, name, size, busid
    if (!fileName && e.file.name) {
        fileName = e.file.name;
        fileSize = parseInt(e.file.size || 0, 10);
        fileId = e.file.id || '';
        busid = e.file.busid;
    }
    // 兜底
    if (!fileName) {
        fileName = e.file.file || e.file.filename || '';
    }
    if (!fileSize) {
        fileSize = parseInt(e.file.file_size || e.file.size || 0, 10);
    }
    if (!fileId) {
        fileId = e.file.file_id || e.file.id || '';
    }
    if (!fileName || !fileSize || !fileId) {
        logger.warn("[课表导入] 无法提取完整的文件信息", { eFile: e.file });
        return null;
    }
    return { fileName, fileSize, fileId, busid };
}
/**
 * 获取群成员列表
 * @param {*} groupId 群号
 * @returns {List} 群成员列表
 */
export async function getGroupMembers(groupId) {
    try {
        const group = await Bot.pickGroup(groupId)
        const memberList = await group.getMemberMap()
        return Array.from(memberList.values())
    } catch (error) {
        logger.error(`获取群成员失败: ${error}`)
        return []
    }
}
/**
 * 获取用户头像URL
 */
export async function getAvatarUrl(userId) {
    // QQ头像地址
    return `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=640`
}
/**
 * 获取Bot自定义名称
 */
export function getBotName(e = null){
    let bot;
    if(e){
        bot = e.bot || Bot;
    }
    else{
        bot = Bot;
    }
    const config = ConfigManager.getConfig();
    return config.botName || bot.nickname || "Bot";
}

import fs from 'node:fs';
import path from 'node:path';
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
 * @returns {{ fileName: string, fileSize: number, fileId: string, busid?: number, fileHash?: string, fileUrl?: string } | null}
 */
export function getFileInfo(e) {
    if (!e.file) return null;
    let fileName = '';
    let fileSize = 0;
    let fileId = '';
    let busid = null;
    let fileHash = null;
    let fileUrl = null;
    // 私聊文件结构：e.file.data（SnowLuma 等新版 API：file_name/file_id/file_hash/url）
    if (e.file.data) {
        fileName = e.file.data.file || e.file.data.file_name || e.file.data.filename || '';
        fileSize = parseInt(e.file.data.file_size || e.file.data.size || 0, 10);
        fileId = e.file.data.file_id || e.file.data.id || '';
        busid = e.file.data.busid;
        fileHash = e.file.data.file_hash || null;
        fileUrl = e.file.data.url || null;
    }
    // 群聊文件结构：e.file 直接包含（LLOneBot: name/id; SnowLuma: file_name/file_id）
    if (!fileName && e.file.name) {
        fileName = e.file.name;
        fileSize = parseInt(e.file.size || 0, 10);
        fileId = e.file.id || '';
        busid = e.file.busid;
        fileHash = e.file.file_hash || null;
        fileUrl = e.file.url || null;
    }
    // 兜底：新版 API 字段名（file_name / file_id）
    if (!fileName) {
        fileName = e.file.file_name || e.file.file || e.file.filename || '';
    }
    if (!fileSize) {
        fileSize = parseInt(e.file.file_size || e.file.size || 0, 10);
    }
    if (!fileId) {
        fileId = e.file.file_id || e.file.id || '';
    }
    // busid 兜底：部分适配器（如 SnowLuma）可能不提供 busid 字段，默认传 0
    if (busid == null) {
        busid = 0;
    } else {
        busid = parseInt(busid) || 0;
    }
    if (!fileName || !fileSize || !fileId) {
        logger.warn("[课表导入] 无法提取完整的文件信息", { eFile: e.file });
        return null;
    }
    return { fileName, fileSize, fileId, busid, fileHash, fileUrl };
}
/**
   * 辅助方法：从消息中获取文件文本内容（适配 TRSS 框架）
   * @returns {Promise<string|null>}
   */
export async function getFileContent(e, fileId, busid = null, fileHash = null, directUrl = null) {
    try {
        // ========== 0. 直接下载链接（SnowLuma 新版 API 在消息段中直接提供 url）==========
        if (directUrl && (directUrl.startsWith('http://') || directUrl.startsWith('https://'))) {
            try {
                const response = await fetch(directUrl);
                if (response.ok) {
                    logger.mark(`[课表管理] 直接链接下载成功`)
                    return await response.text();
                }
                logger.warn(`[课表管理] 直接链接下载失败，状态码: ${response.status}`);
            } catch (err) {
                logger.warn(`[课表管理] 直接链接下载失败，回退 API 方式: ${err}`);
            }
        }
        // ========== 1. 私聊：优先用 get_private_file_url 获取 http 地址 ==========
        if (!e.isGroup) {
            try {
                // const urlRes = await Bot.sendApi('get_private_file_url', { file_id: fileId });
                const userId = e.user_id;
                let fileUrl;
                const user = Bot.pickFriend(userId);
                if (typeof user.getFileUrl === 'function') {
                    // 如果提供了封装方法
                    fileUrl = await user.getFileUrl(fileId, fileHash);
                } else {
                    // 降级到通用 sendApi
                    const params = { user_id: userId, file_id: fileId };
                    if (fileHash) params.file_hash = fileHash;
                    const res = await Bot.sendApi('get_private_file_url', params);
                    fileUrl = res?.data?.url;
                }
                if (fileUrl && (fileUrl.startsWith('http://') || fileUrl.startsWith('https://'))) {
                    const response = await fetch(fileUrl);
                    if (response.ok) {
                        logger.mark(`[课表管理] 私聊文件HTTP下载成功`)
                        return await response.text();
                    }
                    logger.warn(`[课表管理] 私聊文件下载失败，状态码: ${response.status}`);
                }
            } catch (apiErr) {
                logger.warn(`[课表管理] 调用 get_private_file_url 失败，回退通用方式: ${apiErr}`);
            }
        }
        // ========== 2. 群聊：尝试 get_group_file_url（可能返回 file:// 或 http）==========
        if (e.isGroup) {
            let groupUrlInfo = null;
            const group = Bot.pickGroup(e.group_id);
            if (typeof group.fs.download === 'function') {
                // 如果提供了封装方法
                groupUrlInfo = await group.fs.download(fileId, busid);
            }
            else {  // 否则直接调用接口
                try {
                    groupUrlInfo = await Bot.sendApi('get_group_file_url', {
                        group_id: e.group_id,
                        file_id: fileId,
                        busid: busid
                    });
                } catch (apiErr) {
                    logger.warn(`[课表管理] 调用 get_group_file_url 失败: ${apiErr}`);
                }
            }
            // 如果带 busid 失败且 busid 可能无效，尝试 busid=0 重试
            if (!groupUrlInfo?.data?.url && busid !== 0) {
                try {
                    groupUrlInfo = await Bot.sendApi('get_group_file_url', {
                        group_id: e.group_id,
                        file_id: fileId,
                        busid: 0
                    });
                } catch (retryErr) {
                    logger.warn(`[课表管理] busid=0 重试 get_group_file_url 也失败: ${retryErr}`);
                }
            }
            if (groupUrlInfo?.data?.url) {
                const url = groupUrlInfo.data.url;
                // 如果是 http 地址，直接下载
                if (url.startsWith('http://') || url.startsWith('https://')) {
                    const response = await fetch(url);
                    if (response.ok) {
                        logger.mark(`[课表管理] 群文件HTTP下载成功`)
                        return await response.text();
                    }
                    logger.warn(`[课表管理] 群文件HTTP下载失败，状态码: ${response.status}`);
                }
                // 如果是 file:// 地址，尝试本地读取（Docker 中大概率失败）
                if (url.startsWith('file://')) {
                    let filePath = url.replace('file://', '');
                    try { filePath = decodeURIComponent(filePath); } catch { }
                    if (fs.existsSync(filePath)) {
                        // 注意：容器内路径很少能用，但保留以兼容非容器环境
                        const content = fs.readFileSync(filePath, 'utf-8');
                        logger.mark(`[课表管理] 群文件本地读取成功: ${filePath}`);
                        setTimeout(() => fs.promises.unlink(filePath).catch(() => { }), 2000);
                        return content;
                    }
                    logger.warn("[课表管理] file:// 路径不存在 (可能是容器隔离)，尝试其他方式...");
                }
            }
        }
        // ========== 3. 通用方式：调用 get_file 并优先处理 base64 ==========
        let fileInfo = null;
        try {
            // 统一使用 get_file
            if (!e.isGroup) {
                // 私聊 get_file 可能会返回 base64:// 数据
                fileInfo = await Bot.sendApi('get_file', { file_id: fileId });
            } else {
                // SnowLuma 等适配器：get_file API 不需要 busid，可作为备选
                try {
                    fileInfo = await Bot.sendApi('get_file', { group_id: e.group_id, file_id: fileId });
                } catch (err) {
                    logger.warn(`[mil-plugin] 群聊 get_file API 失败: ${err}`);
                }
                // 如果 get_file 也没数据，回退到之前的 groupUrlInfo
                if (!fileInfo?.data && groupUrlInfo?.data) {
                    fileInfo = groupUrlInfo;
                }
            }
        } catch (err) {
            logger.error("[课表管理] 获取 fileInfo 异常:", err);
        }

        if (fileInfo?.data) {
            const data = fileInfo.data;
            // 优先 base64
            if (data.file && typeof data.file === 'string' && data.file.startsWith('base64://')) {
                const base64 = data.file.replace('base64://', '');
                return Buffer.from(base64, 'base64').toString('utf-8');
            }
            // 如果 data.url 是有效的 http 地址（可能在 get_file 中也返回 url）
            // 如果需要请在NapCat的连接设置打开本地文件转URL
            if (data.url && (data.url.startsWith('http://') || data.url.startsWith('https://'))) {
                const response = await fetch(data.url);
                if (response.ok) return await response.text();
            }
            // 本地路径兜底（仅在非严格隔离的环境有效）
            const localPath = data.file || data.path;
            if (localPath && typeof localPath === 'string' && fs.existsSync(localPath)) {
                const content = fs.readFileSync(localPath, 'utf-8');
                logger.mark(`[课表管理] 本地读取成功: ${localPath}`);
                setTimeout(() => fs.promises.unlink(localPath).catch(() => { }), 2000);
                return content;
            }
        }
        // ========== 4. 如果配置了 NapCat HTTP 文件服务，拼接 URL ==========
        // 需要用户在 napcat 配置中设置 http.enableFile = true，这里优先读取配置->环境变量->默认值
        const config = ConfigManager.getConfig();
        const fileBaseUrl = config.napcatURL || process.env.NAPCAT_FILE_BASE_URL || "http://napcat:6099"; // 例如 "http://napcat:6099"
        if (fileBaseUrl && fileId) {
            try {
                const url = `${fileBaseUrl}/file?file_id=${encodeURIComponent(fileId)}`;
                const response = await fetch(url);
                if (response.ok) return await response.text();
            } catch (e) {
                logger.warn("[课表管理] 通过 NapCat HTTP 文件服务下载失败:", e);
            }
        }
        logger.error("[课表管理] 无法获取文件内容（已尝试所有方式）");
        return null;
    } catch (err) {
        logger.error(`[课表管理] 获取文件内容失败: ${err}`);
        return null;
    }
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
export function getBotName(e = null) {
    let bot;
    if (e) {
        bot = e.bot || Bot;
    }
    else {
        bot = Bot;
    }
    const config = ConfigManager.getConfig();
    return config.botName || bot.nickname || "Bot";
}
/**
 * 获取成员昵称
 * @param {number} qq QQ号
 */
export async function getMemberName(qq) {
    const info = await Bot.pickFriend(qq).getInfo();
    return info.nickname;
}
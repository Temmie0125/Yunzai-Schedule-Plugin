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

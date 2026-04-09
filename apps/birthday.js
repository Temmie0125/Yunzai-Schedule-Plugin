// plugins/schedule/apps/birthday.js
import schedule from 'node-schedule'
import fs from 'node:fs'
import path from 'path'
import { segment } from 'oicq'
import { ConfigManager } from '../components/ConfigManager.js'
import { DataManager } from '../components/DataManager.js'
import { renderBirthdayList } from '../components/Renderer.js'
import { makeForwardMsg, checkPermission } from '../components/common.js'
import { getCurrentDate, formatAndValidateBirthday, getDaysToBirthday} from '../utils/timeUtils.js';
// const BIRTHDAY_DATA_PATH = path.join(process.cwd(), 'plugins/schedule/data/birthday.json')
// 全局键名，避免与其他插件冲突
const GLOBAL_BIRTHDAY_JOB = '__birthdayPushJob'
const GLOBAL_BIRTHDAY_CRON = '__birthdayPushCron'
// 生日祝福语模板
const birthdayMessages = [
    "生日快乐，天天开心！",
    "愿所有的美好都如期而至～",
    "大家一起祝TA生日快乐吧！",
    "新的一岁要继续闪闪发光哦！",
    "愿每一天都充满阳光和欢笑～",
    "祝心想事成，万事如意！",
    "送上最真挚的祝福！",
    "愿未来更加精彩！"
]

function getRandomBirthdayMessage() {
    const index = Math.floor(Math.random() * birthdayMessages.length)
    return birthdayMessages[index]
}

export class BirthdayReminder extends plugin {
    constructor() {
        super({
            name: "生日提醒",
            dsc: "生日提醒与祝福",
            event: "message",
            priority: 5000,
            rule: [
                // 普通用户命令
                { reg: "^#设置生日\\s+(\\d{1,2}[-/.]\\d{1,2})$", fnc: "setMyBirthday" },
                { reg: "^#清除(我的)?生日$", fnc: "clearMyBirthday" },
                { reg: "^#我的生日$", fnc: "myBirthday" },
                { reg: "^#生日(设置|修改)昵称\\s+(.+)$", fnc: "modifyNickname" },
                { reg: "^#(全部)?生日(完整)?列表$", fnc: "listBirthdays" },
                // { reg: "^#(生日完整列表|全部生日列表)$", fnc: "listAllBirthdays" },
                { reg: "^#生日帮助$", fnc: "birthdayHelp" },
                // 生日模块帮助已经整合进课表帮助，此处显示文本帮助
                // 管理员命令
                { reg: /^#添加生日\s+(\d+)\s+(\d{1,2}[-/.]\d{1,2})$/, fnc: "addBirthday" },
                { reg: /^#添加生日\s*(\d{1,2}[-/.]\d{1,2})$/, fnc: "addBirthday" },
                { reg: /^#移除生日\s*(\d+)?$/, fnc: "removeBirthday" },
                { reg: /^#修改生日\s+(\d+)\s+(\d{1,2}[-/.]\d{1,2})$/, fnc: "modifyBirthday" },
                { reg: /^#修改生日\s*(\d{1,2}[-/.]\d{1,2})$/, fnc: "modifyBirthday" },
                // 主人命令
                { reg: "^#检查生日$", fnc: "manualCheckBirthday", permission: "master" },
                { reg: "^#生日白名单(列表)?$", fnc: "whitelistList", permission: "master" },
                { reg: "^#生日白名单添加\\s+(\\d+)$", fnc: "whitelistAdd", permission: "master" },
                { reg: "^#生日白名单删除\\s+(\\d+)$", fnc: "whitelistRemove", permission: "master" },
                { reg: "^#生日黑名单(列表)?$", fnc: "blacklistList", permission: "master" },
                { reg: "^#生日黑名单添加\\s+(\\d+)$", fnc: "blacklistAdd", permission: "master" },
                { reg: "^#生日黑名单删除\\s+(\\d+)$", fnc: "blacklistRemove", permission: "master" },
                { reg: "^#生日黑白名单清空$", fnc: "clearAllLists", permission: "master" }
            ],
        })
        // 加载生日数据
        this.birthdayData = DataManager.loadBirthdayData()
        // 初始化定时推送任务
        this.pushJob = null
        this.initPushTask()
        // 监听配置变化事件（与课表插件共用事件总线）
        this.handleConfigChange = this.handleConfigChange.bind(this)
        if (global.scheduleEvents) {
            global.scheduleEvents.on(this.handleConfigChange)
        }
    }
    // 初始化定时任务
    initPushTask() {
        const config = ConfigManager.getConfig()
        const pushCron = config.birthdayPushCron
        if (!pushCron) {
            // 无配置时清理全局任务
            if (global[GLOBAL_BIRTHDAY_JOB]) {
                global[GLOBAL_BIRTHDAY_JOB].cancel()
                global[GLOBAL_BIRTHDAY_JOB] = null
                global[GLOBAL_BIRTHDAY_CRON] = null
            }
            logger.warn('[Schedule生日提醒] 未配置cron表达式，跳过')
            return
        }
        // 如果全局任务已存在且 cron 相同，则跳过
        if (global[GLOBAL_BIRTHDAY_JOB] && global[GLOBAL_BIRTHDAY_CRON] === pushCron) {
            // logger.mark("[Schedule生日提醒] 定时任务已存在且未更改cron, 跳过重载")
            return
        }
        // 取消已有的全局任务
        if (global[GLOBAL_BIRTHDAY_JOB]) {
            global[GLOBAL_BIRTHDAY_JOB].cancel()
            global[GLOBAL_BIRTHDAY_JOB] = null
        }
        try {
            const job = schedule.scheduleJob(pushCron, () => {
                this.checkBirthdays()
            })
            global[GLOBAL_BIRTHDAY_JOB] = job
            global[GLOBAL_BIRTHDAY_CRON] = pushCron
            logger.info(`[Schedule生日提醒] 已启用生日推送，cron: ${pushCron}`)
        } catch (err) {
            logger.error(`[Schedule生日提醒] 调度失败: ${err}`)
        }
    }
    handleConfigChange() {
        // logger.info('[Schedule生日提醒] 检测到配置变化，重载定时任务')
        this.initPushTask()
    }
    // 插件卸载时清理
    async disconnect() {
        // 清理全局任务
        if (global[GLOBAL_BIRTHDAY_JOB]) {
            global[GLOBAL_BIRTHDAY_JOB].cancel()
            global[GLOBAL_BIRTHDAY_JOB] = null
            global[GLOBAL_BIRTHDAY_CRON] = null
        }
        if (global.scheduleEvents) {
            global.scheduleEvents.off(this.handleConfigChange)
        }
    }
    // ========== 业务方法 ==========
    /** 手动检查生日 */
    async manualCheckBirthday(e) {
        await this.checkBirthdays()
        await e.reply('已手动执行生日检查')
    }
    /** 检查生日并发送祝福 */
    async checkBirthdays() {
        const today = getCurrentDate()
        logger.mark(`[Schedule生日提醒] 检查生日，今天是: ${today}`)
        const todayBirthdayUsers = []
        for (const [userId, data] of Object.entries(this.birthdayData)) {
            if (data.birthday === today) {
                todayBirthdayUsers.push({ userId, name: data.name })
            }
        }
        if (todayBirthdayUsers.length === 0) {
            logger.mark('[Schedule生日提醒] 今天没有人过生日')
            return
        }
        // 群聊推送
        // 获取群聊配置
        const config = ConfigManager.getConfig();
        const whitelist = config.birthdayWhitelistGroups || [];
        const blacklist = config.birthdayBlacklistGroups || [];
        let groupIds = Bot.getGroupList()
        // 根据黑白名单过滤群
        groupIds = groupIds.filter(gid => {
            const gidNum = Number(gid);
            // 白名单优先：如果白名单非空，只保留在白名单内的群
            if (whitelist.length > 0) {
                return whitelist.some(w => Number(w) === gidNum);
            }
            // 白名单为空时，排除黑名单内的群
            return !blacklist.some(b => Number(b) === gidNum);
        });
        if (groupIds && groupIds.length) {
            for (const groupId of groupIds) {
                if (String(groupId) === 'stdin') continue
                const group = Bot.pickGroup(groupId)
                if (!group) continue
                const memberMap = await group.getMemberMap()
                const memberQQs = [...memberMap.keys()]
                const birthdaysInGroup = todayBirthdayUsers.filter(user =>
                    memberQQs.includes(Number(user.userId))
                )
                if (birthdaysInGroup.length) {
                    let message = []
                    if (group.is_admin || group.is_owner) {
                        message.push(segment.at('all'), '  ')
                    }
                    message.push('今天是')
                    birthdaysInGroup.forEach(b => message.push(segment.at(b.userId), ' '))
                    message.push(`的生日，${getRandomBirthdayMessage()}`)
                    await group.sendMsg(message)
                    logger.mark(`[Schedule生日提醒] 已在群 ${groupId} 发送生日祝福`)
                    await this.sleep(2000)
                }
            }
        }
        // 好友私聊推送
        for (const user of todayBirthdayUsers) {
            if (Bot.fl && Bot.fl.has(Number(user.userId))) {
                const friend = Bot.pickFriend(user.userId)
                const message = `亲爱的 ${user.name}，祝你生日快乐！🎂🎉\n${getRandomBirthdayMessage()}`
                await friend.sendMsg(message)
                logger.mark(`[Schedule生日提醒] 已向好友 ${user.userId} 发送私聊祝福`)
                await this.sleep(1000)
            }
        }
    }

    /** 添加生日（管理员） */
    async addBirthday(e) {
        if (!checkPermission(e)) {
            e.reply('只有管理员或群主才能添加生日')
            return true
        }
        const message = e.msg.trim()
        let targetUserId = e.at
        let birthday
        // 格式1: #添加生日 @某人 生日
        const atMatch = message.match(/^#添加生日\s*(\d{1,2}[-/.]\d{1,2})$/)
        if (atMatch && e.at) {
            birthday = atMatch[1]
        } else {
            // 格式2: #添加生日 QQ号 生日
            const qqMatch = message.match(/^#添加生日\s+(\d+)\s+(\d{1,2}[-/.]\d{1,2})$/)
            if (!qqMatch) {
                e.reply('格式错误！正确格式：#添加生日 @某人 月-日 或 #添加生日 QQ号 月-日')
                return true
            }
            targetUserId = qqMatch[1]
            birthday = qqMatch[2]
        }
        const validation = formatAndValidateBirthday(birthday)
        if (!validation.valid) {
            e.reply('生日格式错误！请使用 月-日 格式，例如：1-1 或 01-01')
            return true
        }
        birthday = validation.formatted
        if (!e.group_id) {
            e.reply('请在群聊中使用此命令')
            return true
        }
        // 检查目标是否在群内
        const memberMap = await Bot.pickGroup(e.group_id).getMemberMap()
        if (!memberMap.has(Number(targetUserId))) {
            e.reply(`本群不存在用户 ${targetUserId}`)
            return true
        }
        const userName = memberMap.get(Number(targetUserId)).nickname
        // 存储
        this.birthdayData[targetUserId] = {
            name: userName,
            birthday: birthday,
            addedBy: e.user_id,
            addedAt: new Date().toISOString(),
            nicknameModified: false,
            isSelfSet: false
        }
        if (DataManager.saveBirthdayData(this.birthdayData)) {
            e.reply(`✅ 已成功为${userName}(${targetUserId})添加生日：${birthday}`)
        } else {
            e.reply('❌ 保存生日数据失败，请检查日志')
        }
        return true
    }

    /** 移除生日（管理员） */
    async removeBirthday(e) {
        if (!checkPermission(e)) {
            e.reply('只有管理员或群主才能移除生日')
            return true
        }
        const message = e.msg.trim()
        let targetUserId = e.at
        if (!targetUserId) {
            const match = message.match(/^#移除生日\s*(\d+)?$/)
            targetUserId = match?.[1] || message.replace(/[#移除生日\s]/g, '')
        }
        if (!targetUserId || !/^\d+$/.test(targetUserId)) {
            e.reply('请@要移除生日的人，或输入正确的QQ号！')
            return true
        }
        if (this.birthdayData[targetUserId]) {
            delete this.birthdayData[targetUserId]
            DataManager.saveBirthdayData(this.birthdayData)
            e.reply(`✅ 已成功移除用户${targetUserId}的生日记录`)
        } else {
            e.reply('❌ 未找到该用户的生日记录')
        }
        return true
    }
    /** 查看本群生日 */
    async listBirthdays(e) {
        if (!e.group_id) {
            e.reply('请在群聊中使用此命令')
            return true
        }
        const memberMap = await Bot.pickGroup(e.group_id).getMemberMap()
        const memberQQs = [...memberMap.keys()]
        const groupBirthdays = {}
        for (const qq of memberQQs) {
            if (this.birthdayData[qq]) groupBirthdays[qq] = this.birthdayData[qq]
        }
        if (Object.keys(groupBirthdays).length === 0) {
            return e.reply('本群还没有任何生日记录～')
        }
        const birthdaysWithDays = []
        for (const [userId, data] of Object.entries(groupBirthdays)) {
            const days = getDaysToBirthday(data.birthday)
            birthdaysWithDays.push({
                userId, name: data.name, birthday: data.birthday, days
            })
        }
        // 排序并处理是否为完整
        birthdaysWithDays.sort((a, b) => a.days - b.days)
        let finaldata;
        let r10 = false;
        if (e.msg.includes("完整") || e.msg.includes("全部")) {
            finaldata = birthdaysWithDays;
        }
        else {
            finaldata = birthdaysWithDays.slice(0, 10);
            r10 = true;
        }
        const total = Object.keys(groupBirthdays).length
        const todayCount = birthdaysWithDays.filter(b => b.days === 0).length
        const upcomingCount = birthdaysWithDays.filter(b => b.days > 0 && b.days <= 30).length
        const templateData = {
            isRecent10: r10,
            currentTime: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
            totalCount: total,
            todayCount,
            upcomingCount,
            birthdays: finaldata.map(item => ({
                name: item.name,
                qq: item.userId,
                birthday: item.birthday,
                days: item.days,
                avatar: `https://q1.qlogo.cn/g?b=qq&s=0&nk=${item.userId}`
            }))
        }
        await e.reply("正在生成生日列表图片，请稍候...", false, { recallMsg: 5 })
        const img = await renderBirthdayList(templateData, { e })
        if (img) {
            await e.reply(segment.image(img))
        } else {
            e.reply("生成图片失败，请检查日志")
        }
        return true
    }
    /** 我的生日 */
    async myBirthday(e) {
        const userId = e.user_id
        const data = this.birthdayData[userId]
        if (!data) {
            return e.reply('你还没有设置生日~使用[#设置生日 月份-日期]来进行设置~')
        }
        const daysLeft = getDaysToBirthday(data.birthday)
        let msg = `🎂 ${data.name}的生日信息 🎂\n生日: ${data.birthday}\n`
        if (daysLeft === 0) msg += '🎉 今天是你的生日！生日快乐！🎂'
        else if (daysLeft === 1) msg += '🎈 明天就是你的生日啦！'
        else msg += `距离你的生日还有 ${daysLeft} 天`
        msg += '\n\n使用 #生日修改昵称 新昵称 可以修改生日显示的昵称'
        e.reply(msg)
        return true
    }

    /** 设置我的生日 */
    async setMyBirthday(e) {
        const config = ConfigManager.getConfig()
        const allowSelfModify = config.allowSelfModify
        const message = e.msg.trim()
        const match = message.match(/^#设置生日\s+(\d{1,2}[-/.]\d{1,2})$/)
        if (!match) {
            e.reply('格式错误！正确格式：#设置生日 月-日')
            return true
        }
        let birthday = match[1]
        const validation = formatAndValidateBirthday(birthday)
        if (!validation.valid) {
            e.reply('生日格式错误！请使用 月-日 格式，例如：1-1 或 01-01')
            return true
        }
        birthday = validation.formatted
        const userId = e.user_id
        const userName = e.sender?.card || e.sender?.nickname || `用户${userId}`
        // 是否是首次设置
        let isFirstSet = false;
        if (this.birthdayData[userId]) {
            if (!allowSelfModify && !e.isMaster) {
                return e.reply('这里被管理员禁止修改生日了呢QAQ，如需修改请联系管理员')
            }
            isFirstSet = true
            // 允许修改
        }
        this.birthdayData[userId] = {
            name: userName,
            birthday: birthday,
            addedBy: userId,
            addedAt: new Date().toISOString(),
            isSelfSet: true,
            nicknameModified: false
        }
        DataManager.saveBirthdayData(this.birthdayData)
        let replymsg = [`✅ 已${isFirstSet ? '修改' : '设置'}你的生日：${birthday}`]
        if (Bot.fl && !Bot.fl.has(Number(e.user_id))) {
            replymsg.push(`\n您还未添加好友哦，添加后还可以在生日当天收到私信祝福~`)
        }
        e.reply(replymsg)
        return true
    }
    /** 用户清除自己的生日 */
    async clearMyBirthday(e) {
        const userId = e.user_id;
        const config = ConfigManager.getConfig();
        const allowSelfModify = config.allowSelfModify
        if (!this.birthdayData[userId]) {
            return e.reply("你还没有设置生日，无需清除。");
        }
        // 检查是否允许自行清除（可复用 allowSelfModify 或独立配置）
        if (!allowSelfModify && !e.isMaster) {
            return e.reply("这里被管理员禁止自行清除生日信息了呐QAQ，请联系管理员操作。");
        }
        delete this.birthdayData[userId];
        if (DataManager.saveBirthdayData(this.birthdayData)) {
            e.reply("✅ 已成功清除你的生日信息。");
        } else {
            e.reply("❌ 清除生日信息失败，请检查日志。");
        }
        return true;
    }
    /** 修改生日昵称 */
    async modifyNickname(e) {
        const message = e.msg.trim()
        const match = message.match(/^#生日(设置|修改)昵称\s+(.+)$/)
        if (!match) {
            e.reply('格式错误！正确格式：#生日(设置|修改)昵称 新昵称')
            return true
        }
        const newNickname = match[1].trim()
        const userId = e.user_id
        if (!this.birthdayData[userId]) {
            e.reply('❌ 你还没有设置生日，无法修改昵称\n请先使用 #设置生日 月-日 设置生日')
            return true
        }
        this.birthdayData[userId].name = newNickname
        this.birthdayData[userId].nicknameModified = true
        DataManager.saveBirthdayData(this.birthdayData)
        e.reply('✅ 昵称修改成功')
        return true
    }
    /** 管理员修改生日 */
    async modifyBirthday(e) {
        if (!checkPermission(e)) {
            e.reply('只有管理员或群主才能修改生日')
            return true
        }
        const message = e.msg.trim()
        let targetUserId = e.at
        let birthday
        const atMatch = message.match(/^#修改生日\s*(\d{1,2}[-/.]\d{1,2})$/)
        if (atMatch && e.at) {
            birthday = atMatch[1]
        } else {
            const qqMatch = message.match(/^#修改生日\s+(\d+)\s+(\d{1,2}[-/.]\d{1,2})$/)
            if (!qqMatch) {
                e.reply('格式错误！正确格式：#修改生日 @某人 月-日 或 #修改生日 QQ号 月-日')
                return true
            }
            targetUserId = qqMatch[1]
            birthday = qqMatch[2]
        }
        const validation = formatAndValidateBirthday(birthday)
        if (!validation.valid) {
            e.reply('生日格式错误！请使用 月-日 格式，例如：1-1 或 01-01')
            return true
        }
        birthday = validation.formatted
        if (!e.group_id) {
            e.reply('请在群聊中使用此命令')
            return true
        }
        const memberMap = await Bot.pickGroup(e.group_id).getMemberMap()
        if (!memberMap.has(Number(targetUserId))) {
            e.reply(`本群不存在用户 ${targetUserId}`)
            return true
        }
        const userName = memberMap.get(Number(targetUserId)).nickname
        if (!this.birthdayData[targetUserId]) {
            e.reply(`❌ ${userName}(${targetUserId}) 还没有设置生日，请使用 #添加生日 命令添加`)
            return true
        }
        const oldBirthday = this.birthdayData[targetUserId].birthday
        const oldName = this.birthdayData[targetUserId].name
        this.birthdayData[targetUserId] = {
            name: oldName,
            birthday: birthday,
            addedBy: this.birthdayData[targetUserId].addedBy,
            addedAt: this.birthdayData[targetUserId].addedAt,
            modifiedBy: e.user_id,
            modifiedAt: new Date().toISOString(),
            oldBirthday: oldBirthday,
            isModified: true,
            isSelfSet: this.birthdayData[targetUserId].isSelfSet || false,
            nicknameModified: this.birthdayData[targetUserId].nicknameModified || false
        }
        if (DataManager.saveBirthdayData(this.birthdayData)) {
            const daysLeft = getDaysToBirthday(birthday)
            let replyMsg = `✅ 已成功修改${oldName}(${targetUserId})的生日：\n原生日：${oldBirthday} → 新生日：${birthday}\n`
            if (daysLeft === 0) replyMsg += '🎉 今天就是TA的生日！生日快乐！'
            else replyMsg += `距离TA的生日还有 ${daysLeft} 天`
            e.reply(replyMsg)
            if (targetUserId !== e.user_id) {
                try {
                    await Bot.pickFriend(targetUserId).sendMsg(`管理员已修改你的生日：${oldBirthday} → ${birthday}`)
                } catch (err) { logger.error(`[Schedule生日提醒] 通知用户失败: ${err}`) }
            }
        } else {
            e.reply('❌ 保存生日数据失败，请检查日志')
        }
        return true
    }

    /** 帮助 */
    async birthdayHelp(e) {
        const msg = [
            `[Schedule生日模块]\n`,
            `========\n`,
            `[#设置生日 日期] 设置自己的生日\n`,
            `[#生日列表] 查看本群即将到来的10个生日\n`,
            `[#生日完整列表] 查看本群所有生日\n`,
            `[#我的生日] 查看自己的生日信息\n`,
            `[#生日修改昵称 昵称] 修改生日提醒的昵称\n`            
        ]
        // 判断是否是管理员
        if (e.isGroup && checkPermission(e)){
            msg.push(
                `==以下为管理员命令==\n`,
                `[#修改生日 QQ号 日期] 修改某人的生日\n`,
                `[#添加生日 QQ号 日期] 添加某人的生日\n`,
                `[#移除生日 QQ号 日期] 移除某人的生日\n`
            )
        }
        // 主人命令仅私聊展示，防止刷屏
        if (e.isMaster && !e.isGroup) {
            msg.push(
                `==主人命令==\n`,
                `[#生日白名单列表] 查看白名单群\n`,
                `[#生日白名单添加 群号] 添加群到白名单\n`,
                `[#生日白名单删除 群号] 从白名单移除\n`,
                `[#生日黑名单列表] 查看黑名单群\n`,
                `[#生日黑名单添加 群号] 添加群到黑名单\n`,
                `[#生日黑名单删除 群号] 从黑名单移除\n`,
                `[#生日黑白名单清空] 清空所有黑白名单\n`
            );
        }
        msg.push(`========\n日期格式示例：1-14`)
        e.reply(msg)
        return true
    }
    // 辅助方法：获取群名称
    async getGroupName(groupId) {
        try {
            const group = Bot.pickGroup(groupId);
            if (group && group.group_name) return group.group_name;
        } catch (e) { }
        return String(groupId);
    }

    // 白名单列表
    async whitelistList(e) {
        const config = ConfigManager.getConfig();
        const whitelist = config.birthdayWhitelistGroups || [];
        if (whitelist.length === 0) {
            return e.reply("当前生日白名单为空，所有群（黑名单除外）都会收到推送。");
        }
        // 构建消息列表
        const msgList = ["📋 生日白名单群列表："];
        for (const gid of whitelist) {
            const name = await this.getGroupName(gid);
            msgList.push(`${name} (${gid})`);
        }
        msgList.push(`\n共 ${whitelist.length} 个群。`);
        // 使用合并转发发送
        const forwardMsg = await makeForwardMsg(e, msgList, "生日白名单");
        await e.reply(forwardMsg);
        return true;
    }

    // 白名单添加
    async whitelistAdd(e) {
        const match = e.msg.match(/^#生日白名单添加\s+(\d+)$/);
        if (!match) return e.reply("格式错误：请使用 #生日白名单添加 群号");
        const groupId = match[1];
        // 检查机器人是否在该群
        const groupList = Bot.getGroupList();
        if (!groupList.map(g => String(g)).includes(groupId)) {
            return e.reply(`❌ 机器人不在群 ${groupId} 中，无法添加。`);
        }
        const config = ConfigManager.getConfig();
        let whitelist = config.birthdayWhitelistGroups || [];
        if (whitelist.includes(groupId)) {
            return e.reply(`群 ${groupId} 已在白名单中。`);
        }
        whitelist.push(groupId);
        // 保存配置
        ConfigManager.setConfig({ ...config, birthdayWhitelistGroups: whitelist });
        const groupName = await this.getGroupName(groupId);
        return e.reply(`✅ 已将 ${groupName} (${groupId}) 添加到生日白名单。\n现在只有白名单内的群会收到生日推送。`);
    }

    // 白名单删除
    async whitelistRemove(e) {
        const match = e.msg.match(/^#生日白名单删除\s+(\d+)$/);
        if (!match) return e.reply("格式错误：请使用 #生日白名单删除 群号");
        const groupId = match[1];
        const config = ConfigManager.getConfig();
        let whitelist = config.birthdayWhitelistGroups || [];
        if (!whitelist.includes(groupId)) {
            return e.reply(`群 ${groupId} 不在白名单中。`);
        }
        whitelist = whitelist.filter(g => g !== groupId);
        ConfigManager.setConfig({ ...config, birthdayWhitelistGroups: whitelist });
        const groupName = await this.getGroupName(groupId);
        return e.reply(`✅ 已将 ${groupName} (${groupId}) 移出白名单。`);
    }

    // 黑名单列表
    async blacklistList(e) {
        const config = ConfigManager.getConfig();
        const blacklist = config.birthdayBlacklistGroups || [];
        if (blacklist.length === 0) {
            return e.reply("当前生日黑名单为空，所有群（受白名单约束）都会收到推送。");
        }
        const msgList = ["🚫 生日黑名单群列表："];
        for (const gid of blacklist) {
            const name = await this.getGroupName(gid);
            msgList.push(`${name} (${gid})`);
        }
        msgList.push(`共 ${blacklist.length} 个群。`);
        const forwardMsg = await makeForwardMsg(e, msgList, "生日黑名单");
        await e.reply(forwardMsg);
        return true;
    }

    // 黑名单添加
    async blacklistAdd(e) {
        const match = e.msg.match(/^#生日黑名单添加\s+(\d+)$/);
        if (!match) return e.reply("格式错误：请使用 #生日黑名单添加 群号");
        const groupId = match[1];
        const config = ConfigManager.getConfig();
        let blacklist = config.birthdayBlacklistGroups || [];
        if (blacklist.includes(groupId)) {
            return e.reply(`群 ${groupId} 已在黑名单中。`);
        }
        blacklist.push(groupId);
        ConfigManager.setConfig({ ...config, birthdayBlacklistGroups: blacklist });
        const groupName = await this.getGroupName(groupId);
        return e.reply(`✅ 已将 ${groupName} (${groupId}) 添加到黑名单。\n黑名单中的群不会收到生日推送。`);
    }

    // 黑名单删除
    async blacklistRemove(e) {
        const match = e.msg.match(/^#生日黑名单删除\s+(\d+)$/);
        if (!match) return e.reply("格式错误：请使用 #生日黑名单删除 群号");
        const groupId = match[1];
        const config = ConfigManager.getConfig();
        let blacklist = config.birthdayBlacklistGroups || [];
        if (!blacklist.includes(groupId)) {
            return e.reply(`群 ${groupId} 不在黑名单中。`);
        }
        blacklist = blacklist.filter(g => g !== groupId);
        ConfigManager.setConfig({ ...config, birthdayBlacklistGroups: blacklist });
        const groupName = await this.getGroupName(groupId);
        return e.reply(`✅ 已将 ${groupName} (${groupId}) 移出黑名单。`);
    }

    // 清空所有黑白名单
    async clearAllLists(e) {
        const config = ConfigManager.getConfig();
        ConfigManager.setConfig({
            ...config,
            birthdayWhitelistGroups: [],
            birthdayBlacklistGroups: []
        });
        return e.reply("✅ 已清空生日推送的白名单和黑名单，现在所有群都会收到推送。");
    }
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms))
    }
}
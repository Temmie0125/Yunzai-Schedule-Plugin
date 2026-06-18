// plugins/schedule/apps/birthday.js
import schedule from 'node-schedule'
import { segment } from 'oicq'
import { ConfigManager } from '../components/ConfigManager.js'
import { DataManager } from '../components/DataManager.js'
import { renderBirthdayList } from '../components/Renderer.js'
import { makeForwardMsg, checkPermission, getBotName, checkFriend, getMemberName } from '../components/common.js'
import { getCurrentDate, getDaysToBirthday, parseBirthdayString, isTodayCelebration, parseLunarBirthdayString, lunarToUpcomingSolarDate, refreshLunarBirthdays, getLunarMonthName, getLunarDayName } from '../utils/timeUtils.js';
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
            name: "[Schedule] 生日提醒",
            dsc: "生日提醒与祝福",
            event: "message",
            priority: 5000,
            rule: [
                // 普通用户命令
                { reg: "^#设置生日\\s+(.+)$", fnc: "setMyBirthday" },
                { reg: "^#清除(我的)?生日$", fnc: "clearMyBirthday" },
                { reg: "^#我的生日$", fnc: "myBirthday" },
                { reg: "^#生日(设置|修改)昵称\\s+(.+)$", fnc: "modifyNickname" },
                { reg: "^#(全部)?生日(完整)?列表$", fnc: "listBirthdays" },
                { reg: "^#生日帮助$", fnc: "birthdayHelp" },
                // 管理员命令
                { reg: /^#添加生日\s+(\d+)\s+(.+)$/, fnc: "addBirthday" },      // QQ+生日
                { reg: /^#添加生日\s*(.+)$/, fnc: "addBirthday" },              // 可能带@的格式
                { reg: /^#移除生日\s*(\d+)?$/, fnc: "removeBirthday" },
                { reg: /^#修改生日\s+(\d+)\s+(.+)$/, fnc: "modifyBirthday" },
                { reg: /^#修改生日\s*(.+)$/, fnc: "modifyBirthday" },
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
        // 同步昵称（当自定义昵称关闭时，用QQ昵称覆盖存储名）
        this._syncBirthdayNames().catch(err =>
            logger.error('[Schedule生日提醒] 同步昵称失败:', err)
        )
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
        this._syncBirthdayNames().catch(err =>
            logger.error('[Schedule生日提醒] 配置变更同步昵称失败:', err)
        )
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
        // 刷新过期的农历生日（年份变更后重新计算公历日期）
        if (refreshLunarBirthdays(this.birthdayData)) {
            DataManager.saveBirthdayData(this.birthdayData);
        }
        const today = getCurrentDate()
        logger.mark(`[Schedule生日提醒] 检查生日，今天是: ${today}`)
        const todayBirthdayUsers = []
        for (const [userId, data] of Object.entries(this.birthdayData)) {
            // 使用新的适配函数判断今天是否是该用户的实际庆祝日
            if (isTodayCelebration(data.birthday)) {
                todayBirthdayUsers.push({ userId, name: await this._getDisplayName(userId, data.name) })
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
            return e.reply('只有管理员或群主才能添加生日');
        }
        if (!e.group_id) return e.reply('请在群聊中使用此命令');
        const { targetUserId, birthday, birthdayType, lunarMonth, lunarDay, birthdayYear, errorMsg } = this._parseAdminBirthdayCommand(e);
        if (errorMsg) return e.reply(errorMsg);
        // 检查用户是否在群内
        const { exists, nickname, errorMsg: userError } = await this._checkUserInGroup(e.group_id, targetUserId);
        if (!exists) return e.reply(userError);
        // 如果已存在记录，直接覆盖
        const entry = {
            name: nickname,
            birthday: birthday,
            birthdayType: birthdayType || 'solar',
            addedBy: e.user_id,
            addedAt: new Date().toISOString(),
            nicknameModified: false,
            isSelfSet: false
        };
        if (birthdayType === 'lunar') {
            entry.lunarMonth = lunarMonth;
            entry.lunarDay = lunarDay;
            entry.birthdayYear = birthdayYear;
        }
        this.birthdayData[targetUserId] = entry;
        let displayBirthday = birthday;
        if (birthdayType === 'lunar') {
            displayBirthday = `${birthday}（农历${getLunarMonthName(lunarMonth)}${getLunarDayName(lunarDay)}）`;
        }
        this._saveBirthdayDataAndReply(e, this.birthdayData, `已成功为${nickname}(${targetUserId})添加生日：${displayBirthday}`);
        return true;
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
        // 先刷新过期的农历生日
        if (refreshLunarBirthdays(this.birthdayData)) {
            DataManager.saveBirthdayData(this.birthdayData);
        }
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
            // 构建生日显示文本（农历则附加农历信息）
            let birthdayDisplay = data.birthday;
            if (data.birthdayType === 'lunar' && data.lunarMonth && data.lunarDay) {
                birthdayDisplay = `${data.birthday}（农历${getLunarMonthName(data.lunarMonth)}${getLunarDayName(data.lunarDay)}）`;
            }
            birthdaysWithDays.push({
                userId, name: data.name, birthday: birthdayDisplay, days,
                birthdayType: data.birthdayType || 'solar'
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
        const config = ConfigManager.getConfig();
        const showQQ = config.showQQ ?? true;
        const templateData = {
            isRecent10: r10,
            currentTime: getCurrentDate(),
            totalCount: total,
            todayCount,
            upcomingCount,
            birthdays: await Promise.all(finaldata.map(async item => ({
                name: await this._getDisplayName(item.userId, item.name),
                qq: showQQ ? item.userId : null,
                birthday: item.birthday,
                days: item.days,
                birthdayType: item.birthdayType,
                avatar: `https://q1.qlogo.cn/g?b=qq&s=0&nk=${item.userId}`
            })))
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
        // 先刷新过期的农历生日
        if (refreshLunarBirthdays(this.birthdayData)) {
            DataManager.saveBirthdayData(this.birthdayData);
        }
        const userId = e.user_id
        const data = this.birthdayData[userId]
        if (!data) {
            return e.reply('你还没有设置生日~使用[#设置生日 月份-日期]来进行设置~\n支持农历：#设置生日 农历三月十五')
        }
        const daysLeft = getDaysToBirthday(data.birthday)
        const displayName = await this._getDisplayName(userId, data.name)
        let birthdayDisplay = data.birthday;
        if (data.birthdayType === 'lunar' && data.lunarMonth && data.lunarDay) {
            birthdayDisplay = `${data.birthday}（农历${getLunarMonthName(data.lunarMonth)}${getLunarDayName(data.lunarDay)}）`;
        }
        let msg = `🎂 ${displayName}的生日信息 🎂\n生日: ${birthdayDisplay}\n`
        if (daysLeft === 0) msg += '🎉 今天是你的生日！生日快乐！🎂'
        else if (daysLeft === 1) msg += '🎈 明天就是你的生日啦！'
        else msg += `距离你的生日还有 ${daysLeft} 天`
        const config = ConfigManager.getConfig()
        if (config.birthdayCustomName) {
            msg += '\n\n使用 #生日修改昵称 新昵称 可以修改生日显示的昵称'
        }
        e.reply(msg)
        return true
    }

    /** 设置我的生日 */
    async setMyBirthday(e) {
        const config = ConfigManager.getConfig();
        const allowSelfModify = config.allowSelfModify;
        const message = e.msg.trim();
        const match = message.match(/^#设置生日\s+(.+)$/);
        if (!match) {
            e.reply('格式错误！正确格式：#设置生日 3-2 或 #设置生日 3月2日\n设置农历生日：#设置生日 农历3-2 或 #设置生日 农历三月十五');
            return true;
        }
        const birthdayRaw = match[1].trim();

        // 判断是否为农历生日
        const isLunar = /^(农历|阴历|lunar\s*)/i.test(birthdayRaw);
        let birthday;
        let birthdayType = 'solar';
        let lunarMonth = null;
        let lunarDay = null;
        let birthdayYear = null;

        if (isLunar) {
            const lunarResult = parseLunarBirthdayString(birthdayRaw);
            if (!lunarResult.valid) {
                const errorMsgMap = {
                    'invalid_format': '农历生日格式错误！请使用”农历3-15”或”农历三月十五”这种格式~',
                    'overflow': '农历月份应在1-12之间~',
                    'lunar_day_overflow': '农历日期应在1-30之间~'
                };
                const replyMsg = errorMsgMap[lunarResult.errorCode] || '农历生日格式错误，请使用正确的格式！';
                e.reply(replyMsg);
                return true;
            }
            const solar = lunarToUpcomingSolarDate(lunarResult.lunarMonth, lunarResult.lunarDay);
            if (!solar) {
                e.reply('农历日期转换失败，请检查日期是否有效（仅支持1891-2100年）');
                return true;
            }
            birthday = `${String(solar.month).padStart(2, '0')}-${String(solar.day).padStart(2, '0')}`;
            birthdayType = 'lunar';
            lunarMonth = lunarResult.lunarMonth;
            lunarDay = lunarResult.lunarDay;
            birthdayYear = solar.targetYear;
        } else {
            const parseResult = parseBirthdayString(birthdayRaw);
            if (!parseResult.valid) {
                const errorMsgMap = {
                    'invalid_format': '生日格式错误！请使用”月-日”或”3月2日”这种格式~',
                    'overflow': '月份应在1-12之间，日期应在1-31之间~',
                    'nonexistent_date': `”${birthdayRaw}”不是一个有效的日期，请检查后重新设置~`
                };
                const replyMsg = errorMsgMap[parseResult.errorCode] || '生日格式错误，请使用正确的月-日格式！';
                e.reply(replyMsg);
                return true;
            }
            birthday = parseResult.formatted;
        }

        const userId = e.user_id
        let userName
        if (config.birthdayCustomName) {
            userName = e.sender?.card || e.sender?.nickname || `用户${userId}`
        } else {
            // 自定义昵称关闭时，强制使用QQ昵称
            try {
                userName = await getMemberName(Number(userId))
            } catch {}
            if (!userName) {
                userName = e.sender?.nickname || `用户${userId}`
            }
        }
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
            birthdayType: birthdayType,
            addedBy: userId,
            addedAt: new Date().toISOString(),
            isSelfSet: true,
            nicknameModified: false
        };
        if (birthdayType === 'lunar') {
            this.birthdayData[userId].lunarMonth = lunarMonth;
            this.birthdayData[userId].lunarDay = lunarDay;
            this.birthdayData[userId].birthdayYear = birthdayYear;
        }
        DataManager.saveBirthdayData(this.birthdayData)
        const botName = getBotName(e)
        let displayBirthday = birthday;
        if (birthdayType === 'lunar') {
            displayBirthday = `${birthday}（农历${getLunarMonthName(lunarMonth)}${getLunarDayName(lunarDay)}）`;
        }
        let replymsg = [`✅ 已${isFirstSet ? '修改' : '设置'}你的生日：${displayBirthday}`]
        if (!checkFriend(Number(e.user_id))) {
            replymsg.push(`\n您还未添加好友哦，添加后还可以在生日当天收到${botName}的私信祝福~`)
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
        const config = ConfigManager.getConfig();
        if (!config.birthdayCustomName){
            return e.reply("自定义昵称已禁用（将与QQ昵称同步），如有需要请联系管理员")
        }
        const message = e.msg.trim()
        const match = message.match(/^#生日(设置|修改)昵称\s+(.+)$/)
        if (!match) {
            e.reply('格式错误！正确格式：#生日(设置|修改)昵称 新昵称')
            return true
        }
        const newNickname = match[2].trim()
        if (newNickname.length > 15) {
            return e.reply("昵称太长了，最多15个字")
        }
        const userId = e.user_id
        if (!this.birthdayData[userId]) {
            e.reply('❌ 你还没有设置生日，无法修改昵称\n请先使用 #设置生日 月-日 设置生日')
            return true
        }
        this.birthdayData[userId].name = newNickname
        this.birthdayData[userId].nicknameModified = true
        DataManager.saveBirthdayData(this.birthdayData)
        e.reply(`✅ 昵称修改成功：${newNickname}`)
        return true
    }
    /** 管理员修改生日 */
    async modifyBirthday(e) {
        if (!checkPermission(e)) {
            return e.reply('只有管理员或群主才能修改生日');
        }
        if (!e.group_id) return e.reply('请在群聊中使用此命令');
        const { targetUserId, birthday, birthdayType, lunarMonth, lunarDay, birthdayYear, errorMsg } = this._parseAdminBirthdayCommand(e);
        if (errorMsg) return e.reply(errorMsg);
        const { exists, nickname, errorMsg: userError } = await this._checkUserInGroup(e.group_id, targetUserId);
        if (!exists) return e.reply(userError);
        const oldRecord = this.birthdayData[targetUserId];
        if (!oldRecord) {
            return e.reply(`❌ ${nickname}(${targetUserId}) 还没有设置生日，请先使用 #添加生日 命令`);
        }
        const oldBirthday = oldRecord.birthday;
        // 构建新记录（基于旧记录覆盖新字段）
        const newEntry = {
            ...oldRecord,
            birthday: birthday,
            birthdayType: birthdayType || 'solar',
            modifiedBy: e.user_id,
            modifiedAt: new Date().toISOString(),
            oldBirthday: oldBirthday,
            isModified: true
        };
        // 清除旧农历字段（避免类型切换后残留）
        delete newEntry.lunarMonth;
        delete newEntry.lunarDay;
        delete newEntry.birthdayYear;
        if (birthdayType === 'lunar') {
            newEntry.lunarMonth = lunarMonth;
            newEntry.lunarDay = lunarDay;
            newEntry.birthdayYear = birthdayYear;
        }
        this.birthdayData[targetUserId] = newEntry;
        let displayBirthday = birthday;
        if (birthdayType === 'lunar') {
            displayBirthday = `${birthday}（农历${getLunarMonthName(lunarMonth)}${getLunarDayName(lunarDay)}）`;
        }
        this._saveBirthdayDataAndReply(e, this.birthdayData,
            `已成功修改${nickname}(${targetUserId})的生日：${oldBirthday} → ${displayBirthday}`
        );
        // 私聊通知（只有是好友才通知）
        if ((targetUserId !== e.user_id) && !checkFriend(Number(e.user_id))) {
            try {
                await Bot.pickFriend(targetUserId).sendMsg(`管理员已修改你的生日：${oldBirthday} → ${displayBirthday}`);
            } catch (err) { logger.error(`通知失败: ${err}`); }
        }
        return true;
    }

    /** 帮助 */
    async birthdayHelp(e) {
        const msg = [
            `[Schedule生日模块]\n`,
            `========\n`,
            `[#设置生日 日期] 设置自己的生日\n`,
            `[#清除生日] 移除自己的生日信息`
            `[#生日列表] 查看本群即将到来的10个生日\n`,
            `[#生日完整列表] 查看本群所有生日\n`,
            `[#我的生日] 查看自己的生日信息\n`,
        ]
        const config = ConfigManager.getConfig()
        if (config.birthdayCustomName) {
            msg.push(`[#生日修改昵称 昵称] 修改生日提醒的昵称\n`)
        }
        // 判断是否是管理员
        if (e.isGroup && checkPermission(e)) {
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
        msg.push(`========\n日期格式示例：1-14\n农历生日示例：#设置生日 农历5-3 或 #设置生日 农历三月十五`)
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
        return this._showList(e, 'white');
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
        return this._showList(e, 'black');
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
    // ---------- 公共解析与校验 ----------
    /**
     * 从消息中提取目标QQ和生日字符串（用于管理员命令 #添加生日 / #修改生日）
     * @param {Object} e 事件对象
     * @returns {Object} { targetUserId, birthday, birthdayType, lunarMonth, lunarDay, birthdayYear, errorMsg }
     */
    _parseAdminBirthdayCommand(e) {
        const msg = e.msg.trim();
        let targetUserId = e.at;
        let birthdayRaw = null;
        if (targetUserId) {
            // 有@的情况：格式 “#添加生日 3月2日” 或 “#修改生日 3-2”
            birthdayRaw = msg.slice(5).trim();
        } else {
            // 无@的情况：格式 “#添加生日 123456 3-2”
            const match = msg.match(/^#(添加|修改)生日\s+(\d+)\s+(.+)$/);
            if (match) {
                targetUserId = match[2];
                birthdayRaw = match[3].trim();
            }
        }
        if (!targetUserId || !birthdayRaw) {
            return { errorMsg: '格式错误！正确格式：#添加生日 @某人 3月2日 或 #添加生日 QQ号 3-2\n支持农历：#添加生日 QQ号 农历3-15' };
        }

        // 判断是否为农历生日
        const isLunar = /^(农历|阴历|lunar\s*)/i.test(birthdayRaw);
        if (isLunar) {
            const lunarResult = parseLunarBirthdayString(birthdayRaw);
            if (!lunarResult.valid) {
                let errorMsg;
                switch (lunarResult.errorCode) {
                    case 'invalid_format':
                        errorMsg = '农历生日格式错误！请使用 农历3-15 或 农历三月十五 这样的格式~';
                        break;
                    case 'overflow':
                        errorMsg = '农历月份应在1-12之间~';
                        break;
                    case 'lunar_day_overflow':
                        errorMsg = '农历日期应在1-30之间~';
                        break;
                    default:
                        errorMsg = '农历生日格式错误！';
                }
                return { errorMsg, targetUserId: null, birthday: null };
            }
            const solar = lunarToUpcomingSolarDate(lunarResult.lunarMonth, lunarResult.lunarDay);
            if (!solar) {
                return { errorMsg: '农历日期转换失败，请检查日期是否有效（仅支持1891-2100年）', targetUserId: null, birthday: null };
            }
            const birthday = `${String(solar.month).padStart(2, '0')}-${String(solar.day).padStart(2, '0')}`;
            return {
                targetUserId, birthday, errorMsg: null,
                birthdayType: 'lunar',
                lunarMonth: lunarResult.lunarMonth,
                lunarDay: lunarResult.lunarDay,
                birthdayYear: solar.targetYear
            };
        }

        const parseResult = parseBirthdayString(birthdayRaw);
        if (!parseResult.valid) {
            let errorMsg;
            switch (parseResult.errorCode) {
                case 'invalid_format':
                    errorMsg = '生日格式错误！请使用 月-日 或 3月2日 这样的格式~';
                    break;
                case 'overflow':
                    errorMsg = '月份应在1-12之间，日期应在1-31之间~';
                    break;
                case 'nonexistent_date':
                    errorMsg = `”${birthdayRaw}”不是真实存在的日期，请重新输入有效日期。`;
                    break;
                default:
                    errorMsg = '生日格式错误！';
            }
            return { errorMsg, targetUserId: null, birthday: null };
        }
        return { targetUserId, birthday: parseResult.formatted, birthdayType: 'solar', errorMsg: null };
    }
    /**
     * 检查目标用户是否在当前群内，并返回其昵称
     * @param {string} groupId
     * @param {string} userId
     * @returns {Promise<{ exists: boolean, nickname: string, errorMsg: string }>}
     */
    async _checkUserInGroup(groupId, userId) {
        const group = Bot.pickGroup(groupId);
        if (!group) return { exists: false, nickname: '', errorMsg: '无法获取群信息' };
        const memberMap = await group.getMemberMap();
        const userNum = Number(userId);
        if (!memberMap.has(userNum)) {
            return { exists: false, nickname: '', errorMsg: `本群不存在用户 ${userId}` };
        }
        return { exists: true, nickname: memberMap.get(userNum).nickname, errorMsg: null };
    }
    /**
     * 保存生日数据并返回标准回复
     * @param {Object} newData 新数据对象
     * @param {string} successMsg 成功消息
     * @returns {boolean} 是否保存成功
     */
    _saveBirthdayDataAndReply(e, newData, successMsg) {
        if (DataManager.saveBirthdayData(newData)) {
            e.reply(`✅ ${successMsg}`);
            return true;
        } else {
            e.reply('❌ 保存生日数据失败，请检查日志');
            return false;
        }
    }
    async _showList(e, type) {
        const config = ConfigManager.getConfig();
        const key = type === 'white' ? 'birthdayWhitelistGroups' : 'birthdayBlacklistGroups';
        const list = config[key] || [];
        const title = type === 'white' ? '📋 生日白名单群列表' : '🚫 生日黑名单群列表';
        const emptyMsg = type === 'white' ? '白名单为空，所有群（黑名单除外）都会收到推送。' : '黑名单为空，所有群（受白名单约束）都会收到推送。';
        if (list.length === 0) return e.reply(emptyMsg);
        const msgList = [title];
        for (const gid of list) {
            const name = await this.getGroupName(gid);
            msgList.push(`${name} (${gid})`);
        }
        msgList.push(`共 ${list.length} 个群。`);
        const forwardMsg = await makeForwardMsg(e, msgList, title);
        await e.reply(forwardMsg);
        return true;
    }
    /**
     * 获取用户的显示名称（根据 birthdayCustomName 配置决定返回自定义名或QQ昵称）
     * @param {string|number} userId QQ号
     * @param {string} storedName 数据文件中存储的名称
     * @returns {string} 显示名称
     */
    async _getDisplayName(userId, storedName) {
        const config = ConfigManager.getConfig()
        // 自定义昵称开启：直接返回存储的名称
        if (config.birthdayCustomName) {
            return storedName
        }
        // 自定义昵称关闭：尝试获取QQ昵称
        try {
            const qqNick = await getMemberName(Number(userId))
            if (qqNick) return qqNick
        } catch {}
        // 获取失败时回退到存储的名称
        return storedName
    }
    /**
     * 同步生日数据中的名称为QQ昵称（仅在 birthdayCustomName 为 false 时执行）
     * 当配置从允许自定义切换为不允许时，更新数据文件中的存储名称
     */
    async _syncBirthdayNames() {
        const config = ConfigManager.getConfig()
        // 自定义昵称开启时不需要同步
        if (config.birthdayCustomName) return
        let changed = false
        for (const [userId, data] of Object.entries(this.birthdayData)) {
            try {
                const qqNick = await getMemberName(Number(userId))
                if (qqNick && qqNick !== data.name) {
                    data.name = qqNick
                    data.nicknameModified = false
                    changed = true
                }
            } catch {
                // 获取QQ昵称失败则跳过该用户
            }
        }
        if (changed) {
            DataManager.saveBirthdayData(this.birthdayData)
            logger.info('[Schedule生日提醒] 已同步生日数据中的昵称为QQ昵称')
        }
    }
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms))
    }
}
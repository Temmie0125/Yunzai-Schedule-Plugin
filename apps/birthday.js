// plugins/schedule/apps/birthday.js
import schedule from 'node-schedule'
import { segment } from 'oicq'
import { ConfigManager } from '../components/ConfigManager.js'
import { DataManager } from '../components/DataManager.js'
import { renderBirthdayList } from '../components/Renderer.js'
import { makeForwardMsg, checkPermission, getBotName, checkFriend, getMemberName, getAvatarUrl, getGroupMemberMap, shortId } from '../components/common.js'
import { birthdayButtons } from '../components/buttons.js'
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
                { reg: "^#生日黑白名单清空$", fnc: "clearAllLists", permission: "master" },
                // 旧数据迁移（OneBot QQ号 → 官方Bot复合ID）
                { reg: "^#迁移生日数据$", fnc: "migrateBirthdayData" },
                { reg: "^#确认迁移生日数据$", fnc: "confirmMigrateBirthdayData" },
                // 全量消息钩子：官方Bot管理员代添加生日时目标昵称未知，先入库待目标用户触发事件时回填。
                // 必须放在规则末位，且无论是否命中都 return false 放行消息，避免吞掉用户命令
                { reg: "", fnc: "handleNicknameBackfill", log: false }
            ],
        })
        // 加载生日数据
        this.birthdayData = DataManager.loadBirthdayData()
        // 迁移预览缓存（#迁移生日数据 → #确认迁移生日数据 两步之间共享，5分钟有效）
        this._migrationScan = null
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
                if (!memberMap) continue
                // 统一按字符串比较：OneBot 成员键为数值QQ号，官方Bot为 "botUin:OpenID" 复合ID
                const memberQQs = [...memberMap.keys()].map(String)
                const birthdaysInGroup = todayBirthdayUsers.filter(user =>
                    memberQQs.includes(String(user.userId))
                )
                if (birthdaysInGroup.length) {
                    let message = []
                    // 官方Bot无法@全体成员（SDK 会转成 <@everyone>，非群管理员的Bot会被官方API拒绝导致整条发送失败），
                    // 复合ID群（官方Bot）跳过 at-all；OneBot 行为不变
                    if ((group.is_admin || group.is_owner) && !String(groupId).includes(':')) {
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
            if (checkFriend(user.userId)) {
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
        // 检查用户是否在群内并尝试获取昵称（官方Bot场景可能取不到，见 _checkUserInGroup）
        const { exists, nickname, errorMsg: userError, nicknameUnknown } = await this._checkUserInGroup(e.group_id, targetUserId);
        if (!exists) return e.reply(userError);
        // 如果已存在记录，直接覆盖
        const entry = {
            // 官方Bot缓存未命中时以占位名入库（nicknamePending 标记），待目标用户触发事件时自动回填
            name: nickname || '群成员',
            nicknamePending: !!nicknameUnknown,
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
        // 回复信息：昵称走缓存，取不到时用 @ 代替
        let successMsg;
        if (nickname) {
            successMsg = `已成功为${nickname}(${shortId(targetUserId)})添加生日：${displayBirthday}`;
        } else {
            successMsg = [segment.at(targetUserId), ` 已成功添加生日：${displayBirthday}\n暂时无法获取该成员昵称，待TA在群内发言后将自动补全`];
        }
        this._saveBirthdayDataAndReply(e, this.birthdayData, successMsg);
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
        // 官方Bot场景目标用户为 "botUin:OpenID" 复合ID（通过@指定），非纯数字同样合法
        if (!targetUserId || (!/^\d+$/.test(targetUserId) && !String(targetUserId).includes(':'))) {
            e.reply('请@要移除生日的人，或输入正确的QQ号！')
            return true
        }
        if (this.birthdayData[targetUserId]) {
            delete this.birthdayData[targetUserId]
            DataManager.saveBirthdayData(this.birthdayData)
            e.reply(`✅ 已成功移除用户${shortId(targetUserId)}的生日记录`)
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
        // QQBot 适配器的 getMemberMap 同步返回事件缓存（可能为空），统一走 getGroupMemberMap 兼容
        const memberMap = await getGroupMemberMap(e.group_id)
        if (!memberMap) {
            return e.reply('获取群成员列表失败，请稍后重试~')
        }
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
                name: await this._getDisplayName(item.userId, item.name, e.group_id),
                // qq 标签仅作展示，官方Bot复合ID只显示 OpenID 部分
                qq: showQQ ? shortId(item.userId) : null,
                birthday: item.birthday,
                days: item.days,
                birthdayType: item.birthdayType,
                avatar: getAvatarUrl(item.userId, 0)
            })))
        }
        await e.reply("正在生成生日列表图片，请稍候...", false, { recallMsg: 5 })
        const img = await renderBirthdayList(templateData, { e })
        if (img) {
            await e.reply([segment.image(img), ...birthdayButtons(e)])
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
        const displayName = await this._getDisplayName(userId, data.name, e.group_id)
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
        e.reply([msg, ...birthdayButtons(e, { withClear: true })])
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
            // 自定义昵称关闭时，强制使用QQ昵称（官方Bot消息事件自带昵称，getMemberName 内部兼容）
            try {
                userName = await getMemberName(userId)
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
        if (!checkFriend(e.user_id)) {
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
            return e.reply(`❌ ${nickname || '该用户'}(${shortId(targetUserId)}) 还没有设置生日，请先使用 #添加生日 命令`);
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
        // 旧记录为占位昵称且本次已能取到昵称时顺带补全
        if (oldRecord.nicknamePending && nickname) {
            newEntry.name = nickname;
            delete newEntry.nicknamePending;
        }
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
        // 回复信息：昵称走缓存，取不到时用 @ 代替
        let successMsg;
        if (nickname) {
            successMsg = `已成功修改${nickname}(${shortId(targetUserId)})的生日：${oldBirthday} → ${displayBirthday}`;
        } else {
            successMsg = [segment.at(targetUserId), ` 已成功修改生日：${oldBirthday} → ${displayBirthday}`];
        }
        this._saveBirthdayDataAndReply(e, this.birthdayData, successMsg);
        // 私聊通知（只有是好友才通知）
        if ((targetUserId !== e.user_id) && checkFriend(targetUserId)) {
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
            `[#清除生日] 移除自己的生日信息\n`,
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
            // 官方Bot群聊额外提供旧数据迁移
            if (String(e.group_id || '').includes(':')) {
                msg.push(`[#迁移生日数据] 将OneBot旧生日数据迁移至官方Bot\n`)
            }
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
        e.reply([...msg, ...birthdayButtons(e)])
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
     * 昵称获取顺序：适配器事件缓存（gml）→ 官方Bot降级入库 → OneBot严格校验
     * @param {string} groupId
     * @param {string} userId
     * @returns {Promise<{ exists: boolean, nickname: string, errorMsg: string, nicknameUnknown?: boolean }>}
     *   nicknameUnknown: 官方Bot场景缓存未命中（官方未开放成员查询接口，无法核实是否在群、无法取昵称），
     *   调用方可视为在群内先入库，昵称由 handleNicknameBackfill 在目标用户下次触发事件时回填
     */
    async _checkUserInGroup(groupId, userId) {
        const group = Bot.pickGroup(groupId);
        if (!group) return { exists: false, nickname: '', errorMsg: '无法获取群信息' };
        // 官方Bot场景目标用户为 "botUin:OpenID" 复合ID，成员缓存键即该复合ID
        const isOfficialUser = String(userId).includes(':');
        let memberMap = null;
        try {
            memberMap = await group.getMemberMap();
        } catch { }
        if (memberMap) {
            const info = memberMap.get(isOfficialUser ? String(userId) : Number(userId));
            if (info) {
                return { exists: true, nickname: info.card || info.nickname || '', errorMsg: null };
            }
        }
        if (isOfficialUser) {
            // 官方Bot未开放群成员查询接口：缓存未命中时先放行入库，昵称待回填
            return { exists: true, nickname: '', errorMsg: null, nicknameUnknown: true };
        }
        if (!memberMap) return { exists: false, nickname: '', errorMsg: '无法获取群成员信息' };
        return { exists: false, nickname: '', errorMsg: `本群不存在用户 ${userId}` };
    }
    /**
     * 保存生日数据并返回标准回复
     * @param {Object} newData 新数据对象
     * @param {string|Array} successMsg 成功消息（数组时首段前拼 "✅ "，用于携带 @ 的消息）
     * @returns {boolean} 是否保存成功
     */
    _saveBirthdayDataAndReply(e, newData, successMsg) {
        if (DataManager.saveBirthdayData(newData)) {
            e.reply(Array.isArray(successMsg) ? ['✅ ', ...successMsg] : `✅ ${successMsg}`);
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
     * @param {string|number} userId QQ号或官方Bot复合ID
     * @param {string} storedName 数据文件中存储的名称
     * @param {number|string} [groupId] 可选群号，提供时优先精确查该群成员缓存
     * @returns {string} 显示名称
     */
    async _getDisplayName(userId, storedName, groupId = null) {
        const config = ConfigManager.getConfig()
        // 自定义昵称开启：直接返回存储的名称
        if (config.birthdayCustomName) {
            return storedName
        }
        // 自定义昵称关闭：尝试获取QQ昵称（官方Bot场景走适配器事件缓存）
        try {
            const qqNick = await getMemberName(userId, groupId)
            if (qqNick) return qqNick
        } catch { }
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
                const qqNick = await getMemberName(userId)
                if (qqNick) {
                    if (qqNick !== data.name) {
                        data.name = qqNick
                        data.nicknameModified = false
                        changed = true
                    }
                    // 官方Bot代添加时的占位昵称已可解析，清除待回填标记
                    if (data.nicknamePending) {
                        delete data.nicknamePending
                        changed = true
                    }
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
    /**
     * 生日数据迁移（管理员，官方Bot专用）：扫描 OneBot 旧数据（QQ号键）能否匹配到本群
     * 官方Bot成员缓存中的同一成员，预览结果并等待二次确认
     */
    async migrateBirthdayData(e) {
        if (!checkPermission(e)) {
            return e.reply('只有管理员或群主才能迁移生日数据')
        }
        if (!String(e.group_id || '').includes(':')) {
            return e.reply('本命令用于将 OneBot 环境的旧生日数据迁移到官方Bot，请在官方Bot的群聊中使用')
        }
        const { total, matched, unmatched, skipped } = await this._scanMigratableBirthdays(e)
        if (!total) {
            return e.reply('没有找到需要迁移的旧生日数据（无QQ号键的记录）')
        }
        if (!matched.length) {
            let msg = `扫描了 ${total} 条旧生日数据，本群成员缓存中没有能匹配的成员，本次无可迁移数据。\n匹配要求昵称与头像均一致，且目标成员需在Bot重启后于本群发言过（以积累成员缓存）。`
            if (unmatched.length) {
                msg += `\n未匹配：${unmatched.slice(0, 5).map(m => `「${m.name}」`).join('、')}${unmatched.length > 5 ? ` 等 ${unmatched.length} 条` : ''}`
            }
            return e.reply(msg)
        }
        // 缓存扫描结果供确认命令使用
        this._migrationScan = { at: Date.now(), matched }
        let msg = `📋 生日数据迁移预览\n共扫描旧数据 ${total} 条：\n✅ 可迁移 ${matched.length} 条（昵称+头像均与群成员缓存一致）`
        if (skipped.length) msg += `\n⏭️ 已存在官方Bot记录而跳过 ${skipped.length} 条`
        if (unmatched.length) msg += `\n❌ 无法匹配 ${unmatched.length} 条（保持不变，需重新设置）`
        msg += '\n\n将执行：'
        for (const m of matched.slice(0, 10)) {
            msg += `\n「${m.name}」QQ${m.qq} → ${shortId(m.compositeId)}`
        }
        if (matched.length > 10) msg += `\n…等共 ${matched.length} 条`
        const buttons = [segment.button([{
            text: '确认迁移', callback: '#确认迁移生日数据', permission: [e.user_id],
            content: `确认迁移 ${matched.length} 条生日数据？`, confirm_text: '确认', cancel_text: '取消',
        }])]
        await e.reply([msg, ...buttons])
        return true
    }

    /** 确认执行生日数据迁移（配合 #迁移生日数据 的预览缓存） */
    async confirmMigrateBirthdayData(e) {
        if (!checkPermission(e)) {
            return e.reply('只有管理员或群主才能迁移生日数据')
        }
        const scan = this._migrationScan
        if (!scan || Date.now() - scan.at > 5 * 60 * 1000 || !scan.matched?.length) {
            return e.reply('没有待确认的迁移任务或预览已过期，请先使用 #迁移生日数据 扫描')
        }
        let migrated = 0
        for (const m of scan.matched) {
            // 预览后数据可能变化：目标键已存在或旧键已不在时保守跳过
            if (this.birthdayData[m.compositeId] || !this.birthdayData[m.qq]) continue
            this.birthdayData[m.compositeId] = {
                ...this.birthdayData[m.qq],
                migratedFrom: String(m.qq),
                migratedAt: new Date().toISOString(),
            }
            delete this.birthdayData[m.qq]
            migrated++
        }
        DataManager.saveBirthdayData(this.birthdayData)
        this._migrationScan = null
        logger.mark(`[Schedule生日提醒] 生日数据迁移完成：${migrated}/${scan.matched.length} 条`)
        return e.reply(`✅ 迁移完成：${migrated} 条旧生日数据已转为官方Bot记录，这些成员无需重新设置。\n未匹配成员的旧数据保持不变，可在其发言积累缓存后重新执行 #迁移生日数据`)
    }

    /**
     * 扫描可迁移的旧生日数据（QQ号键 → 官方Bot复合ID键）
     * 同一成员判定（二者须同时满足，任一取不到即判不匹配，避免误迁移）：
     * 1. 昵称一致：旧记录 name 与成员缓存 nickname 完全相同
     * 2. 头像一致：QQ号 qlogo 直链头像与 OpenID qqapp 头像逐字节相同（依次尝试 100/640 尺寸）
     * @returns {Promise<{ total: number, matched: Array, unmatched: Array, skipped: Array }>}
     */
    async _scanMigratableBirthdays(e) {
        const result = { total: 0, matched: [], unmatched: [], skipped: [] }
        const oldEntries = Object.entries(this.birthdayData).filter(([key]) => /^\d+$/.test(key))
        result.total = oldEntries.length
        if (!result.total) return result
        // 官方Bot成员缓存（gml）：键为 "botUin:OpenID" 复合ID，值含 nickname/avatar；
        // getMemberMap 同步返回 Map 而非 Promise，统一走 getGroupMemberMap 兼容
        const memberMap = await getGroupMemberMap(e.group_id)
        if (!memberMap) {
            result.unmatched = oldEntries.map(([qq, data]) => ({ qq, name: data.name }))
            return result
        }
        const members = [...memberMap.values()]
        for (const [qq, data] of oldEntries) {
            // 昵称初筛，头像复检逐字节比对
            const candidates = members.filter(m => m?.nickname && m.nickname === data.name)
            let hit = null
            for (const member of candidates) {
                if (await this._sameAvatar(qq, member.user_id)) {
                    hit = member
                    break
                }
            }
            if (!hit) {
                result.unmatched.push({ qq, name: data.name })
                continue
            }
            if (this.birthdayData[hit.user_id]) {
                // 该成员已有官方Bot记录（如手动重新设置过），不覆盖
                result.skipped.push({ qq, name: data.name })
                continue
            }
            result.matched.push({ qq, name: data.name, compositeId: hit.user_id })
        }
        return result
    }

    /**
     * 比较 QQ号直链头像与官方Bot OpenID 头像是否为同一张图（逐字节比对）
     * @param {string} qq 旧数据QQ号
     * @param {string} compositeId 官方Bot复合ID "botUin:OpenID"
     * @returns {Promise<boolean>}
     */
    async _sameAvatar(qq, compositeId) {
        const fetchBuf = async url => {
            const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
            return res.ok ? Buffer.from(await res.arrayBuffer()) : null
        }
        // 依次尝试 100/640 尺寸，任一尺寸字节一致即认定同一头像
        for (const size of [100, 640]) {
            try {
                const [qqAvatar, openAvatar] = await Promise.all([
                    fetchBuf(`https://q1.qlogo.cn/g?b=qq&nk=${qq}&s=${size}`),
                    fetchBuf(getAvatarUrl(compositeId, size)),
                ])
                if (!qqAvatar || !openAvatar) return false
                if (qqAvatar.equals(openAvatar)) return true
            } catch {
                return false
            }
        }
        return false
    }
    /**
     * 全量消息钩子（配合规则末位的空 reg 规则）：官方Bot管理员代添加生日时目标昵称未知，
     * 先以占位名入库；目标用户下次触发消息事件时事件自带昵称，在此回填并落盘。
     * 无论是否命中都 return false 放行消息：触发回填的消息可能同时是发给其他插件的命令，
     * 返回 true 会吞掉消息导致命令失效
     */
    async handleNicknameBackfill() {
        const e = this.e
        const data = this.birthdayData[e.user_id]
        if (!data?.nicknamePending) return false
        const nickname = e.sender?.card || e.sender?.nickname
        if (!nickname) return false
        data.name = nickname
        delete data.nicknamePending
        DataManager.saveBirthdayData(this.birthdayData)
        logger.info(`[Schedule生日提醒] 已回填用户 ${shortId(e.user_id)} 的昵称：${nickname}`)
        return false
    }
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms))
    }
}
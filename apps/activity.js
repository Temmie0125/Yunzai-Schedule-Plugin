// apps/activity.js
// 活动（会议/活动/考试等临时安排）的添加与撤销
//
// 与课程的关系：活动存在用户自己的数据文件里（schedule.activities），
// 查询/渲染时按日期并入当天的“课程”列表，只额外带 isActivity 标记
// （群课表圆点空心圈、个人卡片「活动」标签），其余表现与课程一致，
// #清除课表 删除文件时活动一并清除。
//
// 命令：
//   #clsadd <日期> <时间段> <名称> [地点]   一行添加，如 #clsadd 20261112 1000-1600 志愿者 第一学科楼
//   #clsadd                                 轮询添加：日期 → 时间段 → 名称 → 地点 → 确认/取消
//   #取消添加 [日期]                        撤销添加（不填日期则撤销最近一次添加；轮询中则中断流程）
//   #活动列表 [日期]                        查看即将到来/指定日期的活动
import { DataManager, ACTIVITY_MAX_NAME, ACTIVITY_MAX_LOCATION } from '../components/DataManager.js'
import { ConfigManager } from '../components/ConfigManager.js'
import { SchedulePlugin } from '../components/GroupAccess.js'
import {
    parseActivityDate,
    parseTimeRange,
    formatDate,
    normalizeDateOnly,
    timeToMinutes,
    calculateWeekFromDate,
    compareByStartTime
} from '../utils/timeUtils.js'

/** 轮询添加的会话（模块级：TRSS-Yunzai 每条消息都会新建插件实例，不能挂在实例上） */
const sessions = new Map()
const SESSION_TTL_MS = 5 * 60 * 1000
const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function sessionKey(userId, selfId) {
    return `${selfId ?? ''}:${userId}`
}

function readSession(userId, selfId) {
    const key = sessionKey(userId, selfId)
    const session = sessions.get(key)
    if (!session) return null
    if (Date.now() - session.at > SESSION_TTL_MS) {
        sessions.delete(key)
        return null
    }
    return session
}

function writeSession(userId, selfId, patch) {
    const key = sessionKey(userId, selfId)
    const session = sessions.get(key) || { data: {} }
    sessions.set(key, { ...session, ...patch, data: { ...session.data, ...(patch.data || {}) }, at: Date.now() })
}

function clearSession(userId, selfId) {
    sessions.delete(sessionKey(userId, selfId))
}

/** 日期 + 时间段 → 便于阅读的展示文本 */
function describeActivity(activity) {
    const date = parseActivityDate(activity.date)
    const weekday = date ? WEEKDAY_LABELS[date.getDay()] : ''
    return `${activity.date}${weekday ? `（${weekday}）` : ''} ${activity.startTime}-${activity.endTime}\n` +
        `📌 ${activity.name}${activity.location ? `\n📍 ${activity.location}` : ''}`
}

/** 截断超长文本（用于提示，不落库） */
function clip(text, max = 30) {
    const value = String(text ?? '')
    return value.length > max ? `${value.slice(0, max)}…` : value
}

export class ScheduleActivity extends SchedulePlugin {
    constructor() {
        super({
            name: '[Schedule] 活动日程',
            dsc: '添加/撤销会议、活动、考试等临时安排',
            event: 'message',
            priority: 1000,
            // 字段较多，统一用「一行式」+「轮询式」两种输入方式
            // 轮询各步骤通过上下文回调实现（clsadd_date 等），状态存在模块级 sessions 里
            rule: [
                { reg: '^#clsadd(?:\\s+([\\s\\S]+))?$', fnc: 'addActivity' },
                { reg: '^#(?:取消|撤销)添加(?:活动|日程)?(?:\\s+(.+))?$', fnc: 'cancelAdd' },
                { reg: '^#(?:活动列表|我的活动)(?:\\s+(.+))?$', fnc: 'listActivities' }
            ]
        })
    }

    // ========== 添加 ==========
    /**
     * #clsadd <日期> <时间段> <名称> [地点] / 不带参数进入轮询
     */
    async addActivity() {
        const e = this.e
        const arg = String(e.msg || '').replace(/^#clsadd\s*/, '').trim()
        if (!arg) {
            return await this._startInteractive()
        }
        const parsed = this._parseAddLine(arg)
        if (parsed.error) {
            await this.reply(parsed.error)
            return true
        }
        await this._saveAndReply(parsed.activity)
        return true
    }

    /**
     * 解析一行式添加参数：日期 时间段 名称 [地点]
     * @param {string} arg
     * @returns {{activity?: object, error?: string}}
     */
    _parseAddLine(arg) {
        const tokens = String(arg || '').trim().split(/\s+/)
        if (tokens.length < 3) {
            return {
                error: '格式不对哦，正确用法：\n' +
                    '#clsadd <日期> <时间段> <名称> [地点]\n' +
                    '例如：#clsadd 20261112 1000-1600 志愿者 第一学科楼\n' +
                    '也可以只发 #clsadd 一步步添加喵~'
            }
        }
        const [dateToken, timeToken, nameToken, ...rest] = tokens
        return this._buildActivity({
            dateToken,
            timeToken,
            name: nameToken,
            location: rest.join(' ')
        })
    }

    /**
     * 校验并构建活动对象（一行式与轮询共用）
     * @returns {{activity?: object, error?: string}}
     */
    _buildActivity({ dateToken, timeToken, name, location }) {
        const schedule = DataManager.loadSchedule(this.e.user_id)
        const semesterStart = schedule?.semesterStart || ConfigManager.getConfig().defaultSemesterStart
        const date = parseActivityDate(dateToken, semesterStart)
        if (!date) {
            return { error: `看不懂日期「${clip(dateToken)}」喵~ 可以用 20261112 / 2026-11-12 / 11-12 这样的写法` }
        }
        const range = parseTimeRange(timeToken)
        if (!range) {
            return { error: `看不懂时间段「${clip(timeToken)}」喵~ 可以用 1000-1600 或 10:00-16:00 这样的写法（结束要晚于开始）` }
        }
        const trimmedName = String(name ?? '').trim()
        if (!trimmedName) {
            return { error: '活动名称不能为空喵~' }
        }
        if (trimmedName.length > ACTIVITY_MAX_NAME) {
            return { error: `活动名称太长了，请控制在 ${ACTIVITY_MAX_NAME} 个字以内喵~` }
        }
        const trimmedLocation = String(location ?? '').trim()
        if (trimmedLocation.length > ACTIVITY_MAX_LOCATION) {
            return { error: `活动地点太长了，请控制在 ${ACTIVITY_MAX_LOCATION} 个字以内喵~` }
        }
        return {
            activity: {
                id: DataManager.createActivityId(),
                name: trimmedName,
                location: trimmedLocation,
                date: formatDate(date),
                startTime: range.startTime,
                endTime: range.endTime,
                createdAt: new Date().toISOString()
            }
        }
    }

    /**
     * 保存活动并回复（含时间重叠提示与撤销指引）
     */
    async _saveAndReply(activity) {
        const userId = this.e.user_id
        const activities = DataManager.getActivities(userId)
        if (activities.length >= 200) {
            await this.reply('活动数量已达上限（200 条）啦，请先清理一些旧活动喵~')
            return true
        }
        // 同一天同样的活动不重复添加
        const duplicated = activities.find(item =>
            item.date === activity.date
            && item.name === activity.name
            && item.startTime === activity.startTime
            && item.endTime === activity.endTime
            && item.location === activity.location
        )
        if (duplicated) {
            await this.reply(`这个活动已经添加过啦喵~\n${describeActivity(duplicated)}`)
            return true
        }
        activities.push(activity)
        if (!DataManager.saveActivities(userId, activities)) {
            await this.reply('❌ 保存活动失败，请稍后重试喵~')
            return true
        }
        const overlaps = this._findOverlaps(activity)
        let reply = `✅ 已添加活动\n${describeActivity(activity)}`
        if (overlaps.length > 0) {
            reply += `\n\n⚠️ 与已有安排时间重叠：${overlaps.slice(0, 3).map(item => clip(item.name, 12)).join('、')}`
                + `${overlaps.length > 3 ? ` 等 ${overlaps.length} 项` : ''}`
        }
        reply += `\n\n活动在群课表里显示为**空心圆点**、个人课表里带「活动」标记`
        reply += `\n如需撤销：发送 #取消添加 ${activity.date.replace(/-/g, '')}`
        await this.reply(reply)
        return true
    }

    /**
     * 找出与目标时间段重叠的当天安排（课程 + 其他活动）
     * @param {object} activity 待添加的活动
     * @returns {Array}
     */
    _findOverlaps(activity) {
        const userId = this.e.user_id
        const schedule = DataManager.loadSchedule(userId)
        if (!schedule) return []
        const lists = []
        const date = parseActivityDate(activity.date)
        const day = date ? (date.getDay() === 0 ? 7 : date.getDay()) : null
        const week = date ? calculateWeekFromDate(schedule.semesterStart, date) : null
        if (day && week !== null) {
            for (const course of schedule.courses || []) {
                if (parseInt(course.day) === day && Array.isArray(course.weeks) && course.weeks.includes(week)) {
                    lists.push(course)
                }
            }
        }
        for (const item of DataManager.getActivitiesForDate(schedule, activity.date)) {
            if (item.id === activity.id) continue
            lists.push(DataManager.activityToDayEntry(item))
        }
        const start = timeToMinutes(activity.startTime)
        const end = timeToMinutes(activity.endTime)
        return lists.filter(item =>
            timeToMinutes(item.startTime) < end && start < timeToMinutes(item.endTime)
        ).sort(compareByStartTime)
    }

    // ========== 轮询添加 ==========
    async _startInteractive() {
        const userId = this.e.user_id
        const selfId = this.e.self_id
        writeSession(userId, selfId, { step: 'date', data: { name: '', location: '' } })
        this.setContext('clsadd_date', false, 120)
        await this.reply(
            '📥 添加活动（随时发送「取消」退出）\n' +
            '① 请发送活动**日期**：如 20261112 / 2026-11-12 / 11-12'
        )
        return true
    }

    /** 是否在轮询流程中；不在则提示并清理上下文 */
    async _requireSession(contextName) {
        const session = readSession(this.e.user_id, this.e.self_id)
        if (session) return session
        this.finish(contextName)
        await this.reply('这次添加已经超时啦，请重新发送 #clsadd 开始喵~')
        return null
    }

    async clsadd_date() {
        const session = await this._requireSession('clsadd_date')
        if (!session) return true
        const text = String(this.e.msg || '').trim()
        if (/^(取消|cancel)$/i.test(text)) return await this._cancelInteractive('clsadd_date')
        const schedule = DataManager.loadSchedule(this.e.user_id)
        const semesterStart = schedule?.semesterStart || ConfigManager.getConfig().defaultSemesterStart
        const date = parseActivityDate(text, semesterStart)
        if (!date) {
            await this.reply('日期看不懂喵~ 请发送 20261112 / 2026-11-12 / 11-12 这样的日期，或发「取消」退出')
            return true
        }
        this.finish('clsadd_date')
        writeSession(this.e.user_id, this.e.self_id, { step: 'time', data: { date: formatDate(date) } })
        this.setContext('clsadd_time', false, 120)
        await this.reply(`📅 日期：${formatDate(date)}\n② 请发送**时间段**：如 1000-1600 或 10:00-16:00`)
        return true
    }

    async clsadd_time() {
        const session = await this._requireSession('clsadd_time')
        if (!session) return true
        const text = String(this.e.msg || '').trim()
        if (/^(取消|cancel)$/i.test(text)) return await this._cancelInteractive('clsadd_time')
        const range = parseTimeRange(text)
        if (!range) {
            await this.reply('时间段看不懂喵~ 请发送 1000-1600 或 10:00-16:00（结束要晚于开始），或发「取消」退出')
            return true
        }
        this.finish('clsadd_time')
        writeSession(this.e.user_id, this.e.self_id, { step: 'name', data: range })
        this.setContext('clsadd_name', false, 120)
        await this.reply(`🕐 时间：${range.startTime}-${range.endTime}\n③ 请发送**活动名称**：如 志愿者 / 期中考试`)
        return true
    }

    async clsadd_name() {
        const session = await this._requireSession('clsadd_name')
        if (!session) return true
        const text = String(this.e.msg || '').trim()
        if (/^(取消|cancel)$/i.test(text)) return await this._cancelInteractive('clsadd_name')
        if (!text) {
            await this.reply('活动名称不能为空喵~ 请重新发送，或发「取消」退出')
            return true
        }
        if (text.length > ACTIVITY_MAX_NAME) {
            await this.reply(`名称太长了，请控制在 ${ACTIVITY_MAX_NAME} 个字以内喵~`)
            return true
        }
        this.finish('clsadd_name')
        writeSession(this.e.user_id, this.e.self_id, { step: 'location', data: { name: text } })
        this.setContext('clsadd_location', false, 120)
        await this.reply(`📌 名称：${text}\n④ 请发送**地点**（没有就发「无」）`)
        return true
    }

    async clsadd_location() {
        const session = await this._requireSession('clsadd_location')
        if (!session) return true
        const text = String(this.e.msg || '').trim()
        if (/^(取消|cancel)$/i.test(text)) return await this._cancelInteractive('clsadd_location')
        const location = /^(无|没有|none|-)$/i.test(text) ? '' : text
        if (location.length > ACTIVITY_MAX_LOCATION) {
            await this.reply(`地点太长了，请控制在 ${ACTIVITY_MAX_LOCATION} 个字以内喵~`)
            return true
        }
        this.finish('clsadd_location')
        const data = { ...session.data, location }
        writeSession(this.e.user_id, this.e.self_id, { step: 'confirm', data: { location } })
        this.setContext('clsadd_confirm', false, 120)
        const preview = {
            date: data.date,
            startTime: data.startTime,
            endTime: data.endTime,
            name: data.name,
            location
        }
        await this.reply(
            `请确认活动信息：\n${describeActivity(preview)}\n\n` +
            '回复「确认」保存，回复「取消」放弃喵~'
        )
        return true
    }

    async clsadd_confirm() {
        const session = await this._requireSession('clsadd_confirm')
        if (!session) return true
        const text = String(this.e.msg || '').trim()
        if (/^(取消|cancel)/i.test(text)) return await this._cancelInteractive('clsadd_confirm')
        if (!/^(确认|确定|好|可以|是|yes|y|ok)$/i.test(text)) {
            await this.reply('回复「确认」保存，或回复「取消」放弃喵~')
            return true
        }
        const built = this._buildActivity({
            dateToken: session.data.date,
            timeToken: `${session.data.startTime}-${session.data.endTime}`,
            name: session.data.name,
            location: session.data.location
        })
        this.finish('clsadd_confirm')
        clearSession(this.e.user_id, this.e.self_id)
        if (built.error) {
            await this.reply(built.error)
            return true
        }
        await this._saveAndReply(built.activity)
        return true
    }

    /** 中断轮询添加 */
    async _cancelInteractive(contextName) {
        this.finish(contextName)
        clearSession(this.e.user_id, this.e.self_id)
        await this.reply('已取消添加活动喵~')
        return true
    }

    // ========== 撤销添加 ==========
    /**
     * #取消添加 [日期]：撤销最近一次添加的活动（可指定日期）
     * 若正处于轮询添加流程中，则直接中断流程
     */
    async cancelAdd() {
        const userId = this.e.user_id
        const selfId = this.e.self_id
        if (readSession(userId, selfId)) {
            clearSession(userId, selfId)
            for (const name of ['clsadd_date', 'clsadd_time', 'clsadd_name', 'clsadd_location', 'clsadd_confirm']) {
                this.finish(name)
            }
            await this.reply('已取消添加活动喵~')
            return true
        }
        const arg = String(this.e.msg || '').replace(/^#(?:取消|撤销)添加(?:活动|日程)?\s*/, '').trim()
        let dateFilter = null
        if (arg) {
            const schedule = DataManager.loadSchedule(userId)
            const semesterStart = schedule?.semesterStart || ConfigManager.getConfig().defaultSemesterStart
            const date = parseActivityDate(arg, semesterStart)
            if (!date) {
                await this.reply(`看不懂日期「${clip(arg)}」喵~ 用法：#取消添加 [日期]，如 #取消添加 20261112`)
                return true
            }
            dateFilter = formatDate(date)
        }
        const activities = DataManager.getActivities(userId)
        const candidates = (dateFilter ? activities.filter(item => item.date === dateFilter) : activities)
            .slice()
            .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        if (candidates.length === 0) {
            await this.reply(dateFilter
                ? `这一天（${dateFilter}）没有添加过活动喵~`
                : '你还没有添加过活动喵~')
            return true
        }
        const target = candidates[0]
        const rest = activities.filter(item => item.id !== target.id)
        if (!DataManager.saveActivities(userId, rest)) {
            await this.reply('❌ 撤销失败，请稍后重试喵~')
            return true
        }
        await this.reply(`✅ 已撤销活动\n${describeActivity(target)}`)
        return true
    }

    // ========== 活动列表 ==========
    /**
     * #活动列表 [日期]：默认列出今天及以后的活动（最多 10 条）
     */
    async listActivities() {
        const userId = this.e.user_id
        const arg = String(this.e.msg || '').replace(/^#(?:活动列表|我的活动)\s*/, '').trim()
        const activities = DataManager.getActivities(userId)
        if (activities.length === 0) {
            await this.reply('你还没有添加过活动喵~\n发送 #clsadd <日期> <时间段> <名称> [地点] 就能添加，例如：\n#clsadd 20261112 1000-1600 志愿者 第一学科楼')
            return true
        }
        let list = activities
        let title = '即将到来的活动'
        if (arg) {
            const schedule = DataManager.loadSchedule(userId)
            const semesterStart = schedule?.semesterStart || ConfigManager.getConfig().defaultSemesterStart
            const date = parseActivityDate(arg, semesterStart)
            if (!date) {
                await this.reply(`看不懂日期「${clip(arg)}」喵~ 用法：#活动列表 [日期]，如 #活动列表 20261112`)
                return true
            }
            const dateStr = formatDate(date)
            list = activities.filter(item => item.date === dateStr)
            title = `${dateStr} 的活动`
        } else {
            const today = normalizeDateOnly(formatDate(new Date()))
            list = activities.filter(item => item.date >= today)
        }
        if (list.length === 0) {
            await this.reply(`${title}：没有喵~`)
            return true
        }
        const shown = list.slice(0, 10)
        let reply = `📋 ${title}（共 ${list.length} 条）\n`
        reply += '='.repeat(22) + '\n'
        shown.forEach((item, index) => {
            reply += `${index + 1}. ${describeActivity(item)}\n`
            if (index < shown.length - 1) reply += '\n'
        })
        if (list.length > shown.length) {
            reply += `\n…还有 ${list.length - shown.length} 条，可用 #活动列表 <日期> 查看指定日期`
        }
        reply += '\n\n如需删除：发送 #clsdel 查看删除用法'
        await this.reply(reply)
        return true
    }
}

export default ScheduleActivity

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
/** 待确认的删除计划（同样放模块级，避免每条消息新建实例后丢失） */
const pendingDeletes = new Map()
const SESSION_TTL_MS = 5 * 60 * 1000
const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
/** 单次删除最多覆盖的天数 / 预览最多展示的条目数 */
const MAX_DELETE_DAYS = 366
const MAX_PREVIEW_ITEMS = 10

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

/** 课程的稳定指纹：确认删除时用它校验数据是否被改过 */
function fingerprintOfCourse(course) {
    return [course?.name || '', course?.day ?? '', course?.startTime || '', course?.endTime || ''].join('|')
}

/**
 * 解析删除用的“日期词”：今天/明天/昨天，或 20261112 / 2026-11-12 / 11-12
 * @returns {Date|null}
 */
function resolveDateToken(token, semesterStart) {
    const text = String(token ?? '').trim()
    if (!text) return null
    const offsetMap = { '今天': 0, '今日': 0, '明天': 1, '明日': 1, '昨天': -1, '昨日': -1 }
    if (offsetMap[text] !== undefined) {
        const base = new Date()
        base.setHours(0, 0, 0, 0)
        base.setDate(base.getDate() + offsetMap[text])
        return base
    }
    return parseActivityDate(text, semesterStart)
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
                { reg: '^#(?:活动列表|我的活动)(?:\\s+(.+))?$', fnc: 'listActivities' },
                // 删除课程/活动：按日期（单日或区间）+ 条件（第几节/时间段/教室/名称），需二次确认
                { reg: '^#clsdel(?:\\s+([\\s\\S]+))?$', fnc: 'deleteEntries' }
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

    // ========== 删除课程/活动 ==========
    /**
     * #clsdel [日期|日期 日期] [条件]
     * 条件支持：第N节 / 第N-M节、1000-1200、地点:xxx、课程:xxx、裸词（名称或地点包含）
     * 不给条件 = 删除该日期（或区间）内的全部条目；执行前会列出预览并要求「确认」
     */
    async deleteEntries() {
        const arg = String(this.e.msg || '').replace(/^#clsdel\s*/, '').trim()
        const parsed = this._parseDeleteArgs(arg)
        if (parsed.error) {
            await this.reply(parsed.error)
            return true
        }
        const plan = this._buildDeletePlan(parsed)
        if (plan.error) {
            await this.reply(plan.error)
            return true
        }
        if (plan.matched.length === 0) {
            await this.reply(
                `没有找到匹配的条目喵~\n\n${this._deleteUsage()}`
            )
            return true
        }
        pendingDeletes.set(sessionKey(this.e.user_id, this.e.self_id), { plan, at: Date.now() })
        this.setContext('clsdel_confirm', false, 120)
        await this.reply(this._formatDeletePreview(plan))
        return true
    }

    /** 删除用法提示 */
    _deleteUsage() {
        return '用法：#clsdel [日期|日期 日期] [条件]\n' +
            '· 日期：20261112 / 2026-11-12 / 11-12 / 今天 / 明天（两个日期表示区间，不带则默认今天）\n' +
            '· 条件：第3节 / 第2-4节、1000-1200、地点:教107、课程:高等数学\n' +
            '· 不带条件 = 删除该日期（或区间）内的全部课程与活动\n' +
            '例如：#clsdel 20261112 第3节 、 #clsdel 今天 1000-1200 、 #clsdel 20261112 20261120'
    }

    /**
     * 解析删除参数
     * @param {string} arg
     * @returns {{start?: Date, end?: Date, filter?: object, error?: string}}
     */
    _parseDeleteArgs(arg) {
        const schedule = DataManager.loadSchedule(this.e.user_id)
        const semesterStart = schedule?.semesterStart || ConfigManager.getConfig().defaultSemesterStart
        const tokens = String(arg || '').split(/\s+/).filter(Boolean)
        const dates = []
        let index = 0
        while (index < tokens.length && dates.length < 2) {
            const date = resolveDateToken(tokens[index], semesterStart)
            if (!date) break
            dates.push(date)
            index++
        }
        // 没写日期时默认今天
        if (dates.length === 0) {
            const today = new Date()
            today.setHours(0, 0, 0, 0)
            dates.push(today)
        }
        const start = new Date(Math.min(...dates.map(d => d.getTime())))
        const end = new Date(Math.max(...dates.map(d => d.getTime())))
        const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1
        if (days > MAX_DELETE_DAYS) {
            return { error: `删除范围太长了喵~ 一次最多 ${MAX_DELETE_DAYS} 天` }
        }
        const restText = tokens.slice(index).join(' ').trim()
        return { start, end, filter: this._parseDeleteFilter(restText) }
    }

    /**
     * 解析删除条件
     * @param {string} text
     * @returns {{kind: string, keyword?: string, from?: number, to?: number, startTime?: string, endTime?: string}}
     */
    _parseDeleteFilter(text) {
        if (!text) return { kind: 'all' }
        const period = text.match(/^第\s*(\d{1,2})(?:\s*[-~～到至]\s*(\d{1,2}))?\s*节$/)
        if (period) {
            const from = Number(period[1])
            const to = Number(period[2] || period[1])
            if (from >= 1 && to >= from) return { kind: 'period', from, to }
        }
        const range = parseTimeRange(text)
        if (range) return { kind: 'time', ...range }
        const location = text.match(/^(?:地点|教室)[:：]\s*(.+)$/)
        if (location) return { kind: 'location', keyword: location[1].trim() }
        const name = text.match(/^(?:课程|名称|活动名?)[:：]\s*(.+)$/)
        if (name) return { kind: 'name', keyword: name[1].trim() }
        return { kind: 'any', keyword: text }
    }

    /**
     * 逐日收集候选条目并按条件筛选，生成删除计划
     * @param {{start: Date, end: Date, filter: object}} parsed
     * @returns {object} 计划（含 matched 预览条目、activities/courses 待执行动作）
     */
    _buildDeletePlan({ start, end, filter }) {
        const userId = this.e.user_id
        const schedule = DataManager.loadSchedule(userId)
        if (!schedule) return { error: '你还没有设置课表喵~ 先 #导入课表 或 #clsadd 添加活动吧' }
        const entries = []
        const cursor = new Date(start)
        const last = new Date(end)
        while (cursor.getTime() <= last.getTime()) {
            const date = new Date(cursor)
            const dateStr = formatDate(date)
            const day = date.getDay() === 0 ? 7 : date.getDay()
            const week = calculateWeekFromDate(schedule.semesterStart, date)
            if (week !== null) {
                (schedule.courses || []).forEach((course, courseIndex) => {
                    if (parseInt(course.day) !== day) return
                    if (!Array.isArray(course.weeks) || !course.weeks.includes(week)) return
                    entries.push({
                        kind: 'course',
                        dateStr,
                        name: course.name || '未命名课程',
                        location: course.location || '',
                        startTime: course.startTime,
                        endTime: course.endTime,
                        courseIndex,
                        week,
                        fingerprint: fingerprintOfCourse(course)
                    })
                })
            }
            for (const activity of DataManager.getActivitiesForDate(schedule, date)) {
                entries.push({
                    kind: 'activity',
                    dateStr,
                    name: activity.name,
                    location: activity.location || '',
                    startTime: activity.startTime,
                    endTime: activity.endTime,
                    activityId: activity.id
                })
            }
            cursor.setDate(cursor.getDate() + 1)
        }
        const matched = this._filterDeleteEntries(entries, filter)
        const activities = []
        const courses = []
        const seenCourse = new Set()
        for (const entry of matched) {
            if (entry.kind === 'activity') {
                if (!activities.includes(entry.activityId)) activities.push(entry.activityId)
                continue
            }
            const key = `${entry.courseIndex}-${entry.week}`
            if (seenCourse.has(key)) continue
            seenCourse.add(key)
            courses.push({ index: entry.courseIndex, week: entry.week, fingerprint: entry.fingerprint })
        }
        matched.sort((a, b) => a.dateStr.localeCompare(b.dateStr) || timeToMinutes(a.startTime) - timeToMinutes(b.startTime))
        return {
            rangeText: filter.kind === 'all' && start.getTime() === end.getTime()
                ? formatDate(start)
                : `${formatDate(start)} ~ ${formatDate(end)}`,
            matched,
            activities,
            courses
        }
    }

    /**
     * 按条件筛选条目
     * @param {Array} entries
     * @param {object} filter
     * @returns {Array}
     */
    _filterDeleteEntries(entries, filter) {
        switch (filter.kind) {
            case 'all':
                return [...entries]
            case 'period': {
                // 「第几节」= 按开始时间排序后的第几个条目（跨多天时先按日期再按时间）
                const sorted = [...entries].sort((a, b) =>
                    a.dateStr.localeCompare(b.dateStr) || timeToMinutes(a.startTime) - timeToMinutes(b.startTime))
                return sorted.slice(filter.from - 1, filter.to)
            }
            case 'time': {
                const startMinutes = timeToMinutes(filter.startTime)
                const endMinutes = timeToMinutes(filter.endTime)
                return entries.filter(entry =>
                    timeToMinutes(entry.startTime) < endMinutes && startMinutes < timeToMinutes(entry.endTime))
            }
            case 'name':
                return entries.filter(entry => String(entry.name).includes(filter.keyword))
            case 'location':
                return entries.filter(entry => String(entry.location).includes(filter.keyword))
            case 'any':
            default:
                return entries.filter(entry =>
                    String(entry.name).includes(filter.keyword)
                    || String(entry.location).includes(filter.keyword))
        }
    }

    /** 删除预览文本 */
    _formatDeletePreview(plan) {
        const kindLabel = (entry) => (entry.kind === 'activity' ? '📌' : '📘')
        let reply = `🗑 待删除 ${plan.matched.length} 条（${plan.rangeText}）\n`
        reply += '='.repeat(22) + '\n'
        plan.matched.slice(0, MAX_PREVIEW_ITEMS).forEach((entry, index) => {
            const location = entry.location ? `（${clip(entry.location, 12)}）` : ''
            reply += `${index + 1}. ${entry.dateStr} ${entry.startTime}-${entry.endTime} `
                + `${kindLabel(entry)} ${clip(entry.name, 16)}${location}\n`
        })
        if (plan.matched.length > MAX_PREVIEW_ITEMS) {
            reply += `…还有 ${plan.matched.length - MAX_PREVIEW_ITEMS} 条\n`
        }
        reply += '\n📌=活动（整条删除）　📘=课程（只删该日期这一次，其它周次保留）'
        reply += '\n\n回复「确认」执行删除，回复「取消」放弃喵~'
        return reply
    }

    /** 确认删除（上下文回调） */
    async clsdel_confirm() {
        const key = sessionKey(this.e.user_id, this.e.self_id)
        const pending = pendingDeletes.get(key)
        const finishAll = () => {
            pendingDeletes.delete(key)
            this.finish('clsdel_confirm')
        }
        if (!pending || Date.now() - pending.at > SESSION_TTL_MS) {
            finishAll()
            await this.reply('这次删除已经超时啦，请重新发送 #clsdel 喵~')
            return true
        }
        const text = String(this.e.msg || '').trim()
        if (/^(取消|放弃|cancel)/i.test(text)) {
            finishAll()
            await this.reply('已取消删除喵~')
            return true
        }
        if (!/^(确认|确定|好|可以|是|yes|y|ok)$/i.test(text)) {
            await this.reply('回复「确认」执行删除，或回复「取消」放弃喵~')
            return true
        }
        finishAll()
        const result = this._applyDeletePlan(pending.plan)
        if (result.error) {
            await this.reply(result.error)
            return true
        }
        let reply = `✅ 删除完成\n`
        reply += `📌 活动：${result.activityCount} 条\n`
        reply += `📘 课程：${result.courseCount} 条（仅删除所选日期的这一次，其它周次保留）`
        if (result.mismatch) {
            reply += '\n\n⚠️ 部分条目在这期间被修改过，已跳过未删除'
        }
        await this.reply(reply)
        return true
    }

    /**
     * 执行删除计划
     * @param {object} plan
     * @returns {{activityCount?: number, courseCount?: number, mismatch?: boolean, error?: string}}
     */
    _applyDeletePlan(plan) {
        const userId = this.e.user_id
        const schedule = DataManager.loadSchedule(userId)
        if (!schedule) return { error: '课表数据不见了，请重新 #导入课表 喵~' }
        let mismatch = false
        // 课程：只去掉对应周次（数据被改动过则跳过）
        const changes = new Map()
        for (const removal of plan.courses) {
            const course = (schedule.courses || [])[removal.index]
            if (!course || fingerprintOfCourse(course) !== removal.fingerprint) {
                mismatch = true
                continue
            }
            if (!changes.has(removal.index)) {
                changes.set(removal.index, { course, weeks: new Set(Array.isArray(course.weeks) ? course.weeks : []) })
            }
            changes.get(removal.index).weeks.delete(removal.week)
        }
        let courseCount = 0
        for (const { course, weeks } of changes.values()) {
            course.weeks = Array.from(weeks).filter(w => Number.isFinite(Number(w))).map(Number).sort((a, b) => a - b)
            courseCount++
        }
        // 周次被清空的课程整体移除（等于这门课在这天彻底没了）
        schedule.courses = (schedule.courses || []).filter(course =>
            Array.isArray(course.weeks) && course.weeks.length > 0)
        // 活动：整条移除
        const removeIds = new Set(plan.activities)
        const before = DataManager.normalizeActivities(schedule.activities)
        const rest = before.filter(item => !removeIds.has(item.id))
        const activityCount = before.length - rest.length
        schedule.activities = rest
        // 一次写入同时落盘课程与活动（saveSchedule 会保留 nickname/signature/timeSlots）
        DataManager.saveSchedule(userId, schedule)
        return { courseCount, activityCount, mismatch }
    }
}

export default ScheduleActivity

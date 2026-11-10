// services/calendarSync.js
// 日历同步：把用户自己的手机日历（CalDAV 账号 / Exchange 发布的 ICS 订阅链接 / 任意 ICS 直链）
// 拉进来，事件在本插件里表现为**活动**（空心圆点标记），与课程同样展示、随 #清除课表 一起清除。
//
// 方向说明（重要）：本模块是「拉取式」——
//   用户在手机/电脑日历里增删改 → 日历服务器 → 本插件定时拉取 → 课表里的活动随之更新。
//   因此不需要在本机开端口、不涉及 TLS，也不会把课表推给第三方。
//
// 支持的接入方式：
//   1. caldav：标准 CalDAV 日历集合地址 + 账号密码（Nextcloud / Radicale / Zimbra / 腾讯企业邮 等）
//   2. ics：一个 .ics 直链（Exchange/Outlook 的「发布日历」链接、iCloud 共享日历、学校导出的 ICS 都行）
//   Exchange Online 本身不提供 CalDAV，但 OWA 可以「发布日历」得到 ICS 订阅链接，用 ics 方式接入即可。
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import ICalExpander from 'ical-expander'
import { ConfigManager } from '../components/ConfigManager.js'
import { DataManager } from '../components/DataManager.js'
import { normalizeIcsTimezoneIds } from '../utils/icsTimezone.js'
import { formatDate, normalizeTimeValue, isValidHm } from '../utils/timeUtils.js'

/** 支持的接入方式 */
export const CALENDAR_PROVIDERS = ['ics', 'caldav']
/** 拉取超时 / 响应体上限（ICS 通常几十到几百 KB） */
const FETCH_TIMEOUT_MS = 20000
const MAX_ICS_BYTES = 5 * 1024 * 1024
/** 凭据密钥文件（与数据文件同目录，尽量避免随仓库外泄；.gitignore 已忽略 data/） */
const SECRET_KEY_FILE = path.join(process.cwd(), 'plugins/schedule/data/.calendar-key')

/**
 * 规范化接入方式
 * @param {*} value
 * @returns {'ics'|'caldav'}
 */
export function normalizeProvider(value) {
    const mode = typeof value === 'string' ? value.trim().toLowerCase() : ''
    return CALENDAR_PROVIDERS.includes(mode) ? mode : 'ics'
}

/**
 * 判断地址是否为内网/本机（默认禁止，避免把 bot 当成内网探测器）
 * @param {string} hostname
 * @returns {boolean}
 */
export function isPrivateHostname(hostname) {
    const host = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase()
    if (!host) return true
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true
    const family = net.isIP(host)
    if (family === 4) {
        const parts = host.split('.').map(Number)
        if (parts[0] === 10 || parts[0] === 127 || parts[0] === 0) return true
        if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true
        if (parts[0] === 192 && parts[1] === 168) return true
        if (parts[0] === 169 && parts[1] === 254) return true
        if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true
        return parts[0] >= 224
    }
    if (family === 6) {
        if (host === '::1' || host === '::') return true
        if (/^fe[89ab]/.test(host) || /^f[cd]/.test(host) || /^ff/.test(host)) return true
        if (host.includes('::ffff:')) {
            const embedded = host.split('::ffff:').pop()
            if (embedded.includes('.')) return isPrivateHostname(embedded)
        }
        return false
    }
    return false
}

/**
 * 校验日历地址（协议/账号信息/长度/内网）
 * @param {string} rawUrl
 * @param {{ allowPrivateHost?: boolean }} [options]
 * @returns {{ ok: boolean, url?: URL, message?: string }}
 */
export function validateCalendarUrl(rawUrl, { allowPrivateHost = false } = {}) {
    let url
    try {
        url = new URL(String(rawUrl || '').trim())
    } catch {
        return { ok: false, message: '日历地址格式不正确，请提供完整的 http(s):// 地址' }
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return { ok: false, message: '仅支持 http/https 的日历地址' }
    }
    if (url.username || url.password) {
        return { ok: false, message: '请不要把账号密码写在地址里，改用「#日历绑定」后面的账号、密码参数' }
    }
    if (url.href.length > 2048) return { ok: false, message: '日历地址过长（超过 2048 字符）' }
    if (!url.hostname) return { ok: false, message: '日历地址缺少主机名' }
    if (!allowPrivateHost && isPrivateHostname(url.hostname)) {
        return { ok: false, message: '不建议绑定内网/本机地址；确需绑定请让 Bot 主在配置中打开 calendarAllowPrivateHost' }
    }
    return { ok: true, url }
}

// ==================== 凭据加密（AES-256-GCM） ====================
/** 读取或生成凭据加密密钥（首次使用时创建，文件权限尽力设为 600） */
function getSecretKey() {
    try {
        if (fs.existsSync(SECRET_KEY_FILE)) {
            const raw = fs.readFileSync(SECRET_KEY_FILE, 'utf8').trim()
            const key = Buffer.from(raw, 'base64')
            if (key.length === 32) return key
        }
    } catch { /* 落到下面重新生成 */ }
    const key = crypto.randomBytes(32)
    try {
        const dir = path.dirname(SECRET_KEY_FILE)
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(SECRET_KEY_FILE, key.toString('base64'), { mode: 0o600 })
    } catch (err) {
        logger.warn(`[日历同步] 凭据密钥写入失败（本次使用临时密钥）: ${err}`)
    }
    return key
}

/**
 * 加密凭据（账号密码不落明文）
 * @param {string} plain
 * @returns {string} base64(iv + tag + ciphertext)
 */
export function encryptSecret(plain) {
    const text = String(plain ?? '')
    if (!text) return ''
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', getSecretKey(), iv)
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

/**
 * 解密凭据
 * @param {string} payload
 * @returns {string} 解密失败返回空字符串（视为未配置密码）
 */
export function decryptSecret(payload) {
    const raw = String(payload ?? '')
    if (!raw) return ''
    try {
        const buffer = Buffer.from(raw, 'base64')
        if (buffer.length <= 28) return ''
        const iv = buffer.subarray(0, 12)
        const tag = buffer.subarray(12, 28)
        const ciphertext = buffer.subarray(28)
        const decipher = crypto.createDecipheriv('aes-256-gcm', getSecretKey(), iv)
        decipher.setAuthTag(tag)
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
    } catch {
        return ''
    }
}

// ==================== 拉取 ====================
/**
 * 发起带 Basic 认证的请求（限制大小与超时）
 * @returns {Promise<{ ok: boolean, status: number, body: string }>}
 */
async function requestCalendar(url, { method = 'GET', body = null, headers = {}, username = '', password = '' } = {}) {
    const auth = username
        ? { Authorization: `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}` }
        : {}
    const response = await fetch(url, {
        method,
        headers: {
            'User-Agent': 'Yunzai-Schedule-Plugin/1.0 (calendar sync)',
            ...auth,
            ...headers
        },
        body,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    })
    const contentLength = Number(response.headers.get('content-length') || 0)
    if (contentLength > MAX_ICS_BYTES) {
        throw new Error(`日历内容过大（${(contentLength / 1024 / 1024).toFixed(1)}MB），请缩小时间范围`)
    }
    const text = await response.text()
    if (text.length > MAX_ICS_BYTES) {
        throw new Error('日历内容过大，请缩小时间范围')
    }
    return { ok: response.ok, status: response.status, body: text }
}

/** 把 CalDAV 多状态响应的 calendar-data 片段合并成一个 VCALENDAR 文本 */
function assembleCalDavIcs(xml) {
    const unescapeXml = (text) => String(text)
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'").replace(/&#13;/g, '\r').replace(/&amp;/g, '&')
    const blocks = []
    const dataRe = /<(?:[a-zA-Z0-9]+:)?calendar-data[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9]+:)?calendar-data>/gi
    let match
    while ((match = dataRe.exec(xml)) !== null) {
        const data = unescapeXml(match[1]).trim()
        if (data) blocks.push(data)
    }
    if (blocks.length === 0) return ''
    const timezones = []
    const events = []
    for (const block of blocks) {
        const tzRe = /BEGIN:VTIMEZONE[\s\S]*?END:VTIMEZONE/g
        const evRe = /BEGIN:VEVENT[\s\S]*?END:VEVENT/g
        for (const tz of block.match(tzRe) || []) timezones.push(tz)
        for (const ev of block.match(evRe) || []) events.push(ev)
    }
    return [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Yunzai Schedule Plugin//Calendar Sync//CN',
        ...Array.from(new Set(timezones)),
        ...events,
        'END:VCALENDAR'
    ].join('\r\n')
}

/**
 * 归一化为单份 VCALENDAR：
 * 部分日历服务会把多份 VCALENDAR 拼在一起返回（订阅链接合并、分段导出等），
 * 直接交给解析器会丢事件甚至抛错，这里统一抽出 VTIMEZONE/VEVENT 块重新包一层。
 * @param {string} text
 * @returns {string}
 */
function ensureVCalendar(text) {
    const body = String(text || '').trim()
    if (!body) return ''
    const blocks = []
    for (const pattern of [/BEGIN:VTIMEZONE[\s\S]*?END:VTIMEZONE/gi, /BEGIN:VEVENT[\s\S]*?END:VEVENT/gi]) {
        for (const match of body.match(pattern) || []) blocks.push(match)
    }
    if (blocks.length === 0) return ''
    return [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Yunzai Schedule Plugin//Calendar Sync//CN',
        ...Array.from(new Set(blocks)),
        'END:VCALENDAR'
    ].join('\r\n')
}

/**
 * 拉取日历原始 ICS 文本
 * @param {{ provider?: string, url: string, username?: string, password?: string,
 *          allowPrivateHost?: boolean, since?: Date, until?: Date }} binding
 * @returns {Promise<string>} ICS 文本
 */
export async function fetchCalendarIcs(binding) {
    const provider = normalizeProvider(binding.provider)
    const check = validateCalendarUrl(binding.url, { allowPrivateHost: binding.allowPrivateHost === true })
    if (!check.ok) throw new Error(check.message)
    const username = binding.username || ''
    const password = binding.password || ''

    if (provider === 'caldav') {
        const since = binding.since || new Date(Date.now() - 7 * 86400000)
        const until = binding.until || new Date(Date.now() + 60 * 86400000)
        const toIcsTime = (date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
        const body = '<?xml version="1.0" encoding="utf-8" ?>' +
            '<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">' +
            '<d:prop><d:getetag/><c:calendar-data/></d:prop>' +
            '<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">' +
            `<c:time-range start="${toIcsTime(since)}" end="${toIcsTime(until)}"/>` +
            '</c:comp-filter></c:comp-filter></c:filter>' +
            '</c:calendar-query>'
        try {
            const result = await requestCalendar(check.url.href, {
                method: 'REPORT',
                body,
                username,
                password,
                headers: { 'Content-Type': 'application/xml; charset=utf-8', Depth: '1' }
            })
            if (result.ok && /calendar-data/i.test(result.body)) {
                const ics = assembleCalDavIcs(result.body)
                if (ics) return ics
            }
            if (result.status === 401 || result.status === 403) {
                throw new Error('CalDAV 认证失败，请检查账号/密码（部分服务需要「应用专用密码」）')
            }
        } catch (err) {
            if (/认证失败/.test(String(err.message))) throw err
            logger.warn(`[日历同步] CalDAV REPORT 失败，回退为直接读取: ${err.message}`)
        }
        // 回退：地址本身可能就是一个 .ics 或公开日历
        const fallback = await requestCalendar(check.url.href, { username, password })
        if (!fallback.ok) {
            throw new Error(fallback.status === 401
                ? '日历认证失败，请检查账号/密码'
                : `日历服务器返回 HTTP ${fallback.status}`)
        }
        const ics = ensureVCalendar(fallback.body)
        if (!ics) throw new Error('该地址没有返回 ICS 日历内容（可尝试用 ics 方式绑定 .ics 直链）')
        return ics
    }

    // ics：直链订阅（Exchange/Outlook 发布的日历、iCloud 共享链接、学校导出的 ICS）
    const result = await requestCalendar(check.url.href, { username, password })
    if (!result.ok) {
        throw new Error(result.status === 401
            ? '日历认证失败，请检查账号/密码'
            : `日历服务器返回 HTTP ${result.status}，请确认是可直接下载的 .ics 链接`)
    }
    const ics = ensureVCalendar(result.body)
    if (!ics) throw new Error('该地址没有返回 ICS 日历内容')
    return ics
}

// ==================== 解析 ====================
/**
 * 解析 ICS 中的事件（含重复事件展开）
 * @param {string} icsText
 * @param {{ since?: Date, until?: Date, maxEvents?: number }} [options]
 * @returns {Array<{uid: string, summary: string, location: string, start: Date, end: Date, allDay: boolean}>}
 */
export function parseCalendarEvents(icsText, { since, until, maxEvents = 200 } = {}) {
    const text = ensureVCalendar(icsText)
    if (!text) return []
    const from = since || new Date(Date.now() - 7 * 86400000)
    const to = until || new Date(Date.now() + 60 * 86400000)
    const expander = new ICalExpander({ ics: normalizeIcsTimezoneIds(text), maxIterations: 5000 })
    const expanded = expander.between(from, to)
    const occurrences = [...(expanded.events || []), ...(expanded.occurrences || [])]
    const events = []
    for (const occurrence of occurrences) {
        const item = occurrence.item || occurrence
        const rawStart = occurrence.startDate || item.startDate
        const rawEnd = occurrence.endDate || item.endDate
        const start = typeof rawStart?.toJSDate === 'function' ? rawStart.toJSDate() : rawStart
        const end = typeof rawEnd?.toJSDate === 'function' ? rawEnd.toJSDate() : rawEnd
        if (!(start instanceof Date) || isNaN(start)) continue
        const endDate = (end instanceof Date && !isNaN(end) && end > start) ? end : new Date(start.getTime() + 60 * 60 * 1000)
        const allDay = !!(rawStart?.isDate || item.startDate?.isDate)
        const summary = String(item.summary || '').trim() || '（未命名事件）'
        const location = String(item.location || '').trim()
        events.push({
            uid: String(item.uid || `${summary}-${formatDate(start)}`).trim(),
            summary,
            location,
            start,
            end: endDate,
            allDay
        })
        if (events.length >= maxEvents) break
    }
    return events
}

/**
 * 事件 → 活动对象（与课程同一套渲染，多带 source/externalUid 标记）
 * @param {Array} events
 * @returns {Array}
 */
export function eventsToActivities(events) {
    const result = []
    for (const event of events) {
        const date = formatDate(event.start)
        let startTime = `${String(event.start.getHours()).padStart(2, '0')}:${String(event.start.getMinutes()).padStart(2, '0')}`
        let endTime = `${String(event.end.getHours()).padStart(2, '0')}:${String(event.end.getMinutes()).padStart(2, '0')}`
        if (event.allDay) {
            // 全天事件：时间字段只为存储合法（解析/校验要求 HH:MM 且结束晚于开始），
            // 展示层看到 allDay=true 会显示「全天」，且不参与任何时间重叠/状态判定
            startTime = '00:00'
            endTime = '23:59'
        }
        startTime = normalizeTimeValue(startTime)
        endTime = normalizeTimeValue(endTime)
        if (!isValidHm(startTime) || !isValidHm(endTime)) continue
        if (endTime <= startTime) continue
        result.push({
            id: `cal-${crypto.createHash('sha1').update(`${event.uid}|${date}|${startTime}`).digest('hex').slice(0, 12)}`,
            name: String(event.summary || '').slice(0, 30),
            location: String(event.location || '').slice(0, 30),
            date,
            startTime,
            endTime,
            createdAt: new Date().toISOString(),
            source: 'calendar',
            externalUid: event.uid,
            // 全天事件：只做「全天」标注，不参与课程的时间判定（不占满全天、不会算成分身中）
            allDay: event.allDay === true
        })
    }
    // 同一天同名同时间的去重（不同日历里重复订阅同一条事件时会出现）
    const seen = new Set()
    return result.filter(item => {
        const key = `${item.date}|${item.name}|${item.startTime}|${item.endTime}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
    })
}

/**
 * 合并：本地活动原样保留，同步窗口内的日历活动整体替换
 * @param {Array} localActivities 现有活动（含 source）
 * @param {Array} calendarActivities 本次拉取到的日历活动
 * @param {{ since?: Date, until?: Date }} [options]
 * @returns {Array}
 */
export function mergeCalendarActivities(localActivities, calendarActivities, { since, until } = {}) {
    const from = formatDate(since || new Date(Date.now() - 7 * 86400000))
    const to = formatDate(until || new Date(Date.now() + 60 * 86400000))
    const kept = (Array.isArray(localActivities) ? localActivities : []).filter(item => {
        const isCalendar = item?.source === 'calendar'
        if (!isCalendar) return true
        // 窗口外的历史日历活动保留；窗口内的由本次拉取结果替换（远端删除→本地同步消失）
        return item.date < from || item.date > to
    })
    return [...kept, ...(Array.isArray(calendarActivities) ? calendarActivities : [])]
}

// ==================== 导出 ICS ====================
/** ICS 文本转义 */
function escapeIcsText(text) {
    return String(text ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r?\n/g, '\\n')
}

/**
 * 生成用户课表 + 活动的 ICS 文本（可导入手机日历，作为「先看再改」的起点）
 * @param {{ nickname?: string, activities?: Array, courses?: Array, semesterStart?: string, weeks?: number }} data
 * @returns {string}
 */export function buildScheduleIcs({ nickname = '', activities = [], courses = [], semesterStart = '', weeks = 20 } = {}) {
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Yunzai Schedule Plugin//Schedule Export//CN',
        'CALSCALE:GREGORIAN',
        `X-WR-CALNAME:${escapeIcsText(nickname ? `${nickname}的课表` : '课表')}`
    ]
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
    const toIcsLocal = (date, time) => {
        const [hour, minute] = String(time).split(':').map(Number)
        const d = new Date(date)
        d.setHours(hour, minute, 0, 0)
        return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}T`
            + `${String(hour).padStart(2, '0')}${String(minute).padStart(2, '0')}00`
    }
    // 活动
    for (const activity of activities) {
        lines.push(
            'BEGIN:VEVENT',
            `UID:${activity.id || `act-${Math.random().toString(36).slice(2)}`}@yunzai-schedule`,
            `DTSTAMP:${stamp}`,
            `DTSTART;TZID=Asia/Shanghai:${toIcsLocal(activity.date, activity.startTime)}`,
            `DTEND;TZID=Asia/Shanghai:${toIcsLocal(activity.date, activity.endTime)}`,
            `SUMMARY:${escapeIcsText(activity.name)}`,
            activity.location ? `LOCATION:${escapeIcsText(activity.location)}` : '',
            'CATEGORIES:活动',
            'END:VEVENT'
        )
    }
    // 课程（按周次展开成单次事件，便于在手机日历里看/改）
    if (semesterStart && Array.isArray(courses) && courses.length > 0) {
        const start = new Date(semesterStart)
        if (!isNaN(start)) {
            const monday = new Date(start)
            monday.setHours(0, 0, 0, 0)
            monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
            for (const course of courses) {
                const day = Number(course.day)
                if (!Number.isInteger(day) || day < 1 || day > 7) continue
                for (const week of Array.isArray(course.weeks) ? course.weeks : []) {
                    const date = new Date(monday)
                    date.setDate(monday.getDate() + (Number(week) - 1) * 7 + (day - 1))
                    if (Number(week) < 1 || Number(week) > Math.max(20, Number(weeks) || 20)) continue
                    lines.push(
                        'BEGIN:VEVENT',
                        `UID:${crypto.createHash('sha1').update(`${course.name}|${course.day}|${course.startTime}|${formatDate(date)}`).digest('hex').slice(0, 16)}@yunzai-schedule`,
                        `DTSTAMP:${stamp}`,
                        `DTSTART;TZID=Asia/Shanghai:${toIcsLocal(date, course.startTime)}`,
                        `DTEND;TZID=Asia/Shanghai:${toIcsLocal(date, course.endTime)}`,
                        `SUMMARY:${escapeIcsText(course.name)}`,
                        course.teacher ? `DESCRIPTION:${escapeIcsText(course.teacher)}` : '',
                        course.location ? `LOCATION:${escapeIcsText(course.location)}` : '',
                        'CATEGORIES:课程',
                        'END:VEVENT'
                    )
                }
            }
        }
    }
    lines.push('END:VCALENDAR')
    return lines.filter(line => line !== '').join('\r\n')
}

// ==================== 同步编排 ====================
/** 夹取值到 [min, max]，非法值回退默认 */
function clampNumber(value, min, max, fallback) {
    const num = Number(value)
    if (!Number.isFinite(num)) return fallback
    return Math.min(max, Math.max(min, Math.round(num)))
}

/**
 * 读取同步窗口与上限（来自配置）
 * @returns {{ since: Date, until: Date, maxEvents: number }}
 */
export function getSyncWindow() {
    const config = ConfigManager.getConfig()
    const daysBefore = clampNumber(config.calendarSyncDaysBefore, 0, 60, 7)
    const daysAfter = clampNumber(config.calendarSyncDaysAfter, 1, 365, 60)
    const maxEvents = clampNumber(config.calendarMaxEvents, 1, 1000, 150)
    return {
        since: new Date(Date.now() - daysBefore * 86400000),
        until: new Date(Date.now() + daysAfter * 86400000),
        maxEvents
    }
}

/**
 * 同步单个用户的日历：拉取 → 解析 → 合并 → 落盘 → 记录绑定状态
 * 合并规则：本地活动（source=local）保留；同步窗口内的日历活动整体替换（远端删除 → 本地同步消失）
 * @param {string|number} userId
 * @returns {Promise<{ ok: boolean, message: string, count?: number, localKept?: number }>}
 */
export async function syncUserCalendar(userId) {
    const binding = DataManager.getCalendarBinding(userId)
    if (!binding || !binding.url) {
        return { ok: false, message: '还没有绑定日历喵~ 发送 #日历绑定 查看用法' }
    }
    if (binding.enabled === false) {
        return { ok: false, message: '日历同步已关闭，可重新发送 #日历绑定 开启' }
    }
    const config = ConfigManager.getConfig()
    const { since, until, maxEvents } = getSyncWindow()
    try {
        const ics = await fetchCalendarIcs({
            provider: binding.provider,
            url: binding.url,
            username: binding.username,
            password: decryptSecret(binding.secret),
            allowPrivateHost: config.calendarAllowPrivateHost === true,
            since,
            until
        })
        const events = parseCalendarEvents(ics, { since, until, maxEvents })
        const remote = eventsToActivities(events)
        const local = DataManager.getActivities(userId)
        const merged = mergeCalendarActivities(local, remote, { since, until })
        if (!DataManager.saveActivities(userId, merged)) {
            throw new Error('活动写入失败（数据文件不可写）')
        }
        DataManager.setCalendarBinding(userId, {
            lastSyncAt: new Date().toISOString(),
            lastResult: 'ok',
            lastError: '',
            eventCount: remote.length
        })
        const localKept = merged.filter(item => item.source !== 'calendar').length
        return {
            ok: true,
            count: remote.length,
            localKept,
            message: `✅ 日历同步完成：拉取到 ${remote.length} 个事件，保留本地活动 ${localKept} 条`
        }
    } catch (err) {
        const message = String(err?.message || err).slice(0, 200)
        DataManager.setCalendarBinding(userId, {
            lastSyncAt: new Date().toISOString(),
            lastResult: 'error',
            lastError: message
        })
        return { ok: false, message: `同步失败：${message}` }
    }
}


// apps/calendar.js
// 日历接入：把用户自己的手机日历（CalDAV 账号 / Exchange 发布的 ICS 订阅链接 / 任意 .ics 直链）
// 拉进课表，事件表现为**活动**（空心圆点标记），与课程一起展示、随 #清除课表 一起清除。
//
// 为什么是「拉取」：手机日历里的增删改都发生在日历服务器上，插件定时拉取即同步，
// 不需要在本机开端口、不需要给第三方推送数据。真正的「双向写入」需要以本插件充当
// CalDAV 服务端（公开 HTTPS + 证书），属于后续计划，这里用 #日历导出 给出 ICS 作为过渡。
import fs from 'node:fs'
import path from 'node:path'
import { DataManager } from '../components/DataManager.js'
import { ConfigManager } from '../components/ConfigManager.js'
import { SchedulePlugin } from '../components/GroupAccess.js'
import { startCalendarSyncScheduler, reloadCalendarSyncScheduler, syncAllCalendars } from '../components/CalendarScheduler.js'
import {
    normalizeProvider,
    validateCalendarUrl,
    encryptSecret,
    decryptSecret,
    fetchCalendarIcs,
    parseCalendarEvents,
    eventsToActivities,
    buildScheduleIcs,
    syncUserCalendar,
    getSyncWindow
} from '../services/calendarSync.js'
import { formatDate } from '../utils/timeUtils.js'

/** 隐藏地址里的敏感部分（只展示主机 + 路径前缀） */
function maskUrl(url) {
    try {
        const parsed = new URL(url)
        const pathname = parsed.pathname.length > 18 ? `${parsed.pathname.slice(0, 18)}…` : parsed.pathname
        return `${parsed.protocol}//${parsed.host}${pathname}`
    } catch {
        return '（地址无效）'
    }
}

/** 时间戳 → "YYYY-MM-DD HH:mm" */
function formatTime(iso) {
    const date = new Date(iso)
    if (isNaN(date)) return '未知'
    const pad = (n) => String(n).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export class ScheduleCalendar extends SchedulePlugin {
    constructor() {
        super({
            name: '[Schedule] 日历同步',
            dsc: '把手机日历（CalDAV / Exchange 发布日历 / ICS）接进课表',
            event: 'message',
            priority: 1000,
            rule: [
                { reg: '^#日历绑定(?:\\s+([\\s\\S]+))?$', fnc: 'bindCalendar' },
                { reg: '^#日历同步$', fnc: 'syncCalendar' },
                { reg: '^#日历状态$', fnc: 'calendarStatus' },
                { reg: '^#日历解绑$', fnc: 'unbindCalendar' },
                { reg: '^#日历导出$', fnc: 'exportCalendar' },
                { reg: '^#日历帮助$', fnc: 'calendarHelp' }
            ]
        })
        // 兜底启动定时同步（内部有全局守卫，重复实例不会重复启动）
        startCalendarSyncScheduler()
    }

    /** 用法说明 */
    _usage() {
        return '📅 日历接入用法\n' +
            '① CalDAV 账号（Nextcloud / Radicale / Zimbra / 腾讯企业邮 等）\n' +
            '   #日历绑定 caldav <日历地址> <账号> <密码>\n' +
            '② ICS 订阅链接（Exchange/Outlook 的「发布日历」、iCloud 共享链接、学校导出的 .ics）\n' +
            '   #日历绑定 ics <链接>\n' +
            '绑定后：手机日历里增删改 → 发送 #日历同步（或等待定时同步）即可在课表里看到，\n' +
            '事件会以「活动」形式出现（群课表空心圆点），#清除课表 会一起清掉。\n' +
            '其它：#日历同步 / #日历状态 / #日历解绑 / #日历导出'
    }

    async calendarHelp() {
        await this.reply(this._usage())
        return true
    }

    /**
     * #日历绑定 <ics|caldav> <地址> [账号] [密码]
     */
    async bindCalendar() {
        const arg = String(this.e.msg || '').replace(/^#日历绑定\s*/, '').trim()
        if (!arg) {
            await this.reply(this._usage())
            return true
        }
        if (ConfigManager.getConfig().calendarSyncEnabled !== true && this.e.isMaster) {
            logger.warn('[日历同步] 总开关 calendarSyncEnabled 未开启，定时同步不会启动（手动 #日历同步 仍可用）')
        }
        const tokens = arg.split(/\s+/)
        const provider = normalizeProvider(tokens[0])
        const url = tokens[1]
        if (!tokens[0] || !url) {
            await this.reply('格式不对喵~\n' + this._usage())
            return true
        }
        let username = tokens[2] || ''
        let password = tokens.slice(3).join(' ') || ''
        // 密码在群里发出来不安全：带密码的绑定只允许私聊
        if (password && this.e.is_group) {
            await this.reply('为了安全，带密码的绑定请私聊我操作喵~（群里请改用 ics 订阅链接）')
            return true
        }
        if (this.e.is_group && provider === 'caldav' && !password) {
            await this.reply('CalDAV 需要账号密码，请私聊我绑定喵~')
            return true
        }
        const config = ConfigManager.getConfig()
        const check = validateCalendarUrl(url, { allowPrivateHost: config.calendarAllowPrivateHost === true })
        if (!check.ok) {
            await this.reply(`❌ ${check.message}`)
            return true
        }
        await this.reply('正在试连日历，请稍候喵~')
        // 先用一次真实拉取验证地址/凭据是否可用，避免存了绑定却一直失败
        const { since, until, maxEvents } = getSyncWindow()
        let ics
        try {
            ics = await fetchCalendarIcs({
                provider,
                url: check.url.href,
                username,
                password,
                allowPrivateHost: config.calendarAllowPrivateHost === true,
                since,
                until
            })
        } catch (err) {
            await this.reply(`❌ 连接日历失败：${err.message}`)
            return true
        }
        const events = parseCalendarEvents(ics, { since, until, maxEvents })
        DataManager.setCalendarBinding(this.e.user_id, {
            provider,
            url: check.url.href,
            username,
            secret: password ? encryptSecret(password) : '',
            enabled: true,
            lastSyncAt: new Date().toISOString(),
            lastResult: 'ok',
            lastError: '',
            eventCount: events.length
        })
        const result = await syncUserCalendar(this.e.user_id)
        reloadCalendarSyncScheduler()
        let reply = `✅ 日历绑定成功（${provider === 'caldav' ? 'CalDAV' : 'ICS 订阅'}）\n`
        reply += `🔗 ${maskUrl(check.url.href)}\n`
        reply += `📥 当前窗口内事件：${events.length} 个`
        reply += result.ok ? `\n${result.message}` : `\n⚠️ ${result.message}`
        reply += '\n\n之后在手机日历里改完，发送 #日历同步 或等定时同步即可喵~'
        await this.reply(reply)
        return true
    }

    /** #日历同步：立即同步自己的日历 */
    async syncCalendar() {
        const binding = DataManager.getCalendarBinding(this.e.user_id)
        if (!binding) {
            await this.reply('你还没有绑定日历喵~\n' + this._usage())
            return true
        }
        await this.reply('正在同步日历，请稍候喵~')
        const result = await syncUserCalendar(this.e.user_id)
        await this.reply(result.message)
        return true
    }

    /** #日历状态：查看绑定与上次同步结果 */
    async calendarStatus() {
        const binding = DataManager.getCalendarBinding(this.e.user_id)
        if (!binding) {
            await this.reply('你还没有绑定日历喵~\n' + this._usage())
            return true
        }
        const activities = DataManager.getActivities(this.e.user_id)
        const calendarCount = activities.filter(item => item.source === 'calendar').length
        const localCount = activities.length - calendarCount
        let reply = '📅 日历绑定状态\n'
        reply += '='.repeat(22) + '\n'
        reply += `方式：${binding.provider === 'caldav' ? 'CalDAV' : 'ICS 订阅'}\n`
        reply += `地址：${maskUrl(binding.url)}\n`
        if (binding.username) reply += `账号：${binding.username}\n`
        if (binding.secret) reply += `密码：已加密保存（${decryptSecret(binding.secret) ? '可解密' : '密钥丢失，需重新绑定'}）\n`
        reply += `上次同步：${binding.lastSyncAt ? formatTime(binding.lastSyncAt) : '从未'}\n`
        reply += `上次结果：${binding.lastResult === 'error' ? `❌ ${binding.lastError || '失败'}` : '✅ 成功'}\n`
        reply += `当前活动：日历 ${calendarCount} 条 / 本地 ${localCount} 条\n`
        if (ConfigManager.getConfig().calendarSyncEnabled !== true) {
            reply += '\n⚠️ Bot 主未开启定时同步（calendarSyncEnabled），需要手动 #日历同步'
        }
        await this.reply(reply)
        return true
    }

    /** #日历解绑：删除绑定，并清掉从日历同步来的活动（本地添加的保留） */
    async unbindCalendar() {
        const binding = DataManager.getCalendarBinding(this.e.user_id)
        if (!binding) {
            await this.reply('你还没有绑定日历喵~')
            return true
        }
        const activities = DataManager.getActivities(this.e.user_id)
        const kept = activities.filter(item => item.source !== 'calendar')
        const removed = activities.length - kept.length
        DataManager.removeCalendarBinding(this.e.user_id)
        DataManager.saveActivities(this.e.user_id, kept)
        reloadCalendarSyncScheduler()
        await this.reply(`✅ 已解绑日历，同时清除了 ${removed} 条从日历同步来的活动（本地添加的活动保留）喵~`)
        return true
    }

    /** #日历导出：把课表 + 活动导出成 .ics 文件，方便导入到手机日历 */
    async exportCalendar() {
        const userId = this.e.user_id
        const schedule = DataManager.loadSchedule(userId)
        if (!schedule && DataManager.getActivities(userId).length === 0) {
            await this.reply('你还没有课表/活动喵~ 先 #导入课表 或 #clsadd 添加活动吧')
            return true
        }
        const ics = buildScheduleIcs({
            nickname: schedule?.nickname || '',
            activities: DataManager.getActivities(userId),
            courses: Array.isArray(schedule?.courses) ? schedule.courses : [],
            semesterStart: schedule?.semesterStart,
            weeks: 20
        })
        const tmpDir = path.join(process.cwd(), 'data', 'temp')
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })
        const fileName = `schedule_${String(userId).replace(/[\\/:*?"<>|]/g, '_')}_${Date.now()}.ics`
        const filePath = path.join(tmpDir, fileName)
        try {
            fs.writeFileSync(filePath, ics, 'utf8')
            if (this.e.is_group) {
                await this.reply('课表已导出为 .ics 文件发到群里了喵~ 建议在电脑/手机上用日历 App 导入，避免泄露给群友', false)
                await this.e.group.sendFile(filePath, fileName)
            } else {
                await this.e.friend.sendFile(filePath, fileName)
            }
            setTimeout(() => {
                try { fs.unlinkSync(filePath) } catch { /* 忽略清理失败 */ }
            }, 5000)
        } catch (err) {
            logger.error(`[日历导出] 发送文件失败: ${err}`)
            await this.reply('❌ 导出失败，请稍后重试喵~')
            try { fs.unlinkSync(filePath) } catch { /* 忽略 */ }
        }
        return true
    }
}

export default ScheduleCalendar

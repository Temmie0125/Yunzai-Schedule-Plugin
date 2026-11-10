// components/CalendarScheduler.js
// 日历定时同步：按配置间隔，把所有已绑定（且已启用）用户的日历拉一遍
// 定时器存全局对象，避免模块重载重复启动；与课表推送共用「失败不影响其他用户」的隔离策略
import { ConfigManager } from './ConfigManager.js'
import { DataManager } from './DataManager.js'
import { syncUserCalendar } from '../services/calendarSync.js'
import { debugLog } from './common.js'

let globalTimer = global.__schedule_calendar_timer__ || null
let running = false

/** 执行一轮同步（导出以便单测与手动触发） */
export async function syncAllCalendars() {
    if (running) return { skipped: true, total: 0, ok: 0, failed: 0 }
    running = true
    try {
        const bindings = DataManager.getEnabledCalendarBindings()
        if (bindings.length === 0) {
            debugLog('info', '[日历同步] 没有已绑定的用户，跳过本轮')
            return { skipped: false, total: 0, ok: 0, failed: 0 }
        }
        let ok = 0
        let failed = 0
        for (const { userId } of bindings) {
            try {
                const result = await syncUserCalendar(userId)
                if (result.ok) {
                    ok++
                    debugLog('info', `[日历同步] 用户 ${userId} 同步成功：${result.count} 个事件`)
                } else {
                    failed++
                    logger.warn(`[日历同步] 用户 ${userId} 同步失败：${result.message}`)
                }
            } catch (err) {
                failed++
                logger.error(`[日历同步] 用户 ${userId} 同步异常: ${err}`)
            }
        }
        logger.mark(`[日历同步] 本轮完成：成功 ${ok} / 失败 ${failed}（共 ${bindings.length} 个绑定）`)
        return { skipped: false, total: bindings.length, ok, failed }
    } finally {
        running = false
    }
}

/** 启动定时同步（总开关关闭或间隔非法时不启动） */
export function startCalendarSyncScheduler() {
    if (globalTimer) {
        debugLog('info', '[日历同步] 定时器已在运行，跳过启动')
        return globalTimer
    }
    const config = ConfigManager.getConfig()
    if (config.calendarSyncEnabled !== true) {
        debugLog('info', '[日历同步] 总开关未开启，跳过启动定时器')
        return null
    }
    const intervalMinutes = Number(config.calendarSyncInterval) > 0 ? Number(config.calendarSyncInterval) : 30
    globalTimer = setInterval(() => {
        syncAllCalendars().catch(err => logger.error(`[日历同步] 定时同步异常: ${err}`))
    }, intervalMinutes * 60 * 1000)
    global.__schedule_calendar_timer__ = globalTimer
    logger.info(`[日历同步] 定时器已启动，间隔 ${intervalMinutes} 分钟`)
    return globalTimer
}

/** 停止定时同步 */
export function stopCalendarSyncScheduler() {
    if (globalTimer) {
        clearInterval(globalTimer)
        globalTimer = null
        global.__schedule_calendar_timer__ = null
        logger.info('[日历同步] 定时器已停止')
    }
}

/** 重载定时同步（先停后起） */
export async function reloadCalendarSyncScheduler() {
    stopCalendarSyncScheduler()
    startCalendarSyncScheduler()
}

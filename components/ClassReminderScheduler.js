// components/ClassReminderScheduler.js
import { DataManager } from './DataManager.js';
import { ConfigManager } from './ConfigManager.js';
import { checkFriend, debugLog } from './common.js';

// 使用全局对象存储定时器，避免模块重载时重复启动
let globalTimer = global.__schedule_class_reminder_timer__ || null;

// 已提醒记录：Map<key, timestamp>，key = `${userId}-${dateStr}-${index}-${startTime}`
// 用于保证同一节课在提醒窗口内只提醒一次
let remindedCache = global.__schedule_class_reminder_cache__ || new Map();
global.__schedule_class_reminder_cache__ = remindedCache;

/**
 * 生成某条课程的提醒唯一键
 * @param {string|number} userId
 * @param {string} dateStr YYYY-MM-DD
 * @param {object} course
 * @returns {string}
 */
function buildReminderKey(userId, dateStr, course) {
    return `${userId}-${dateStr}-${course.name}-${course.startTime}`;
}

/**
 * 将 "HH:MM" 转为当天的 Date 对象
 * @param {string} hhmm
 * @param {Date} baseDate 用于取年月日的基准日期
 * @returns {Date|null}
 */
function timeToDate(hhmm, baseDate) {
    if (!hhmm || typeof hhmm !== 'string') return null;
    const m = hhmm.match(/^(\d{1,2}):(\d{2})/);
    if (!m) return null;
    const d = new Date(baseDate);
    d.setHours(parseInt(m[1], 10), parseInt(m[2], 10), 0, 0);
    return d;
}

/**
 * 格式化提醒文本
 * @param {object} course
 * @param {number} remainMinutes
 * @returns {string}
 */
function formatReminderText(course, remainMinutes) {
    const weekdayMap = { 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 7: '周日' };
    const day = Number(course.day);
    const lines = [
        `⏰ 距离上课还有约 ${remainMinutes} 分钟，该去上课啦！`,
        '━━━━━━━━━━━━',
        `📚 ${course.name || '未知课程'}`,
        `🕐 ${course.startTime} - ${course.endTime}${weekdayMap[day] ? `（${weekdayMap[day]}）` : ''}`,
        `👨‍🏫 ${course.teacher || '未知教师'}`,
        `📍 ${course.location || '未知地点'}`
    ];
    return lines.join('\n');
}

/**
 * 执行一次扫描
 */
export async function scanClassReminders() {
    const config = ConfigManager.getConfig();
    if (config.classReminderEnabled !== true) {
        return;
    }
    const users = await DataManager.getAllClassReminderUsers();
    if (!users.length) return;

    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    debugLog('info', `[上课提醒] 开始扫描，共 ${users.length} 个开启提醒的用户`);

    for (const userId of users) {
        try {
            const { enabled, threshold } = await DataManager.getClassReminderConfig(userId);
            if (!enabled) continue;
            const remindMinutes = Number(threshold) > 0 ? Number(threshold) : 10;

            // 好友校验
            if (!checkFriend(userId)) {
                continue;
            }

            const schedule = DataManager.loadSchedule(userId);
            if (!schedule) continue;

            // 学期结束自动关闭
            if (DataManager.isSemesterEnded(schedule, now)) {
                await DataManager.setClassReminderConfig(userId, false);
                try {
                    await Bot.pickFriend(userId).sendMsg(
                        `📢 学期已结束，您的上课提醒已自动关闭。如需下学期提醒，请重新设置课表后开启。`
                    );
                } catch (err) {
                    logger.warn(`[上课提醒] 通知用户 ${userId} 学期结束失败: ${err}`);
                }
                logger.mark(`[上课提醒] 用户 ${userId} 学期已结束，已自动关闭上课提醒`);
                continue;
            }

            const result = await DataManager.getCoursesForDate(userId, now);
            if (result.error || !result.courses || !result.courses.length) continue;

            // 找到"开始时间在未来、且距现在 <= 阈值"的最近一节课
            let nearest = null;
            let nearestRemain = Infinity;
            for (const course of result.courses) {
                const start = timeToDate(course.startTime, now);
                if (!start) continue;
                const remainMs = start.getTime() - now.getTime();
                const remainMin = remainMs / 60000;
                // 尚未开始，且在阈值窗口内（0 < remain <= threshold）
                if (remainMin > 0 && remainMin <= remindMinutes && remainMin < nearestRemain) {
                    nearest = course;
                    nearestRemain = remainMin;
                }
            }
            if (!nearest) continue;

            // 去重：同一节课只提醒一次
            const key = buildReminderKey(userId, dateStr, nearest);
            if (remindedCache.has(key)) continue;

            const delayMinutes = Math.max(1, Math.round(nearestRemain));
            try {
                await Bot.pickFriend(userId).sendMsg(formatReminderText(nearest, delayMinutes));
                remindedCache.set(key, Date.now());
                logger.mark(`[上课提醒] 已提醒用户 ${userId}：${nearest.name} ${nearest.startTime}（约 ${delayMinutes} 分钟后）`);
            } catch (err) {
                logger.error(`[上课提醒] 发送提醒给用户 ${userId} 失败: ${err}`);
            }
        } catch (err) {
            logger.error(`[上课提醒] 处理用户 ${userId} 时发生错误: ${err}`);
        }
    }

    // 清理过期缓存（保留最近 2 天，防止内存无限增长）
    const expireBefore = Date.now() - 2 * 24 * 60 * 60 * 1000;
    for (const [k, ts] of remindedCache.entries()) {
        if (ts < expireBefore) remindedCache.delete(k);
    }
}

/**
 * 启动上课提醒扫描器
 * @returns {NodeJS.Timeout|null}
 */
export function startClassReminderScheduler() {
    if (globalTimer) {
        debugLog('info', '[上课提醒] 定时器已在运行，跳过启动');
        return globalTimer;
    }
    const config = ConfigManager.getConfig();
    const enabled = config.classReminderEnabled === true;
    if (!enabled) {
        debugLog('info', '[上课提醒] 总开关未开启，跳过启动定时器');
        return null;
    }
    const intervalMinutes = Number(config.classReminderScanInterval) > 0 ? Number(config.classReminderScanInterval) : 1;
    const interval = intervalMinutes * 60 * 1000;

    globalTimer = setInterval(() => {
        scanClassReminders().catch(err => logger.error(`[上课提醒] 扫描异常: ${err}`));
    }, interval);
    global.__schedule_class_reminder_timer__ = globalTimer;
    logger.info(`[上课提醒] 定时器已启动，间隔 ${intervalMinutes} 分钟`);
    return globalTimer;
}

/**
 * 停止上课提醒扫描器
 */
export function stopClassReminderScheduler() {
    if (globalTimer) {
        clearInterval(globalTimer);
        globalTimer = null;
        global.__schedule_class_reminder_timer__ = null;
        logger.info('[上课提醒] 定时器已停止');
    }
}

/**
 * 重载定时器（先停止再启动）
 */
export async function reloadClassReminderScheduler() {
    debugLog('info', '[上课提醒] 正在重载...');
    stopClassReminderScheduler();
    startClassReminderScheduler();
}

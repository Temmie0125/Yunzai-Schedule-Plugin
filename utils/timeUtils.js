// utils/timeUtils.js

/**
 * 计算当前周数
 * @param {string} semesterStart - 学期开始日期 YYYY-MM-DD
 * @returns {number}
 */
export function calculateCurrentWeek(semesterStart) {
    if (!semesterStart) {
        const defaultStart = new Date('2024-02-26')
        const now = new Date()
        const timeDiff = now.getTime() - defaultStart.getTime()
        const dayDiff = Math.floor(timeDiff / (1000 * 3600 * 24))
        return Math.max(1, Math.ceil(dayDiff / 7))
    }
    const startDate = new Date(semesterStart)
    const now = new Date()
    const dayDiff = Math.floor((now - startDate) / (1000 * 3600 * 24))
    return Math.max(1, Math.ceil(dayDiff / 7))
}

/**
 * 计算剩余时间（当前时间到结束时间）
 */
export function calculateRemainingTime(currentTime, endTime) {
    const [cH, cM] = currentTime.split(':').map(Number)
    const [eH, eM] = endTime.split(':').map(Number)
    const remaining = (eH * 60 + eM) - (cH * 60 + cM)
    if (remaining >= 60) {
        return `${Math.floor(remaining / 60)}小时${remaining % 60}分钟`
    }
    return `${remaining}分钟`
}

/**
 * 计算距离上课时间
 */
export function calculateTimeUntil(currentTime, startTime) {
    const [cH, cM] = currentTime.split(':').map(Number)
    const [sH, sM] = startTime.split(':').map(Number)
    const until = (sH * 60 + sM) - (cH * 60 + cM)
    if (until >= 60) {
        return `${Math.floor(until / 60)}小时${until % 60}分钟`
    }
    return `${until}分钟`
}
/*
 * @Author: Temmie0125 1179755948@qq.com
 * @Date: 2026-03-06 13:42:11
 * @LastEditors: Temmie0125 1179755948@qq.com
 * @LastEditTime: 2026-03-09 01:17:32
 * @FilePath: \实验与作业e:\bot\Yunzai\plugins\schedule\utils\timeUtils.js
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
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
 * 计算目标日期所在的周数（相对于学期开始日期）
 * @param {string} semesterStart 学期开始日期，格式 YYYY-MM-DD
 * @param {Date} targetDate 目标日期
 * @returns {number|null} 周数（第1周开始），若日期早于学期开始则返回 null
 */
export function calculateWeekFromDate(semesterStart, targetDate) {
    const start = new Date(semesterStart);
    if (isNaN(start)) return null;

    const target = new Date(targetDate);
    target.setHours(0, 0, 0, 0);
    start.setHours(0, 0, 0, 0);

    const diffDays = Math.floor((target - start) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return null; // 目标日期在学期开始之前

    const week = Math.floor(diffDays / 7) + 1; // 第1周从学期开始日算起
    return week;
}
/**
 * 解析用户输入的日期字符串（支持 MM-DD、MM.DD、MM/DD、YYYY-MM-DD 等格式）
 * @param {string} input 用户输入（已去除命令前缀）
 * @param {string} semesterStart 学期开始日期，用于跨年判断
 * @returns {Date|null} 解析成功的 Date 对象，失败返回 null
 */
export function parseDateInput(input, semesterStart) {
    // 匹配格式：可选的年份 + 分隔符(-./) + 月份 + 分隔符 + 日期
    const regex = /^(?:(\d{4})[-./])?(\d{1,2})[-./](\d{1,2})$/;
    const match = input.match(regex);
    if (!match) return null;

    let year = match[1] ? parseInt(match[1]) : null;
    const month = parseInt(match[2]);
    const day = parseInt(match[3]);
    let date = new Date;

    // 基本范围校验
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;

    if (!year) {
        // 没有提供年份，使用学期开始年份作为基准
        const startDate = new Date(semesterStart);
        if (isNaN(startDate)) return null;
        year = startDate.getFullYear();

        // 构造日期（使用该年）
        date = new Date(year, month - 1, day);
        date.setHours(0, 0, 0, 0);
        startDate.setHours(0, 0, 0, 0);

        // 如果构造的日期早于学期开始，则年份+1（视为下一年的日期）
        if (date < startDate) {
            year++;
            date = new Date(year, month - 1, day);
        }
    } else {
        // 提供了完整年份，直接构造
        date = new Date(year, month - 1, day);
    }

    // 验证日期是否有效（例如 2月30日会被自动修正，此处检查）
    if (date.getMonth() !== month - 1 || date.getDate() !== day) {
        return null; // 无效日期
    }
    return date;
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
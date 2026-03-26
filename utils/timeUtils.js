// 获取给定日期所在周的周一（周一为一周开始，周日为7）
function getMondayOfSameWeek(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay(); // 0=周日, 1=周一, ..., 6=周六
    // 计算到本周一的偏移：如果day=0（周日），偏移6天；否则偏移 day-1 天
    const offset = day === 0 ? 6 : day - 1;
    d.setDate(d.getDate() - offset);
    return d;
}
/**
 * 计算当前周数
 * @param {string} semesterStart - 学期开始日期 YYYY-MM-DD
 * @returns {number}
 */
export function calculateCurrentWeek(semesterStart) {
    // 处理未设置学期开始的情况（使用默认日期）
    if (!semesterStart) {
        const defaultStart = new Date('2024-02-26'); // 假设默认是周一
        const now = new Date();
        const startMonday = getMondayOfSameWeek(defaultStart);
        const dayDiff = Math.floor((now - startMonday) / (1000 * 3600 * 24));
        return Math.max(1, Math.floor(dayDiff / 7) + 1);
    }

    const startDate = new Date(semesterStart);
    // 获取学期开始日所在周的周一
    const startMonday = getMondayOfSameWeek(startDate);
    const now = new Date();
    const dayDiff = Math.floor((now - startMonday) / (1000 * 3600 * 24));
    // 周数 = 从该周一算起的天数 / 7 向下取整 + 1
    return Math.max(1, Math.floor(dayDiff / 7) + 1);
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

    // 获取学期开始日所在周的周一
    const startMonday = getMondayOfSameWeek(start);
    const target = new Date(targetDate);
    target.setHours(0, 0, 0, 0);
    startMonday.setHours(0, 0, 0, 0);

    const diffDays = Math.floor((target - startMonday) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return null; // 目标日期在学期开始所在周的周一之前

    return Math.floor(diffDays / 7) + 1;
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
/**
 * 根据学期开始日期、周数和星期，计算出对应的具体日期
 * @param {string} semesterStart 学期开始日期 YYYY-MM-DD
 * @param {number} week 周数（>=1）
 * @param {number} day 星期（1=周一，7=周日）
 * @returns {Date|null} 如果计算出的日期有效（在学期开始之后），返回 Date 对象；否则返回 null
 */
export function calculateDateFromWeekAndDay(semesterStart, week, day) {
    const start = new Date(semesterStart);
    if (isNaN(start)) return null;

    const startMonday = getMondayOfSameWeek(start);
    // 目标日期相对于 startMonday 的偏移天数
    const offsetDays = (week - 1) * 7 + (day - 1); // day: 1=周一, 7=周日
    const target = new Date(startMonday);
    target.setDate(startMonday.getDate() + offsetDays);
    return target;
}
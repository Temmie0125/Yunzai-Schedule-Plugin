import { ConfigManager } from "../components/ConfigManager.js";
/**
 * 生成1~31的中文数字映射表
 */
const chineseNumberMap = (() => {
    const digits = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    const map = {};
    // 1~10
    for (let i = 1; i <= 10; i++) {
        if (i === 10) map['十'] = 10;
        else map[digits[i]] = i;
    }
    // 11~19
    for (let i = 11; i <= 19; i++) {
        map['十' + digits[i - 10]] = i;
    }
    // 20~31
    for (let i = 20; i <= 31; i++) {
        const tens = Math.floor(i / 10);
        const units = i % 10;
        let str = digits[tens] + '十';
        if (units !== 0) str += digits[units];
        map[str] = i;
    }
    return map;
})();
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
    let startDateStr = semesterStart;
    if (!startDateStr) {
        // 从配置中读取默认学期开始日期
        const config = ConfigManager.getConfig();
        startDateStr = config.defaultSemesterStart;
        if (!startDateStr) {
            // 最终回退（理论上配置一定存在）
            startDateStr = "2026-03-02";
        }
    }
    const startDate = new Date(startDateStr);
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
/**
 * 获取当前日期 MM-DD
 * @returns MM-DD
 */
export function getCurrentDate() {
    const now = new Date()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    return `${month}-${day}`
}
/**
 * 获取当前日期YYYY-MM-DD
 * @returns YYYY-MM-DD
 */
export function getCurrentFullDate() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
/**
 * 验证并格式化生日（MM-DD）
 * @param {String} birthday 
 * @returns {String} MM-DD
 */
/**
 * 验证并格式化生日（MM-DD）
 * @param {string} birthday 输入字符串，如 "2-30"
 * @returns {{ valid: boolean, formatted: string|null, errorCode?: string }}
 * errorCode: 'invalid_format' | 'nonexistent_date' | 'overflow' | null
 */
export function formatAndValidateBirthday(birthday) {
    const regex = /^(\d{1,2})[-/.](\d{1,2})$/
    const match = birthday.match(regex)
    if (!match) return { valid: false, formatted: null, errorCode: 'invalid_format' }
    let month = parseInt(match[1], 10)
    let day = parseInt(match[2], 10)
    // 月份/日期超出范围（1-12, 1-31）
    if (month < 1 || month > 12 || day < 1 || day > 31) {
        return { valid: false, formatted: null, errorCode: 'overflow' }
    }
    // 使用日期对象验证真实存在性（如 2月30日会被校正为3月2日）
    const testDate = new Date(2000, month - 1, day)  // 年份用2000足够，闰年不影响月日校验
    if (testDate.getMonth() + 1 !== month || testDate.getDate() !== day) {
        return { valid: false, formatted: null, errorCode: 'nonexistent_date' }
    }
    const monthStr = String(month).padStart(2, '0')
    const dayStr = String(day).padStart(2, '0')
    return { valid: true, formatted: `${monthStr}-${dayStr}`, errorCode: null }
}
/**
 * 获取距离下一个生日庆祝日的天数（从 today 开始计算）
 * @param {string} birthdayMMDD 格式 "MM-DD"
 * @returns {number} 剩余天数，0 表示今天就是庆祝日
 */
export function getDaysToBirthday(birthdayMMDD) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const thisYearCeleb = getCelebrationDateOfYear(today.getFullYear(), birthdayMMDD)
    // 如果今年的庆祝日已经过了（或者今天刚好是庆祝日但 today > thisYearCeleb 不会发生，因为今天等于庆祝日时差为0）
    if (today > thisYearCeleb) {
        const nextYearCeleb = getCelebrationDateOfYear(today.getFullYear() + 1, birthdayMMDD)
        return Math.ceil((nextYearCeleb - today) / (1000 * 60 * 60 * 24))
    } else {
        return Math.ceil((thisYearCeleb - today) / (1000 * 60 * 60 * 24))
    }
}

/**
 * 将中文字符串转换为数字（仅支持 1~31）
 * @param {string} str 如 "十一"、"二十一"
 * @returns {number|null}
 */
function chineseToNumber(str) {
    if (/^\d+$/.test(str)) return parseInt(str, 10);
    return chineseNumberMap[str] || null;
}

/**
 * 解析中文日期格式
 * @param {string} input 用户输入，例如 “3月2日”、“十一月十一号”
 * @returns {string|null} 标准 MM-DD 格式，失败返回 null
 */
export function parseChineseDateToMD(input) {
    const regex = /^([\d一二三四五六七八九十]+)月([\d一二三四五六七八九十]+)[日号]?$/;
    const match = input.match(regex);
    if (!match) return null;
    const month = chineseToNumber(match[1]);
    const day = chineseToNumber(match[2]);
    if (month === null || day === null) return null;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * 通用生日字符串解析（数字分隔符 + 中文自然语言）—— 返回详细错误
 * @param {string} birthdayStr
 * @returns {{ valid: boolean, formatted: string|null, errorCode: string|null }}
 */
export function parseBirthdayString(birthdayStr) {
    // 尝试标准数字格式 (MM-DD, MM/DD, MM.DD)
    const numResult = formatAndValidateBirthday(birthdayStr)
    if (numResult.valid) return numResult
    if (numResult.errorCode === 'nonexistent_date' || numResult.errorCode === 'overflow') {
        return numResult   // 日期不存在或超出范围，直接返回
    }
    // 尝试中文自然语言
    const chineseResult = parseChineseDateToMD(birthdayStr)
    if (chineseResult) {
        const chk = formatAndValidateBirthday(chineseResult)
        if (chk.valid) return chk
        if (chk.errorCode === 'nonexistent_date' || chk.errorCode === 'overflow') {
            return chk
        }
    }
    // 最终格式错误
    return { valid: false, formatted: null, errorCode: 'invalid_format' }
}
/**
 * 解析星期几的自然语言表述
 * @param {string} str - 如 "周一", "星期2", "周三", "周日", "星期七", "7"
 * @returns {number|null} 1=周一 ... 7=周日
 */
export function parseWeekday(str) {
    // 纯数字 1~7
    if (/^[1-7]$/.test(str)) {
        return parseInt(str, 10);
    }
    // 中文数字 一 ~ 七
    const chineseMap = {
        '一': 1, '二': 2, '三': 3, '四': 4,
        '五': 5, '六': 6, '七': 7, '日': 7, '天': 7
    };
    // 匹配常见模式：周一 | 星期1 | 周1 | 礼拜一 | 星期天
    const patterns = [
        /(星期|周|礼拜)[\d一二三四五六七日天]/,
        /^[一二三四五六七日天]$/
    ];
    let matched = false;
    let key = '';
    for (const pattern of patterns) {
        const match = str.match(pattern);
        if (match) {
            matched = true;
            key = match[0];
            break;
        }
    }
    if (!matched) return null;

    // 提取最后一个可能是数字或中文数字的字符
    const lastChar = key.slice(-1);
    if (/[1-7]/.test(lastChar)) {
        return parseInt(lastChar, 10);
    }
    return chineseMap[lastChar] || null;
}

/**
 * 根据相对周偏移和星期几计算具体日期
 * @param {number} weekOffset - -1(上周), 0(本周), 1(下周)
 * @param {number} weekday - 1~7 (周一=1, 周日=7)
 * @param {Date} baseDate - 基准日期，默认为当天
 * @returns {Date} 计算得到的目标日期（时间部分归零）
 */
export function getDateByRelativeWeek(weekOffset, weekday, baseDate = new Date()) {
    const base = new Date(baseDate);
    base.setHours(0, 0, 0, 0);
    // 获取基准日期所在周的周一
    const monday = getMondayOfSameWeek(base);
    // 目标日期 = 周一 + (weekOffset * 7 + (weekday - 1)) 天
    const target = new Date(monday);
    target.setDate(monday.getDate() + weekOffset * 7 + (weekday - 1));
    return target;
}
/**
 * 判断是否为闰年
 * @param {number} year
 * @returns {boolean}
 */
export function isLeapYear(year) {
    return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0)
}
/**
 * 获取某个年份中，某个 MM-DD 生日对应的实际庆祝日期（处理 2月29日平年映射到 2月28日）
 * @param {number} year 年份
 * @param {number} month 月份 (1-12)
 * @param {number} day 日期 (1-31)
 * @returns {{ month: number, day: number }} 实际庆祝的月+日
 */
export function getActualCelebrationDate(year, month, day) {
    if (month === 2 && day === 29 && !isLeapYear(year)) {
        return { month: 2, day: 28 }
    }
    return { month, day }
}
/**
 * 获取给定年份中，某人生日的具体 Date 对象（按实际庆祝日期计算）
 * @param {number} year
 * @param {string} birthdayMMDD 格式 "MM-DD"
 * @returns {Date} 该年对应的庆祝日期（时间部分为 00:00:00）
 */
export function getCelebrationDateOfYear(year, birthdayMMDD) {
    const [month, day] = birthdayMMDD.split('-').map(Number)
    const { month: realMonth, day: realDay } = getActualCelebrationDate(year, month, day)
    return new Date(year, realMonth - 1, realDay, 0, 0, 0)
}
/**
 * 判断今天是否为某个人的实际庆祝生日
 * @param {string} birthdayMMDD 用户存储的生日（可能为 "02-29"）
 * @returns {boolean}
 */
export function isTodayCelebration(birthdayMMDD) {
    const today = new Date()
    const year = today.getFullYear()
    const [storeMonth, storeDay] = birthdayMMDD.split('-').map(Number)
    const { month: realMonth, day: realDay } = getActualCelebrationDate(year, storeMonth, storeDay)
    return today.getMonth() + 1 === realMonth && today.getDate() === realDay
}
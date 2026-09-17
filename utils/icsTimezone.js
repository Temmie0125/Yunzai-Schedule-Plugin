// utils/icsTimezone.js
/**
 * ICS 时区名归一化
 *
 * ical.js 只能识别 IANA 时区名；ical-expander 启动时注册的内置时区表（Mozilla zones.json）
 * 虽然包含 China Standard Time 这类 Windows 时区名，但缺少 Asia/Chongqing、Asia/Harbin、
 * PRC 等别名。国内导出的 ICS 常见的非标准 TZID 写法会出现两种问题：
 *  - 中国标准时间 / Asia/Chongqing / UTC+8 等：被当作浮动时间，非东八区主机上导入会偏差 8 小时；
 *  - GMT+08:00 / (UTC+08:00) Beijing, Chongqing, Hong Kong, Urumqi（老版 Outlook 显示名）：直接解析报错，导入失败。
 *
 * 因此在解析前把这些明确表示东八区（UTC+8）的写法统一改写为 Asia/Shanghai。
 * 注意不处理 CST、GMT-8 等有歧义的写法（CST 也指美国中部时间，GMT-8 按标准含义是西八区）。
 */

// 明确表示东八区的 TZID 写法（正则）
const CN_TZID_ALIASES = [
    /^china standard time$/i,          // Windows 时区名（注册表已含，此处双保险）
    /^中国标准时间$/,
    /^北京时间$/,
    /^prc$/i,                          // IANA 链接别名（注册表缺失）
    /^asia\/(?:chongqing|harbin)$/i,   // IANA 历史别名（注册表缺失）
    /^\(utc\+0?8(?::00)?\)\s*beijing,\s*chongqing,\s*hong kong,\s*urumqi$/i, // 老版 Outlook 显示名
    /^(?:utc|gmt)\+0?8(?::00|00)?$/i   // UTC+8 / GMT+08:00 / UTC+0800 等偏移写法
];

function isCnTimezoneAlias(tzid) {
    return CN_TZID_ALIASES.some(re => re.test(tzid.trim()));
}

/**
 * 将 ICS 文本中东八区的非标准 TZID 写法归一化为 Asia/Shanghai。
 * VTIMEZONE 内的时区定义行（TZID:xxx）与 VEVENT 属性中的引用参数（;TZID=xxx:）必须同步替换，
 * 否则事件会找不到对应的时区定义。
 * @param {string} icsText 原始 ICS 文本
 * @returns {string} 归一化后的 ICS 文本
 */
export function normalizeIcsTimezoneIds(icsText) {
    // 先展开折叠行（ICS 规范允许超长行以空格开头折行），避免较长的 TZID 参数值被拆开匹配不到
    const unfolded = icsText.replace(/\r?\n[ \t]/g, '');
    return unfolded.split(/\r?\n/).map(line => {
        // VTIMEZONE 内的时区定义行
        if (/^TZID:/i.test(line)) {
            return isCnTimezoneAlias(line.slice(5)) ? 'TZID:Asia/Shanghai' : line;
        }
        // VEVENT 属性中的引用参数，值可能带引号；GMT+08:00、(UTC+08:00) xx 等写法的值本身含冒号，
        // 因此允许值中再含一段 ":xx"，并以行尾的日期值（如 :20260914T080000Z）为结束锚点
        return line.replace(/;TZID=(?:"([^"]*)"|([^:;]*(?::[^:;]*)?)):(\d{8}(?:T\d{6}Z?)?)$/i, (raw, quoted, plain, dateValue) => {
            const tzid = (quoted !== undefined ? quoted : plain).trim();
            return isCnTimezoneAlias(tzid) ? `;TZID=Asia/Shanghai:${dateValue}` : raw;
        });
    }).join('\r\n');
}

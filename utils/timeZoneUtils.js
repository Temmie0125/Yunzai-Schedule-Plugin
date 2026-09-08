// utils/timeZoneUtils.js
// 时区换算与解析工具（纯函数，不依赖本地模块，避免循环引用）
//
// 表示约定：
// - IANA 时区名：如 "Asia/Shanghai"、"America/New_York"（自动处理夏令时）
// - 固定偏移：规范串 "+08:00" / "-05:00"（无夏令时，纯算术）
// - 'auto' 仅出现在配置层，表示跟随服务器系统时区；解析链末端由 resolveEffectiveTimeZone 展开
//
// 关键思路：星期/周次/学期判断一律在 "YYYY-MM-DD" 日历日域内做纯公历算术
// （Date.UTC 实现，不经过任何本地时区/夏令时）；只有真正需要"绝对时刻"的
// 场景（翘课到期、ICS 跨时区换算）才做墙钟 → 绝对时刻的换算。

// 常见时区中文别名 → IANA（仅收录无歧义常用项）
const CHINESE_TZ_ALIASES = {
  '北京时间': 'Asia/Shanghai',
  '中国标准时间': 'Asia/Shanghai',
  '东京时间': 'Asia/Tokyo',
  '首尔时间': 'Asia/Seoul',
  '新加坡时间': 'Asia/Singapore',
  '台北时间': 'Asia/Taipei',
  '香港时间': 'Asia/Hong_Kong',
  '曼谷时间': 'Asia/Bangkok',
  '印度时间': 'Asia/Kolkata',
  '迪拜时间': 'Asia/Dubai',
  '莫斯科时间': 'Europe/Moscow',
  '柏林时间': 'Europe/Berlin',
  '巴黎时间': 'Europe/Paris',
  '伦敦时间': 'Europe/London',
  '纽约时间': 'America/New_York',
  '美东时间': 'America/New_York',
  '洛杉矶时间': 'America/Los_Angeles',
  '美西时间': 'America/Los_Angeles',
  '芝加哥时间': 'America/Chicago',
  '美中时间': 'America/Chicago',
  '丹佛时间': 'America/Denver',
  '美山时间': 'America/Denver',
  '多伦多时间': 'America/Toronto',
  '温哥华时间': 'America/Vancouver',
  '悉尼时间': 'Australia/Sydney',
  '墨尔本时间': 'Australia/Melbourne',
  '奥克兰时间': 'Pacific/Auckland',
  '夏威夷时间': 'Pacific/Honolulu'
};

// 清除类词：恢复默认解释时区（显式字段删除后回退 importTimeZone → 配置 → 系统）
const CLEAR_TZ_WORDS = new Set(['auto', '清除', 'reset', '默认', '系统', '跟随系统']);

// ---------- 基础 ----------

let _systemTimeZone = null;

/**
 * 获取服务器系统时区（Node 进程/操作系统时区）
 * @returns {string} IANA 时区名，如 "Asia/Shanghai"
 */
export function getSystemTimeZone() {
  if (!_systemTimeZone) {
    try {
      _systemTimeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch (err) {
      _systemTimeZone = 'UTC';
    }
  }
  return _systemTimeZone;
}

/**
 * 解析固定偏移串（含规范 "+08:00" 与宽松形式）
 * @param {*} tz
 * @returns {number|null} 偏移分钟数；不是合法偏移返回 null
 */
function tryParseOffsetMinutes(tz) {
  if (typeof tz !== 'string') return null;
  const m = /^([+-]?)(\d{1,2}):?(\d{2})?$/.exec(tz.trim());
  if (!m) return null;
  const hours = parseInt(m[2], 10);
  const minutes = m[3] ? parseInt(m[3], 10) : 0;
  if (hours > 14 || minutes > 59) return null;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (hours * 60 + minutes);
}

/**
 * 规范化偏移分钟数为规范串 "+08:00"
 * @param {number} minutes
 * @returns {string}
 */
export function formatOffset(minutes) {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  const h = String(Math.floor(abs / 60)).padStart(2, '0');
  const m = String(abs % 60).padStart(2, '0');
  return `${sign}${h}:${m}`;
}

/** 是否为固定偏移表示（如 "+08:00"） */
export function isOffsetNotation(tz) {
  return tryParseOffsetMinutes(tz) !== null;
}

// 大小写不敏感 IANA 索引（懒构建）
let _ianaIndex = null;
function getIanaIndex() {
  if (!_ianaIndex) {
    const names = new Set(['UTC', 'GMT', 'Etc/UTC']);
    try {
      for (const name of Intl.supportedValuesOf('timeZone')) names.add(name);
    } catch (err) {
      // 旧 Node 不支持 supportedValuesOf，仅收录常见名
      for (const n of ['Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul', 'Asia/Taipei', 'Asia/Hong_Kong',
        'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Bangkok',
        'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Moscow',
        'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
        'America/Toronto', 'America/Vancouver', 'Australia/Sydney', 'Australia/Melbourne',
        'Pacific/Auckland', 'Pacific/Honolulu']) names.add(n);
    }
    _ianaIndex = new Map();
    for (const name of names) _ianaIndex.set(name.toLowerCase(), name);
  }
  return _ianaIndex;
}

/**
 * 是否为可用的 IANA 时区名（大小写不敏感）
 * @param {string} tz
 * @returns {boolean}
 */
export function isValidIanaTimeZone(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  const idx = getIanaIndex();
  if (idx.has(tz.toLowerCase())) return true;
  // 索引未覆盖的兜底：交给 Intl 验证
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * 时区有效性总校验（IANA 名或固定偏移串均接受）
 * @param {*} tz
 * @returns {boolean}
 */
export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  if (tryParseOffsetMinutes(tz) !== null) return true;
  return isValidIanaTimeZone(tz);
}

/**
 * 规范化为存储/计算用的标准表示：
 * - IANA 名（经 Intl resolvedOptions 归一化大小写/别名，如 Asia/Calcutta → Asia/Kolkata）
 * - 固定偏移 → 规范串 "+08:00"
 * 非法输入返回 null
 * @param {*} tz
 * @returns {string|null}
 */
export function normalizeTimeZone(tz) {
  if (typeof tz !== 'string' || !tz) return null;
  const trimmed = tz.trim();
  const offset = tryParseOffsetMinutes(trimmed);
  if (offset !== null) return formatOffset(offset);
  if (isValidIanaTimeZone(trimmed)) {
    try {
      const resolved = new Intl.DateTimeFormat('en-US', { timeZone: trimmed }).resolvedOptions().timeZone;
      if (resolved) return resolved;
    } catch (err) { /* 走下方原样返回 */ }
    const idx = getIanaIndex();
    return idx.get(trimmed.toLowerCase()) || trimmed;
  }
  return null;
}

/**
 * 解析用户输入的时区（#设置时区 命令用）
 * 判定顺序：清除类词 → 中文别名 → IANA（大小写不敏感）→ UTC/GMT±n → ±HH:MM/±H/裸整数 → 失败
 * @param {string} input
 * @returns {{ok: boolean, clear?: boolean, timeZone?: string, kind?: 'iana'|'offset', hint?: string}}
 */
export function parseTimeZoneInput(input) {
  if (typeof input !== 'string') return { ok: false };
  const original = input.trim();
  const raw = original.toLowerCase();
  if (!raw) return { ok: false, hint: '参数不能为空' };

  // 1. 清除类：恢复默认（删除显式设置）
  if (CLEAR_TZ_WORDS.has(raw)) {
    return { ok: true, clear: true };
  }

  // 2. 中文别名
  const alias = CHINESE_TZ_ALIASES[original];
  if (alias) {
    return { ok: true, timeZone: alias, kind: 'iana' };
  }

  // 3. 偏移家族（必须先于 IANA 判定：Intl 会接受 "+08:00"/"+0530"/"UTC" 作 timeZone 值，
  //    但语义上它们应归类为固定偏移，而非 IANA 名）
  // 3a. UTC/GMT ±n（无符号按正），及裸 UTC/GMT
  if (raw === 'utc' || raw === 'gmt') {
    return { ok: true, timeZone: '+00:00', kind: 'offset' };
  }
  const utcMatch = /^(?:utc|gmt)\s*([+-]?)(\d{1,2})(?::?(\d{2}))?$/.exec(raw);
  if (utcMatch) {
    const offsetMinutes = parseOffsetFromMatch(utcMatch);
    if (offsetMinutes === null) return { ok: false, hint: '偏移超出合法范围（±14 小时，分钟 ≤59）' };
    return { ok: true, timeZone: formatOffset(offsetMinutes), kind: 'offset' };
  }
  // 3b. 带符号/裸整数偏移：+08:00、-5、+0530、8（裸整数按正偏移）
  const offsetMatch = /^([+-]?)(\d{1,2})(?::?(\d{2}))?$/.exec(raw);
  if (offsetMatch) {
    const offsetMinutes = parseOffsetFromMatch(offsetMatch);
    if (offsetMinutes === null) return { ok: false, hint: '偏移超出合法范围（±14 小时，分钟 ≤59）' };
    return { ok: true, timeZone: formatOffset(offsetMinutes), kind: 'offset' };
  }

  // 4. IANA 时区名（大小写不敏感；索引未覆盖的交由 Intl 验证）
  if (getIanaIndex().has(raw)) {
    return { ok: true, timeZone: normalizeTimeZone(original), kind: 'iana' };
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: original });
    return { ok: true, timeZone: normalizeTimeZone(original), kind: 'iana' };
  } catch (err) { /* 继续 */ }

  return { ok: false, hint: '无法识别的时区格式' };
}

/** 从正则可捕获组解析偏移分钟数（非法返回 null） */
function parseOffsetFromMatch(m) {
  const hours = parseInt(m[2], 10);
  const minutes = m[3] ? parseInt(m[3], 10) : 0;
  if (hours > 14 || minutes > 59) return null;
  return (m[1] === '-' ? -1 : 1) * (hours * 60 + minutes);
}

/**
 * 解析时区链：显式用户设置 → ICS 导入推断 → 插件配置 → 系统时区
 * 逐级跳过 'auto'/空/非法值
 * @param {string|null|undefined} userTZ 用户显式设置（data 文件 timeZone 字段）
 * @param {string|null|undefined} importTZ ICS 导入推断（data 文件 importTimeZone 字段）
 * @param {string|null|undefined} configTZ 插件配置 timeZone（'auto' 表示跟随系统）
 * @returns {string} 规范时区表示（IANA 名或 "+08:00"）
 */
export function resolveEffectiveTimeZone(userTZ, importTZ, configTZ) {
  for (const candidate of [userTZ, importTZ, configTZ]) {
    if (!candidate || candidate === 'auto') continue;
    const normalized = normalizeTimeZone(candidate);
    if (normalized) return normalized;
  }
  return getSystemTimeZone();
}

// ---------- 绝对时刻 ↔ 时区日历分量 ----------

// Intl formatter 缓存（同一时区复用；时区数量有限，不做淘汰）
const tzFormatterCache = new Map();

function getTzFormatter(tz) {
  let formatter = tzFormatterCache.get(tz);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23'
    });
    tzFormatterCache.set(tz, formatter);
  }
  return formatter;
}

/** 判定时区表示类型并解析（非法回退系统时区），返回 { tz, offsetMinutes|null } */
function resolveTzForCompute(tz) {
  if (typeof tz === 'string' && tz) {
    const offset = tryParseOffsetMinutes(tz);
    if (offset !== null) return { tz: formatOffset(offset), offsetMinutes: offset };
    if (isValidIanaTimeZone(tz)) return { tz, offsetMinutes: null };
  }
  return { tz: getSystemTimeZone(), offsetMinutes: null };
}

/**
 * 将毫秒时刻换算为指定时区的日历分量
 * tz 可为 IANA 名或固定偏移串（"+08:00"）；非法时回退系统时区
 * @param {number} ms 绝对时刻
 * @param {string} tz
 * @returns {{year:number, month:number, day:number, hour:number, minute:number, second:number,
 *           dateStr:string, timeHHMM:string}}
 */
export function utcMsToTzParts(ms, tz) {
  const resolved = resolveTzForCompute(tz);
  if (resolved.offsetMinutes !== null) {
    return utcMsToFixedParts(ms, resolved.offsetMinutes);
  }
  return utcMsToIntlParts(ms, resolved.tz);
}

/** 固定偏移：纯算术换算（与本地时区无关，无 DST） */
export function utcMsToFixedParts(ms, offsetMinutes) {
  const d = new Date(ms + offsetMinutes * 60000);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const hour = d.getUTCHours();
  const minute = d.getUTCMinutes();
  const second = d.getUTCSeconds();
  return buildParts(year, month, day, hour, minute, second);
}

/** IANA：Intl formatToParts 换算 */
function utcMsToIntlParts(ms, tz) {
  const parts = {};
  for (const part of getTzFormatter(tz).formatToParts(new Date(ms))) {
    if (part.type !== 'literal') parts[part.type] = parseInt(part.value, 10);
  }
  return buildParts(parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second);
}

function buildParts(year, month, day, hour, minute, second) {
  const dateStr = [year, String(month).padStart(2, '0'), String(day).padStart(2, '0')].join('-');
  const timeHHMM = [String(hour).padStart(2, '0'), String(minute).padStart(2, '0')].join(':');
  return { year, month, day, hour, minute, second, dateStr, timeHHMM };
}

/**
 * 当前时刻在指定时区的日历分量（"现在几点/今天几号" 的唯一入口）
 * @param {string} tz
 */
export function getZonedNowParts(tz) {
  return utcMsToTzParts(Date.now(), tz);
}

/**
 * 当前时刻在指定时区的 UTC 偏移分钟数（含夏令时实时值）
 * @param {number} ms
 * @param {string} tz
 * @returns {number}
 */
export function getUtcOffsetMinutes(ms, tz) {
  const resolved = resolveTzForCompute(tz);
  if (resolved.offsetMinutes !== null) return resolved.offsetMinutes;
  const parts = utcMsToIntlParts(ms, resolved.tz);
  // 墙钟 = UTC + 偏移 → 偏移 = Date.UTC(墙钟分量) - ms
  return Math.round((Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - ms) / 60000);
}

/**
 * 描述时区（命令回复用）：当前偏移/是否处于夏令时（用当前与约半年后的偏移对比推断）
 * @param {string} tz
 * @param {number} [ms=Date.now()]
 * @returns {{canonical:string, offsetLabel:string, offsetMinutes:number, dst:boolean}}
 */
export function describeTimeZone(tz, ms = Date.now()) {
  const resolved = resolveTzForCompute(tz);
  const offsetMinutes = getUtcOffsetMinutes(ms, resolved.tz);
  const offsetLater = getUtcOffsetMinutes(ms + 15778800000, resolved.tz); // ~半年后
  return {
    canonical: resolved.tz,
    offsetLabel: `UTC${formatOffset(offsetMinutes)}`,
    offsetMinutes,
    dst: offsetLater !== offsetMinutes
  };
}

/**
 * 墙钟（某日历日 HH:MM）→ 绝对时刻（毫秒）
 * IANA 时区用 Intl 迭代求解（正确处理夏令时 fold/gap：优先返回字段完全一致的
 * 最小扰动候选，edge:'normal'；落在切换间隙/重复区间则返回字段差最小者并标记 ambiguous）
 * @param {{year:number, month:number, day:number, hour:number, minute:number, second?:number}} p
 * @param {string} tz
 * @returns {{ms:number, edge:'normal'|'ambiguous'}}
 */
export function wallPartsToUtcMs(p, tz) {
  if (!p || [p.year, p.month, p.day, p.hour, p.minute].some(v => !Number.isInteger(v))) {
    throw new Error(`wallPartsToUtcMs: 非法墙钟分量 ${JSON.stringify(p)}`);
  }
  const second = p.second || 0;
  const resolved = resolveTzForCompute(tz);
  if (resolved.offsetMinutes !== null) {
    return {
      ms: Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, second) - resolved.offsetMinutes * 60000,
      edge: 'normal'
    };
  }
  const guess = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, second);
  // 先按"墙钟当作 UTC 时刻"的时区偏移粗校准（时区偏移可达 ±14h，固定 ±2h 候选必然失配），
  // 再以 ±1h/±2h/±1d 微调处理夏令时切换（fold/gap/午夜切换等历史边缘）
  const offsetAtGuess = getUtcOffsetMinutes(guess, resolved.tz);
  const anchored = guess - offsetAtGuess * 60000;
  let best = null;
  let bestDiff = Infinity;
  for (const delta of [0, 3600000, -3600000, 7200000, -7200000, 86400000, -86400000]) {
    const candidate = anchored + delta;
    const q = utcMsToIntlParts(candidate, resolved.tz);
    const diff = Math.abs(q.year - p.year) + Math.abs(q.month - p.month) + Math.abs(q.day - p.day)
      + Math.abs(q.hour - p.hour) + Math.abs(q.minute - p.minute) + Math.abs(q.second - second);
    if (diff === 0) return { ms: candidate, edge: 'normal' };
    if (diff < bestDiff) {
      bestDiff = diff;
      best = candidate;
    }
  }
  return { ms: best, edge: 'ambiguous' };
}

/**
 * 日历日 + "HH:MM" 墙钟 → 绝对时刻（翘课到期等场景）
 * @param {string} dateStr YYYY-MM-DD
 * @param {string} hhmm "HH:MM"
 * @param {string} tz
 * @returns {{ms:number, edge:string}}
 */
export function tzDateStrToUtcMs(dateStr, hhmm, tz) {
  const [hour, minute] = String(hhmm).split(':').map(Number);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m || !Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new Error(`tzDateStrToUtcMs: 非法输入 dateStr=${dateStr} hhmm=${hhmm}`);
  }
  return wallPartsToUtcMs({
    year: parseInt(m[1], 10), month: parseInt(m[2], 10), day: parseInt(m[3], 10),
    hour, minute, second: 0
  }, tz);
}

// ---------- 日历日域纯算术（Date.UTC，与任何本地时区无关） ----------

/**
 * 宽松规范化日期为 "YYYY-MM-DD"（补零；容忍 "2026-3-2"、"-/." 分隔、2 位年份补 2000 起）
 * Date 输入按本地分量取值。非法输入返回 null
 * @param {Date|string} input
 * @returns {string|null}
 */
export function normalizeDateStr(input) {
  if (input instanceof Date) return toDateStr(input);
  if (typeof input !== 'string') return null;
  const m = /^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(input.trim());
  if (!m) return null;
  let year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (m[1].length < 4 && year < 100) year += 2000; // 如 26-03-02 → 2026
  if (year < 1000 || year > 9999) return null;
  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isValidDateStr(dateStr) ? dateStr : null;
}

/**
 * 校验日期串 YYYY-MM-DD（且为真实存在的公历日）
 * @param {string} dateStr
 * @returns {boolean}
 */
export function isValidDateStr(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr));
  if (!m) return false;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/** 日历日 → 星期（1=周一 … 7=周日）；非法输入返回 NaN */
export function weekdayOfDateStr(dateStr) {
  const ds = normalizeDateStr(dateStr);
  if (!ds) return NaN;
  const [year, month, day] = ds.split('-').map(Number);
  const wd = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

/** 日历日偏移：YYYY-MM-DD ± N 天（跨月/跨年/闰年安全）；非法输入返回 null */
export function shiftDateStr(dateStr, days) {
  const ds = normalizeDateStr(dateStr);
  if (!ds) return null;
  const [year, month, day] = ds.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** 取日历日所在周的周一（周一为一周起点）；非法输入返回 null */
export function mondayOfDateStr(dateStr) {
  const wd = weekdayOfDateStr(dateStr);
  if (isNaN(wd)) return null;
  return shiftDateStr(dateStr, -(wd - 1));
}

/** 两个日历日相差天数：b - a；非法输入返回 NaN */
export function daysBetweenDateStrs(a, b) {
  const na = normalizeDateStr(a);
  const nb = normalizeDateStr(b);
  if (!na || !nb) return NaN;
  const [ay, am, ad] = na.split('-').map(Number);
  const [by, bm, bd] = nb.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

/**
 * 目标日历日在学期中的周数（学期开始日所在周的周一为第 1 周起点）
 * @param {string} semesterStartStr 学期开始日（可非补零，如 "2026-3-2"）
 * @param {string} dateStr 目标日历日
 * @returns {number|null} 非法输入/早于学期开始所在周的周一 → null
 */
export function weekOfDateStr(semesterStartStr, dateStr) {
  const start = normalizeDateStr(semesterStartStr);
  const target = normalizeDateStr(dateStr);
  if (!start || !target) return null;
  const startMonday = mondayOfDateStr(start);
  const diffDays = daysBetweenDateStrs(startMonday, target);
  if (diffDays < 0) return null;
  return Math.floor(diffDays / 7) + 1;
}

/**
 * 日历日 → "本地午夜 Date"（new Date("YYYY-MM-DD") 会按 UTC 解析，
 * 在负偏移服务器上 getDay()/getFullYear() 错位一天；显式加 T00:00:00 让本地解析，
 * 其本地分量恰好等于该日历日，任意服务器时区下语义一致）
 * @param {string} dateStr YYYY-MM-DD（可非补零）
 * @returns {Date|null} 非法输入返回 null
 */
export function dateStrToLocalMidnight(dateStr) {
  const ds = normalizeDateStr(dateStr);
  if (!ds) return null;
  return new Date(`${ds}T00:00:00`);
}

/**
 * Date → 日历日串（按本地分量取；若传的是"本地午夜 Date"则即为该日历日）；
 * 字符串输入会宽松规范化。非法输入返回 null
 * @param {Date|string} input
 * @returns {string|null}
 */
export function toDateStr(input) {
  if (input instanceof Date) {
    if (isNaN(input)) return null;
    const year = input.getFullYear();
    const month = String(input.getMonth() + 1).padStart(2, '0');
    const day = String(input.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return normalizeDateStr(input);
}

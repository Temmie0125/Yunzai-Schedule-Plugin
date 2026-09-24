// 默认节次→时间映射
import { ConfigManager } from "../components/ConfigManager.js";
import { normalizeHM } from "../utils/timeUtils.js";
const DEFAULT_TIME_SLOTS = {
  1: { start: "08:00", end: "08:45" },
  2: { start: "08:50", end: "09:35" },
  3: { start: "09:50", end: "10:35" },
  4: { start: "10:40", end: "11:25" },
  5: { start: "11:30", end: "12:15" },
  6: { start: "14:00", end: "14:45" },
  7: { start: "14:50", end: "15:35" },
  8: { start: "15:40", end: "16:25" },
  9: { start: "16:30", end: "17:15" },
  10: { start: "19:00", end: "19:45" },
  11: { start: "19:50", end: "20:35" },
  12: { start: "20:40", end: "21:25" }
};

/**
 * 将时间格式转换为分钟
 * @param {*} timeStr 
 * @returns 
 */
function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

/**
 * 合并连堂课（同一天/课程/教师/地点/周次，且前后节次间隔 ≤10分钟）
 */
function mergeConsecutiveCourses(courses) {
  if (!courses.length) return [];
  courses.sort((a, b) =>
    a.day - b.day ||
    a.name.localeCompare(b.name) ||
    a.teacher.localeCompare(b.teacher) ||
    a.location.localeCompare(b.location) ||
    JSON.stringify(a.weeks).localeCompare(JSON.stringify(b.weeks)) ||
    a.startTime.localeCompare(b.startTime)
  );
  const result = [];
  for (const cur of courses) {
    if (result.length === 0) {
      result.push({ ...cur });
      continue;
    }
    const last = result[result.length - 1];
    const isSame = last.day === cur.day &&
                   last.name === cur.name &&
                   last.teacher === cur.teacher &&
                   last.location === cur.location &&
                   JSON.stringify(last.weeks) === JSON.stringify(cur.weeks);
    if (isSame) {
      const lastEnd = timeToMinutes(last.endTime);
      const curStart = timeToMinutes(cur.startTime);
      if (curStart - lastEnd <= 10) {   // 连堂合并
        last.endTime = cur.endTime;
        // 合并时扩展 startNode/step 范围
        if (last.startNode !== undefined && cur.startNode !== undefined &&
            last.step !== undefined && cur.step !== undefined) {
          const lastEndNode = last.startNode + last.step - 1;
          const curEndNode = cur.startNode + cur.step - 1;
          last.step = Math.max(lastEndNode, curEndNode) - last.startNode + 1;
        }
        continue;
      }
    }
    result.push({ ...cur });
  }
  return result;
}

/**
 * 解析星链课表 JSON 中的 timetable（自定义时间表）字段
 * @param {object} timetable - { name, classDuration, breakDuration, items: [{ section, startHour, startMinute, endHour, endMinute }] }
 * @returns {Array|null} [{ number, startTime, endTime }] 格式的时间段数组；字段缺失或无有效项时返回 null
 */
export function parseStarlinkTimetable(timetable) {
  if (!timetable || !Array.isArray(timetable.items) || timetable.items.length === 0) return null;
  const formatHM = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const timeSlots = [];
  const seenSections = new Set();
  for (const item of timetable.items) {
    const section = Number(item?.section);
    const startHour = Number(item?.startHour);
    const startMinute = Number(item?.startMinute ?? 0);
    const endHour = Number(item?.endHour);
    const endMinute = Number(item?.endMinute ?? 0);
    // 校验节次与时间数值的合法性，异常项跳过
    if (!Number.isInteger(section) || section <= 0 || seenSections.has(section)) continue;
    if (![startHour, startMinute, endHour, endMinute].every(Number.isInteger)) continue;
    if (startHour < 0 || startHour > 23 || endHour < 0 || endHour > 23) continue;
    if (startMinute < 0 || startMinute > 59 || endMinute < 0 || endMinute > 59) continue;
    const startTime = formatHM(startHour, startMinute);
    const endTime = formatHM(endHour, endMinute);
    if (timeToMinutes(endTime) <= timeToMinutes(startTime)) continue;
    timeSlots.push({ number: section, startTime, endTime });
    seenSections.add(section);
  }
  if (!timeSlots.length) return null;
  timeSlots.sort((a, b) => a.number - b.number);
  return timeSlots;
}

/**
 * 将时间段数组转换为节次→时间映射（用于课程节次换算）
 * @param {Array} timeSlots - [{ number, startTime, endTime }]
 * @returns {object} { [number]: { start, end } }
 */
export function timeSlotsToSectionMap(timeSlots) {
  const map = {};
  for (const ts of timeSlots) {
    map[ts.number] = { start: ts.startTime, end: ts.endTime };
  }
  return map;
}

/**
 * 通过星链分享码获取课表数据并转换为统一格式
 * @param {string} shareCode
 * @returns {Promise<{ tableName: string, semesterStart: string, courses: array, timeSlots?: array }>}
 */
export async function fetchStarlinkSchedule(shareCode) {
  const url = `https://api.starlinkkb.cn/share/curriculum/${shareCode}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const resJson = await response.json();
  const data = resJson.data;
  if (!data || !data.courses) throw new Error('无效的星链课表数据');
  // 时间段定义：优先解析课表自带的 timetable 字段，其次兼容旧版 timeSlots，均无则使用默认
  let timeSlots = DEFAULT_TIME_SLOTS;
  const timetableSlots = parseStarlinkTimetable(data.timetable);
  if (!timetableSlots && data.timetable) {
    logger.warn('[星链导入] 检测到 timetable 字段但解析失败，回退到兼容流程');
  }
  if (timetableSlots) {
    timeSlots = timeSlotsToSectionMap(timetableSlots);
  } else if (data.timeSlots && Array.isArray(data.timeSlots)) {
    const custom = {};
    for (const ts of data.timeSlots) {
      // 星链返回的时间可能未补零（"9:00"），统一归一化，避免影响后续字符串比较
      custom[ts.section] = { start: normalizeHM(ts.startTime), end: normalizeHM(ts.endTime) };
    }
    timeSlots = custom;
  }
  const courses = [];
  for (const c of data.courses) {
    const teacher = (c.teacher && c.teacher !== '无') ? c.teacher : '';
    const location = (c.location && c.location.replace(/^@/, '').trim()) || '';
    const weeks = c.weeks || [];
    let startTime = '', endTime = '';
    if (c.startSection && c.endSection) {
      const startSlot = timeSlots[c.startSection];
      const endSlot = timeSlots[c.endSection];
      if (!startSlot || !endSlot) {
        logger.warn(`[星链导入] 未找到节次 ${c.startSection} 或 ${c.endSection} 的时间定义，跳过课程 ${c.name}`);
        continue;
      }
      startTime = startSlot.start;
      endTime = endSlot.end;
    } else if (c.startTime && c.endTime) {
      startTime = normalizeHM(c.startTime);
      endTime = normalizeHM(c.endTime);
    } else {
      logger.warn(`[星链导入] 课程 ${c.name} 缺少时间信息，跳过`);
      continue;
    }

    courses.push({
      name: c.name,
      teacher,
      location,
      day: c.weekday,          // 1-7
      startTime,
      endTime,
      weeks,
      // 保留节次数据，方便后续更换时间配置
      startNode: c.startSection || undefined,
      step: (c.startSection && c.endSection) ? (c.endSection - c.startSection + 1) : undefined
    });
  }

  const merged = mergeConsecutiveCourses(courses);
  // 从配置读取默认学期开始日期
  const config = ConfigManager.getConfig();
  let semesterStart = data.startDate ? data.startDate.substring(0, 10) : null;
  if(!semesterStart) semesterStart = config.defaultSemesterStart
  const tableName = data.tableName || data.name || '星链课表';

  return {
    tableName,
    semesterStart,
    courses: merged,
    updateTime: new Date().toISOString(),
    // 课表自带的 timetable 解析成功时随课表返回，导入时一并保存为用户时间表配置
    timeSlots: timetableSlots || undefined
  };
}
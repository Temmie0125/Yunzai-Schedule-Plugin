// 默认节次→时间映射
import { ConfigManager } from "../components/ConfigManager";
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
        continue;
      }
    }
    result.push({ ...cur });
  }
  return result;
}

/**
 * 通过星链分享码获取课表数据并转换为统一格式
 * @param {string} shareCode
 * @returns {Promise<{ tableName: string, semesterStart: string, courses: array }>}
 */
export async function fetchStarlinkSchedule(shareCode) {
  const url = `https://api.starlinkkb.cn/share/curriculum/${shareCode}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const resJson = await response.json();
  const data = resJson.data;
  if (!data || !data.courses) throw new Error('无效的星链课表数据');
  // 时间段定义
  let timeSlots = DEFAULT_TIME_SLOTS;
  if (data.timeSlots && Array.isArray(data.timeSlots)) {
    const custom = {};
    for (const ts of data.timeSlots) {
      custom[ts.section] = { start: ts.startTime, end: ts.endTime };
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
      startTime = c.startTime;
      endTime = c.endTime;
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
      weeks
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
    updateTime: new Date().toISOString()
  };
}
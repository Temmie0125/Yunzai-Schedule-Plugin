// services/scheduleImporter.js
import { fetchScheduleFromAPI } from './wakeupApi.js'
import { fetchStarlinkSchedule } from './starlinkApi.js'
import { DataManager } from '../components/DataManager.js'
import { ConfigManager } from '../components/ConfigManager.js'  // 新增
import { getCurrentFullDate, getMondayOfSameWeek, calculateWeekFromDate } from '../utils/timeUtils.js'
import ICalExpander from 'ical-expander';
// 默认节次时间映射
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

function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

/**
 * 合并连续课程：名称地点教师相同且间隔小于10分钟
 * @param {*} courses 
 * @returns 合并后的课程
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
      if (curStart - lastEnd <= 10) {
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
 * 将星链课表 JSON 转换为标准课表格式
 * @param {object} jsonData - 星链原始 JSON
 * @param {object} config - 全局配置
 * @returns {object} 标准课表对象 { tableName, semesterStart, courses }
 */
function convertStarlinkJsonToStandard(jsonData, config) {
  // 获取时间槽映射（优先使用 JSON 中的 timeSlots，否则默认）
  let timeSlots = DEFAULT_TIME_SLOTS;
  if (jsonData.timeSlots && Array.isArray(jsonData.timeSlots)) {
    const custom = {};
    for (const ts of jsonData.timeSlots) {
      custom[ts.section] = { start: ts.startTime, end: ts.endTime };
    }
    timeSlots = custom;
  }

  const courses = [];
  for (const c of jsonData.courses) {
    const teacher = (c.teacher && c.teacher !== '无') ? c.teacher : '';
    const location = (c.location && c.location.replace(/^@/, '').trim()) || '';
    const weeks = c.weeks || [];

    let startTime = '', endTime = '';
    if (c.startSection && c.endSection) {
      const startSlot = timeSlots[c.startSection];
      const endSlot = timeSlots[c.endSection];
      if (!startSlot || !endSlot) {
        logger.warn(`[课表导入] 星链格式：未找到节次 ${c.startSection} 或 ${c.endSection} 的时间定义，跳过课程 ${c.name}`);
        continue;
      }
      startTime = startSlot.start;
      endTime = endSlot.end;
    } else if (c.startTime && c.endTime) {
      startTime = c.startTime;
      endTime = c.endTime;
    } else {
      logger.warn(`[课表导入] 星链格式：课程 ${c.name} 缺少时间信息，跳过`);
      continue;
    }

    courses.push({
      name: c.name,
      teacher,
      location,
      day: c.weekday,      // 1-7，周一=1
      startTime,
      endTime,
      weeks,
      // 保留节次数据，方便后续更换时间配置
      startNode: c.startSection || undefined,
      step: (c.startSection && c.endSection) ? (c.endSection - c.startSection + 1) : undefined
    });
  }

  const merged = mergeConsecutiveCourses(courses);
  let semesterStart = jsonData.startDate ? jsonData.startDate.substring(0, 10) : null;
  if (!semesterStart) {
    semesterStart = config.defaultSemesterStart;
  }
  const tableName = jsonData.name || jsonData.tableName || '星链课表';

  return { tableName, semesterStart, courses: merged };
}

/**
 * 判断是否为星链课表 JSON 格式
 */
function isStarlinkJsonFormat(jsonData) {
  if (!jsonData.courses || !Array.isArray(jsonData.courses) || jsonData.courses.length === 0) return false;
  if (jsonData.timeSlots) return false; // 拾光格式优先
  const sample = jsonData.courses[0];
  // 星链格式特征：包含 startSection 或 weekday，且没有 startTime/day 字段
  return (sample.hasOwnProperty('startSection') || sample.hasOwnProperty('weekday')) &&
    !sample.hasOwnProperty('startTime') &&
    !sample.hasOwnProperty('day');
}
/**
 * 通用：保存课表并保留用户原有昵称/签名
 */
async function saveScheduleWithUserData(userId, scheduleData, event) {
  const oldData = DataManager.loadSchedule(userId);
  let nickname = oldData?.nickname;
  let signature = oldData?.signature;
  if (!nickname) {
    nickname = (await DataManager.getUserNickname(userId, event)) || userId.toString();
  }
  DataManager.saveSchedule(userId, scheduleData, nickname, signature);
  return { nickname, signature };
}

/**
 * 通用：构建成功回复消息
 * @param {string|number} userId - 用户QQ号
 * @param {object} scheduleData - 课表数据
 * @param {string} nickname - 用户昵称
 * @param {string} signature - 个性签名（可选）
 * @param {string} sourceLabel - 来源标签（如“✨ 星链”、“”）
 * @param {boolean} showTableName - 是否显示课表名称
 * @param {boolean} inGroup - 是否在群聊中
 */
function buildSuccessReply(userId, scheduleData, nickname, signature, sourceLabel, showTableName = true, inGroup = false) {
  let replyMsg = `${sourceLabel}课表导入成功！\n`;
  const shouldShowTableName = showTableName && scheduleData.tableName && (!inGroup || showTableName);
  if (shouldShowTableName) {
    replyMsg += `📚 课表名称：${scheduleData.tableName}\n`;
  }
  if (scheduleData.semesterStart) {
    replyMsg += `📅 学期开始：${scheduleData.semesterStart}\n`;
  }
  replyMsg += `📖 课程数量：${scheduleData.courses.length} 门\n`;
  replyMsg += `👤 昵称：${nickname}`;
  if (signature) replyMsg += `\n💬 签名：${signature}`;
  if (nickname === String(userId)) {
    replyMsg += `\n⚠️ 建议使用 #课表设置昵称 设置昵称`;
  }
  return replyMsg;
}

/**
* 通用：处理自动撤回口令，并追加提醒内容
*/
async function handleAutoRecall(replyMsg, event, autoRecallCode, botName) {
  const inGroup = !!event.group;
  if (!inGroup || !autoRecallCode) return replyMsg;

  const group = event.group;
  if (group.is_admin || group.is_owner) {
    try {
      replyMsg += `\n⚠️ ${botName}正在尝试自动撤回您的口令，如失败请手动撤回~`;
      await group.recallMsg(event.message_id);
      logger.mark(`[课表导入] 已自动撤回用户 ${event.user_id} 的口令消息`);
    } catch (err) {
      logger.error(`[课表导入] 撤回口令失败: ${err}`);
    }
  } else {
    replyMsg += `\n⚠️ ${botName}无管理员权限，无法撤回口令，为确保您的隐私安全，请及时手动撤回口令哦~`;
    logger.warn(`[课表导入] Bot在群 ${group.group_id} 无管理员权限，无法撤回`);
  }
  return replyMsg;
}

/**
 * 从口令导入课表的核心逻辑
 * @param {string|number} userId 用户QQ号
 * @param {string} code 提取出的口令
 * @param {object} event 事件对象（用于获取默认昵称）
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function importScheduleFromCode(userId, code, event) {
  // 直接返回不支持提示
  const message = `❌ WakeUp 课程表已停止支持口令导入！\n` +
    `WakeUp 近期加强了接口限制，本插件无法继续通过口令导入。\n` +
    `建议您尽快迁移至其他课表软件（如拾光课表、星链课表）。\n` +
    `✅ 您可以使用以下方式继续导入课程表：\n` +
    `• 发送 #导入课表 并上传课表文件（支持拾光导出JSON格式 / ICS 日历文件）\n` +
    `• 使用星链课表分享口令（直接发送「星链课表」分享消息）\n\n` +
    `迁移教程请查看 #课表帮助 或联系管理员。`;
  return { success: false, message };
  if (!code || !/^[0-9a-zA-Z\-_]+$/.test(code)) {
    return { success: false, message: "口令格式不正确，请确保是WakeUp课程表的正确分享口令" };
  }
  try {
    const config = ConfigManager.getConfig();
    const bot = event.bot || Bot;
    const botName = config.botName || bot.nickname || "Bot";
    const showTableName = config.showTableName ?? true;
    const autoRecallCode = config.autoRecallCode ?? false;
    const scheduleData = await fetchScheduleFromAPI(code);
    if (!scheduleData) {
      return { success: false, message: "获取课表失败，请检查口令" };
    }

    const { nickname, signature } = await saveScheduleWithUserData(userId, scheduleData, event);
    let replyMsg = buildSuccessReply(userId, scheduleData, nickname, signature, "", showTableName, !!event.group);
    replyMsg = await handleAutoRecall(replyMsg, event, autoRecallCode, botName);
    return { success: true, message: replyMsg };
  } catch (err) {
    logger.error(`设置课表失败: ${err}`);
    return { success: false, message: "设置课表失败，请稍后重试" };
  }
}

/**
 * 从JSON数据导入课表（支持原生格式和拾光格式）
 * @param {string|number} userId
 * @param {object} jsonData - 解析后的JSON对象
 * @param {object} event - 事件对象
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function importScheduleFromJsonData(userId, jsonData, event) {
  try {
    let courses = [];
    let semesterStart = null;
    let tableName = "导入的课表";
    let isStarlink = false;
    let missingSemesterStart = false;
    // ---------- 星链格式识别与转换 ----------
    if (isStarlinkJsonFormat(jsonData)) {
      isStarlink = true;
      const config = ConfigManager.getConfig();
      const converted = convertStarlinkJsonToStandard(jsonData, config);
      courses = converted.courses;
      semesterStart = converted.semesterStart;
      tableName = converted.tableName;
      if (!semesterStart || semesterStart === config.defaultSemesterStart) {
        missingSemesterStart = true;
      }
    }
    // 判断是否为拾光格式（包含 timeSlots 字段）
    else if (jsonData.timeSlots && Array.isArray(jsonData.timeSlots) && jsonData.courses) {
      // 拾光格式转换
      const timeSlotMap = new Map();
      for (const ts of jsonData.timeSlots) {
        timeSlotMap.set(ts.number, { start: ts.startTime, end: ts.endTime });
      }
      courses = jsonData.courses.map(course => {
        let startTime, endTime;
        if (course.isCustomTime && course.customStartTime && course.customEndTime) {
          startTime = course.customStartTime;
          endTime = course.customEndTime;
        } else if (course.startSection && course.endSection) {
          // 根据节次获取时间
          const startSlot = timeSlotMap.get(course.startSection);
          const endSlot = timeSlotMap.get(course.endSection);
          if (!startSlot || !endSlot) {
            logger.warn(`[课表导入] 节次 ${course.startSection}-${course.endSection} 不在时间段定义中，跳过课程 ${course.name}`);
            return null;
          }
          startTime = startSlot.start;
          endTime = endSlot.end;
        } else {
          logger.warn(`[课表导入] 课程 ${course.name} 缺少时间信息，跳过`);
          return null;
        }
        return {
          name: course.name || "未知课程",
          teacher: course.teacher || "",
          location: course.position || "",
          day: course.day,  // 1-7
          startTime: startTime,
          endTime: endTime,
          weeks: course.weeks || []
        };
      }).filter(c => c !== null);
      // 学期开始日期
      if (jsonData.config && jsonData.config.semesterStartDate) {
        semesterStart = jsonData.config.semesterStartDate;
      }
      tableName = "拾光课表导入";
    }
    else if (jsonData.courses && Array.isArray(jsonData.courses)) {
      // 原生格式（期望包含 courses, semesterStart, tableName 等）
      courses = jsonData.courses.map(c => ({
        name: c.name,
        teacher: c.teacher || "",
        location: c.location || "",
        day: c.day,
        startTime: c.startTime,
        endTime: c.endTime,
        weeks: c.weeks || []
      }));
      semesterStart = jsonData.semesterStart || null;
      tableName = jsonData.tableName || "导入的课表";
    }
    else {
      return { success: false, message: "无法识别的JSON格式，缺少必要的courses字段或timeSlots字段" };
    }
    // 校验数据完整性
    if (!courses.length) {
      return { success: false, message: "解析后没有有效的课程数据，请检查文件内容" };
    }
    let replyMsg = ``;
    if (!semesterStart) {
      // 如果没有学期开始日期，使用默认值，并提示用户
      const config = ConfigManager.getConfig();
      semesterStart = config.defaultSemesterStart || getCurrentFullDate();
      // replyMsg += `检测到您的JSON未提供学期开始日期，将使用默认值 ${semesterStart}，可使用#学期开始日期 命令更改\n`
      logger.warn(`[课表导入] 用户 ${userId} 的JSON未提供学期开始日期，使用默认值 ${semesterStart}`);
    }
    // 加载原有数据保留昵称和签名
    const oldData = DataManager.loadSchedule(userId);
    let nickname = oldData?.nickname;
    let signature = oldData?.signature;
    if (!nickname) {
      nickname = (await DataManager.getUserNickname(userId, event)) || userId.toString();
    }
    // 构造课表数据对象
    const scheduleData = {
      tableName: tableName,
      semesterStart: semesterStart,
      courses: courses,
      updateTime: new Date().toISOString()
    };
    // 保存
    DataManager.saveSchedule(userId, scheduleData, nickname, signature);
    // 回复消息
    // 构建回复消息
    replyMsg += `✅ 课表导入成功！\n`;
    if (isStarlink) {
      replyMsg += `✨ 检测到星链课表格式，导入成功！\n`;
    }
    replyMsg += `📚 课表名称：${tableName}\n`;
    replyMsg += `📅 学期开始：${semesterStart}\n`;
    replyMsg += `📖 课程数量：${courses.length} 门\n`;
    replyMsg += `👤 昵称：${nickname}`;
    if (signature) replyMsg += `\n💬 签名：${signature}`;
    replyMsg += `\n使用 #今日课表 查看今日课程。`;

    if (missingSemesterStart) {
      replyMsg += `\n\n⚠️ 注意：本课表缺少学期开始日期，已使用默认值 ${semesterStart}。`;
      replyMsg += `\n   您可以使用 #设置学期开始 YYYY-MM-DD 命令进行修正（例如 #设置学期开始 2026-03-02）。`;
    }

    return { success: true, message: replyMsg };
  } catch (err) {
    logger.error(`[课表导入] 处理JSON数据失败: ${err}`);
    return { success: false, message: "导入失败，请检查文件格式或联系管理员" };
  }
}

/**
 * 从星链分享码导入课表
 * @param {string|number} userId
 * @param {string} code
 * @param {object} event
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function importScheduleFromStarlinkCode(userId, code, event) {
  if (!code || !/^[0-9a-zA-Z\-_]+$/.test(code) || code.length < 4) {
    return { success: false, message: '星链分享码格式不正确，请检查后重试' };
  }
  try {
    const config = ConfigManager.getConfig();
    const bot = event.bot || Bot;
    const botName = config.botName || bot.nickname || 'Bot';
    const autoRecallCode = config.autoRecallCode ?? false;

    const scheduleData = await fetchStarlinkSchedule(code);
    if (!scheduleData || !scheduleData.courses.length) {
      return { success: false, message: '获取星链课表失败，请检查分享码是否有效' };
    }

    const { nickname, signature } = await saveScheduleWithUserData(userId, scheduleData, event);
    let replyMsg = buildSuccessReply(userId, scheduleData, nickname, signature, "✨ 星链", true, !!event.group);
    replyMsg = await handleAutoRecall(replyMsg, event, autoRecallCode, botName);

    return { success: true, message: replyMsg };
  } catch (err) {
    logger.error(`[星链导入] 失败: ${err}`);
    return { success: false, message: `导入失败：${err.message}` };
  }
}
/**
 * 从 ICS 文本内容导入课表
 * @param {string|number} userId
 * @param {string} icsText
 * @param {object} event
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function importScheduleFromIcsData(userId, icsText, event) {
  try {
    const expander = new ICalExpander({ ics: icsText, maxIterations: 5000 });
    const all = expander.between(new Date(2000, 0, 1), new Date(2100, 0, 1));
    const occurrences = [...(all.events || []), ...(all.occurrences || [])];

    if (occurrences.length === 0) {
      return { success: false, message: '未在文件中找到任何课程事件' };
    }

    // 计算学期开始（最早事件所在周的周一），先统一转换日期
    const dates = occurrences.map(o => {
      // 转换 startDate 为 JS Date
      let sd = o.startDate;
      if (typeof sd.toJSDate === 'function') sd = sd.toJSDate();
      return sd;
    });
    const earliest = new Date(Math.min(...dates.map(d => d.getTime())));
    const semesterStartDate = getMondayOfSameWeek(earliest);
    const semesterStart = [
      semesterStartDate.getFullYear(),
      String(semesterStartDate.getMonth() + 1).padStart(2, '0'),
      String(semesterStartDate.getDate()).padStart(2, '0')
    ].join('-');

    const courseMap = new Map();
    for (const occ of occurrences) {
      // 转换日期
      let startDate = occ.startDate;
      let endDate = occ.endDate;
      if (typeof startDate.toJSDate === 'function') startDate = startDate.toJSDate();
      if (typeof endDate.toJSDate === 'function') endDate = endDate.toJSDate();

      // 统一从 occ.item（Occurrence）或 occ 自身（Event）取详情
      const ev = occ.item || occ;

      const summary = ev.summary || '未知课程';

      let rawLocation = (ev.location || '').trim();
      const description = (ev.description || '').trim();

      let location = '';
      let teacher = '';

      // 1. 尝试从 location 中分割“地点 教师”（WakeUp 格式）
      if (rawLocation) {
        const parts = rawLocation.split(/\s+/);
        if (parts.length >= 2) {
          teacher = parts.pop();
          location = parts.join(' ');
        } else {
          location = rawLocation; // 只有地点，没有教师
        }
      }

      // 2. 若 location 中没拿到教师，尝试从 description 提取（新 ICS 格式）
      if (!teacher && description) {
        // 取最后一行作为可能的教师名，并去掉末尾句号
        const lines = description.split('\n').filter(l => l.trim());
        if (lines.length > 0) {
          teacher = lines[lines.length - 1].replace(/[。.]$/, '').trim();
        }
      }

      // 若仍无教师则置空
      if (!teacher) teacher = '';

      // 后面的星期、时间、周次计算保持不变
      const weekday = startDate.getDay() || 7;
      const startTime = [startDate.getHours(), startDate.getMinutes()]
        .map(n => String(n).padStart(2, '0')).join(':');
      const endTime = [endDate.getHours(), endDate.getMinutes()]
        .map(n => String(n).padStart(2, '0')).join(':');
      const week = calculateWeekFromDate(semesterStart, startDate);
      if (week === null) continue;

      const key = `${summary}|${weekday}|${startTime}|${endTime}|${location}|${teacher}`;
      if (!courseMap.has(key)) {
        courseMap.set(key, {
          name: summary, day: weekday, startTime, endTime,
          weeks: new Set(), location, teacher
        });
      }
      courseMap.get(key).weeks.add(week);
    }

    const rawCourses = Array.from(courseMap.values()).map(c => ({
      ...c,
      weeks: Array.from(c.weeks).sort((a, b) => a - b)
    }));
    // 合并名称、教师、地点相同且时间连续（间隔≤10分钟）的相邻课程
    const courses = mergeConsecutiveCourses(rawCourses);

    if (courses.length === 0) {
      return { success: false, message: '未能解析出有效的课程数据' };
    }

    const scheduleData = {
      tableName: 'ICS 课程表',
      semesterStart,
      courses,
      updateTime: new Date().toISOString()
    };

    const { nickname, signature } = await saveScheduleWithUserData(userId, scheduleData, event);
    let replyMsg = buildSuccessReply(userId, scheduleData, nickname, signature, '📅 ICS', true, !!event.group);
    return { success: true, message: replyMsg };
  } catch (err) {
    logger.error(`[ICS导入] ${err}`);
    return { success: false, message: `导入 ICS 文件失败：${err.message}` };
  }
}
/**
 * 从 WakeUp 备份文本导入课表
 * @param {string|number} userId
 * @param {string} wakeupText - 文件原始文本
 * @param {object} event
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function importScheduleFromWakeupData(userId, wakeupText, event) {
  try {
    // 按行分割，尝试解析 JSON（跳过空行和非法行）
    const lines = wakeupText.split('\n').filter(line => line.trim() !== '');
    const jsonObjects = [];
    for (const line of lines) {
      try {
        jsonObjects.push(JSON.parse(line));
      } catch { /* 忽略非 JSON 行 */ }
    }
    if (jsonObjects.length < 5) {
      return { success: false, message: 'WakeUp 备份文件格式不正确，缺少必要的数据字段。' };
    }
    // WakeUp 文件固定顺序：时间元数据、节次时间表、课表元数据、课程列表、课程安排
    const [timeMetadata, timeEntries, scheduleMetadata, courseEntries, classEntries] = jsonObjects;
    // 基础校验
    if (
      !timeMetadata ||
      !Array.isArray(timeEntries) ||
      !scheduleMetadata?.startDate ||
      !Array.isArray(courseEntries) ||
      !Array.isArray(classEntries)
    ) {
      return { success: false, message: 'WakeUp 数据结构异常，请检查文件是否完整。' };
    }
    // 学期开始日期（格式转换：2026-3-2 → 2026-03-02）
    let semesterStart = scheduleMetadata.startDate;
    const dateParts = semesterStart.split('-');
    if (dateParts.length === 3) {
      semesterStart = `${dateParts[0]}-${String(dateParts[1]).padStart(2, '0')}-${String(dateParts[2]).padStart(2, '0')}`;
    } else {
      return { success: false, message: 'WakeUp 课表中学期开始日期格式异常。' };
    }
    // 构建节次时间映射：node -> { start, end }
    const nodeTimeMap = new Map();
    for (const entry of timeEntries) {
      nodeTimeMap.set(entry.node, { start: entry.startTime, end: entry.endTime });
    }
    // 构建课程 ID -> 名称映射
    const courseMap = new Map();
    for (const c of courseEntries) {
      courseMap.set(c.id, c.courseName);
    }
    // 转换课程为统一格式
    const courses = [];
    for (const cls of classEntries) {
      if (cls.ownTime) continue; // 跳过自定义时间的项
      const name = courseMap.get(cls.id) || '未知课程';
      const teacher = cls.teacher || '';
      const location = cls.room || '';
      const day = cls.day;
      const startNode = cls.startNode;
      const endNode = startNode + cls.step - 1;
      const startSlot = nodeTimeMap.get(startNode);
      const endSlot = nodeTimeMap.get(endNode);
      if (!startSlot || !endSlot) {
        logger.warn(`[WakeUp导入] 无法找到节次 ${startNode} 或 ${endNode} 的时间定义，跳过课程 ${name}`);
        continue;
      }
      // 生成周次列表（根据全周/单周/双周）
      const weeks = [];
      const startWeek = cls.startWeek;
      const endWeek = cls.endWeek;
      for (let w = startWeek; w <= endWeek; w++) {
        if (cls.type === 0) weeks.push(w);                 // 全周
        else if (cls.type === 1 && w % 2 !== 0) weeks.push(w); // 单周（奇数）
        else if (cls.type === 2 && w % 2 === 0) weeks.push(w); // 双周（偶数）
      }
      if (weeks.length === 0) continue;
      courses.push({
        name,
        teacher,
        location,
        day,
        startTime: startSlot.start,
        endTime: endSlot.end,
        weeks,
      });
    }
    if (courses.length === 0) {
      return { success: false, message: 'WakeUp 文件中未找到有效的课程安排。' };
    }
    const tableName = scheduleMetadata.tableName || 'WakeUp课程表';
    const scheduleData = {
      tableName,
      semesterStart,
      courses,
      updateTime: new Date().toISOString(),
    };
    // 保存课表并保留用户原有昵称/签名
    const { nickname, signature } = await saveScheduleWithUserData(userId, scheduleData, event);
    let replyMsg = buildSuccessReply(userId, scheduleData, nickname, signature, '📦 WakeUp', true, !!event.group);

    return { success: true, message: replyMsg };
  } catch (err) {
    logger.error(`[WakeUp导入] 失败: ${err}`);
    return { success: false, message: `导入 WakeUp 备份文件失败：${err.message}` };
  }
}
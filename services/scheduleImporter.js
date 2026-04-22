// services/scheduleImporter.js
import { fetchScheduleFromAPI } from './wakeupApi.js'
import { DataManager } from '../components/DataManager.js'
import { ConfigManager } from '../components/ConfigManager.js'  // 新增
import { getCurrentFullDate } from '../utils/timeUtils.js'
/**
 * 从口令导入课表的核心逻辑
 * @param {string|number} userId 用户QQ号
 * @param {string} code 提取出的口令
 * @param {object} event 事件对象（用于获取默认昵称）
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function importScheduleFromCode(userId, code, event) {
    // 1. 格式校验
    if (!code || !/^[0-9a-zA-Z\-_]+$/.test(code)) {
        return {
            success: false,
            message: "口令格式不正确，请确保是WakeUp课程表的正确分享口令"
        };
    }

    try {
        // 2. 获取配置
        const config = ConfigManager.getConfig()
        const bot = event.bot || Bot
        const botName = config.botName || bot.nickname || "Bot";
        const showTableName = config.showTableName ?? true
        const autoRecallCode = config.autoRecallCode ?? false

        // 2. 调用 API 获取课表数据
        const scheduleData = await fetchScheduleFromAPI(code);
        if (!scheduleData) {
            return {
                success: false,
                message: "获取课表失败，请检查口令"
            };
        }

        // 3. 保留原有昵称和签名
        const oldData = DataManager.loadSchedule(userId);
        let nickname = oldData?.nickname;
        let signature = oldData?.signature;
        if (!nickname) {
            nickname = (await DataManager.getUserNickname(userId, event)) || userId.toString();
        }

        // 4. 保存课表
        DataManager.saveSchedule(userId, scheduleData, nickname, signature);

        // 6. 构造成功消息（根据配置决定是否显示课表名称）
        let replyMsg = `课程表设置成功！\n`
        // 判断是否在群聊且配置为关闭显示课表名称
        const inGroup = !!event.group
        if (!inGroup || showTableName) {
            replyMsg += `课表名称：${scheduleData.tableName}\n`
        }
        replyMsg += `学期开始：${scheduleData.semesterStart}\n`
        replyMsg += `共 ${scheduleData.courses.length} 门课程\n`
        replyMsg += `昵称：${nickname}`
        if (signature) replyMsg += `\n签名：${signature}`
        if (nickname === userId.toString()) {
            replyMsg += `\n⚠️ 建议使用 #课表设置昵称 设置昵称`
        }
        replyMsg += `\n⚠️ ${botName}正在尝试自动撤回您的口令，如果撤回失败请及时手动撤回口令哦~`

        // 7. 自动撤回口令（群聊且配置开启且Bot有管理员权限）
        if (inGroup && autoRecallCode) {
            const group = event.group
            // 检查Bot是否为管理员或群主
            if (group.is_admin || group.is_owner) {
                try {
                    // 撤回用户发送的口令消息
                    await group.recallMsg(event.message_id)
                    logger.mark(`[课表导入] 已自动撤回用户 ${userId} 在群 ${group.group_id} 的口令消息`)
                } catch (recallErr) {
                    logger.error(`[课表导入] 撤回口令失败: ${recallErr}`)
                }
            } else {
                logger.debug(`[课表导入] Bot在群 ${group.group_id} 无管理员权限，无法撤回`)
            }
        }

        return { success: true, message: replyMsg }
    } catch (err) {
        logger.error(`设置课表失败: ${err}`)
        return { success: false, message: "设置课表失败，请稍后重试" }
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
      // 判断是否为拾光格式（包含 timeSlots 字段）
      if (jsonData.timeSlots && Array.isArray(jsonData.timeSlots) && jsonData.courses) {
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
      if (!semesterStart) {
        // 如果没有学期开始日期，使用当前日期，并提示用户
        semesterStart = getCurrentFullDate();
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
      let replyMsg = `✅ 课表导入成功！\n`;
      replyMsg += `📚 课表名称：${tableName}\n`;
      replyMsg += `📅 学期开始：${semesterStart}\n`;
      replyMsg += `📖 课程数量：${courses.length} 门\n`;
      replyMsg += `👤 昵称：${nickname}`;
      if (signature) replyMsg += `\n💬 签名：${signature}`;
      replyMsg += `\n使用 #今日课表 查看今日课程。`;
      if (!semesterStart) {
        replyMsg += `\n 注意：未发现学期开始日期，已用今日日期代替，请检查导入数据是否有误`;
      }
      return { success: true, message: replyMsg };
    } catch (err) {
      logger.error(`[课表导入] 处理JSON数据失败: ${err}`);
      return { success: false, message: "导入失败，请检查文件格式或联系管理员" };
    }
  }
// components/Renderer.js
import { ConfigManager } from '../components/ConfigManager.js'
let puppeteer
async function getPuppeteer() {
    if (!puppeteer) {
        puppeteer = (await import('../../../lib/puppeteer/puppeteer.js')).default
    }
    return puppeteer
}

/**
 * 通用渲染函数
 * @param {string} templateName - 模板文件名（不含路径，如 'schedule-template'）
 * @param {object} data - 模板数据
 * @param {object} options - 额外选项，如 { e, scale }
 * @returns {Promise<Buffer|null>}
 */
async function renderTemplate(templateName, data, options = {}) {
    try {
        const puppeteer = await getPuppeteer()
        const tplFile = `./plugins/schedule/resources/template/${templateName}.html`
        const renderData = {
            ...data,
            _res_path: `./plugins/schedule/resources/`
        }
        // 调用 puppeteer.render，第三个参数可传入 e、scale 等
        return await puppeteer.render(templateName, {
            tplFile,
            ...renderData
        }, options)
    } catch (err) {
        logger.error(`渲染模板 ${templateName} 失败: ${err}`)
        return null
    }
}

/**
 * 生成群课表图片
 */
export async function generateScheduleImage(members, currentWeek, currentDay, options = {}) {
    const config = ConfigManager.getConfig()
    const scale = config.renderScale ?? 1.0
    const mergedOptions = { ...options, scale }

    const now = new Date()
    const weekdayMap = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '日' }

    const templateData = {
        weekday: weekdayMap[currentDay],
        currentTime: now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
        updateTime: now.toLocaleString('zh-CN'),
        totalMembers: members.length,
        studyingCount: members.filter(m => m.status === '进行中').length,
        skippingCount: members.filter(m => m.status === '翘课中').length,
        skipModeCount: members.filter(m => m.skipStatus).length,
        members: members.map(m => ({
            ...m,
            avatar: m.avatar || `https://q1.qlogo.cn/g?b=qq&nk=${m.userId}&s=640`,
            signature: m.signature || ''
        }))
    }

    return await renderTemplate('schedule-template', templateData, mergedOptions)
}

/**
 * 生成帮助图片
 */
export async function generateHelpImage(helpData, options = {}) {
    const config = ConfigManager.getConfig()
    const scale = config.renderScale ?? 1.0
    const mergedOptions = { ...options, scale }

    const now = new Date()
    const templateData = {
        ...helpData,
        updateTime: now.toLocaleString('zh-CN')
    }
    return await renderTemplate('help-template', templateData, mergedOptions)
}
/**
 * 生成文本格式课表（备用）
 * @param {Array} members - 成员数据
 * @param {number} currentWeek - 当前周（系统周）
 * @param {number} currentDay - 当前星期（1-7）
 * @returns Text
 */
export function generateTextSchedule(members, currentWeek, currentDay) {
    const weekdayMap = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '日' };
    const weekday = weekdayMap[currentDay];
    const now = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

    let text = `📚 群课表状态\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `第${currentWeek}周 星期${weekday} | 当前时间: ${now}\n`;
    text += `有课表成员: ${members.length}人 | 上课中: ${members.filter(m => m.status === '进行中').length}人\n`;
    text += `翘课中: ${members.filter(m => m.status === '翘课中').length}人 | 开启翘课: ${members.filter(m => m.skipStatus).length}人\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

    members.forEach((member, index) => {
        text += `${index + 1}. ${member.nickname}`;
        if (member.skipStatus) text += ' [翘课模式]';
        text += `\n   状态: ${member.status}\n`;
        // 新增：显示签名（当状态为"无课程"或"已结束"时）
        if ((member.status === '无课程' || member.status === '已结束') && member.signature) {
            text += `   签名: ${member.signature}\n`;
        }

        if (member.currentCourse) {
            text += `   课程: ${member.currentCourse.name}\n`;
            text += `   时间: ${member.currentCourse.startTime}-${member.currentCourse.endTime}\n`;
            if (member.currentCourse.location) {
                text += `   地点: ${member.currentCourse.location}\n`;
            }
            if (member.remainingTime) {
                if (member.status === '进行中') {
                    text += `   剩余: ${member.remainingTime}\n`;
                } else if (member.status === '未开始') {
                    text += `   距离上课: ${member.remainingTime}\n`;
                }
            }
        } else {
            text += `   今日暂无课程安排\n`;
        }
        text += '\n';
    });

    text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `使用 #翘课 或 #取消翘课 切换翘课状态\n`;
    text += `更新时间: ${new Date().toLocaleString('zh-CN')}`;

    return text;
}
/**
 * 生成个人课表图片（用于今日、明日、查询）
 * @param {Object} userData - 包含以下字段：
 *   - nickname {string} 显示昵称
 *   - week {number} 周数
 *   - day {number} 星期 (1-7)
 *   - signature {string} 个性签名
 *   - courses {Array} 课程列表，每项含 name, teacher, startTime, endTime, location
 * @param {Object} options - 额外选项，如 { e, scale }
 * @returns {Promise<Buffer|null>}
 */
export async function generateUserScheduleImage(userData, targetDate = null, options = {}) {
    const config = ConfigManager.getConfig()
    const scale = config.renderScale ?? 1.0
    const mergedOptions = { ...options, scale }

    // 根据 targetDate 生成日期字符串
    let dateStr = '';
    if (targetDate) {
        dateStr = targetDate.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
    }

    const weekdayMap = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '日' };
    const templateData = {
        nickname: userData.nickname,
        week: userData.week,
        weekday: weekdayMap[userData.day],
        date: dateStr,                     // 动态日期
        signature: userData.signature || '',
        courses: userData.courses.map(c => ({
            name: c.name,
            teacher: c.teacher || '未知教师',
            startTime: c.startTime,
            endTime: c.endTime,
            location: c.location || '未知地点'
        })),
        updateTime: new Date().toLocaleString('zh-CN')
    };

    return await renderTemplate('user-schedule-template', templateData, mergedOptions);
}

/**
 * 生成个人课表信息卡片（用于 #我的课表）
 * @param {number|string} userId - 用户QQ号（用于获取头像）
 * @param {Object} userInfoData - 包含以下字段：
 *   - nickname {string} 用户昵称
 *   - signature {string} 个性签名
 *   - tableName {string} 课表名称
 *   - semesterStart {string} 学期开始日期
 *   - currentWeek {number} 当前周数
 *   - totalCourses {number} 总课程数
 *   - thisWeekCourses {number} 本周课程数
 *   - updateTime {string|number} 更新时间戳
 * @param {Object} options - 额外选项，如 { e, scale }
 * @returns {Promise<Buffer|null>}
 */
export async function generateUserInfoImage(userId, userInfoData, options = {}) {
    const config = ConfigManager.getConfig();
    const scale = config.renderScale ?? 1.0;
    const mergedOptions = { ...options, scale };

    // 头像地址（QQ头像，可根据需要替换为其他来源）
    const avatar = `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=640`;
    const now = new Date();
    const currentTime = now.toLocaleString('zh-CN');

    const templateData = {
        avatar,
        nickname: userInfoData.nickname || `用户${userId}`,
        signature: userInfoData.signature || '',
        tableName: userInfoData.tableName,
        semesterStart: userInfoData.semesterStart,
        currentWeek: userInfoData.currentWeek,
        totalCourses: userInfoData.totalCourses,
        thisWeekCourses: userInfoData.thisWeekCourses,
        updateTime: new Date(userInfoData.updateTime).toLocaleString('zh-CN'),
        currentTime,
        tips: '使用 #今日课表 等命令查看每日课程'  // 左下角提示
    };

    return await renderTemplate('user-info-template', templateData, mergedOptions);
}
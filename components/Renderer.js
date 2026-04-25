// components/Renderer.js
import { ConfigManager } from '../components/ConfigManager.js'
import fs from 'node:fs'
import path from 'node:path'
import art from 'art-template'
import puppeteer from 'puppeteer'

// 获取插件根目录
const pluginRoot = path.join(process.cwd(), 'plugins', 'schedule')

// 单例浏览器实例
let browserInstance = null
let browserLock = false
// 新增：渲染计数与重启阈值
let renderCount = 0
let restartThreshold = 100   // 默认值，可从 ConfigManager 覆盖
// 字体映射
let fontMapCache = null
/**
 * 重启浏览器实例（关闭现有实例，清空状态，等待下一次 getBrowser 重新创建）
 */
async function restartBrowser() {
    if (browserLock) {
        // 如果已经在重启或创建中，等待完成
        while (browserLock) {
            await new Promise(resolve => setTimeout(resolve, 100))
        }
        return
    }
    browserLock = true
    try {
        if (browserInstance) {
            await browserInstance.close().catch(err => logger.warn('[Schedule] 关闭 Puppeteer 浏览器实例时出错', err))
            browserInstance = null
        }
        renderCount = 0
        logger.info('[Schedule] Puppeteer 浏览器实例已手动重启，渲染计数重置')
    } catch (err) {
        logger.error('[Schedule] 重启 Puppeteer 浏览器失败', err)
    } finally {
        browserLock = false
    }
}
/**
 * 获取或创建 puppeteer 浏览器实例（单例）
 */
async function getBrowser() {
    // 健康检查：如果实例存在但已断开，则触发重启
    if (browserInstance && !browserInstance.connected) {
        logger.warn('[Schedule] 检测到 Puppeteer 浏览器已断开，即将重启')
        await restartBrowser()
    }
    if (browserInstance) return browserInstance
    if (browserLock) {
        await new Promise(resolve => {
            const check = setInterval(() => {
                if (browserInstance) {
                    clearInterval(check)
                    resolve()
                }
            }, 100)
        })
        return browserInstance
    }
    browserLock = true
    try {
        // 从配置中读取重启阈值（如果 ConfigManager 支持）
        const config = ConfigManager.getConfig()
        if (config.renderRestartCount && typeof config.renderRestartCount === 'number') {
            restartThreshold = config.renderRestartCount
        }
        browserInstance = await puppeteer.launch({
            headless: 'new',
            args: ['--disable-gpu', '--disable-setuid-sandbox', '--no-sandbox', '--no-zygote']
        })
        logger.info('[Schedule] Puppeteer 浏览器实例已启动')
        // 监听浏览器意外断开，自动重启
        browserInstance.on('disconnected', () => {
            logger.warn('[Schedule] Puppeteer 浏览器意外断开，将自动重启')
            browserInstance = null
            // 不在这里直接调用 restartBrowser 避免死锁，重置实例即可，下次 getBrowser 会重建
        })
    } catch (err) {
        logger.error('[Schedule] Puppeteer 浏览器启动失败', err)
        throw err
    } finally {
        browserLock = false
    }
    return browserInstance
}

/**
 * 从 HTML 模板中解析设计宽度（px）
 * @param {string} tplFile 模板文件路径
 * @returns {number} 设计宽度，默认 800
 */
function getDesignWidth(tplFile) {
    try {
        const content = fs.readFileSync(tplFile, 'utf8')
        // 匹配 body 中的 width 属性
        let match = content.match(/body\s*{[^}]*width:\s*(\d+)px/i)
        if (match) return parseInt(match[1])
        // 匹配 .container 的 width 或 max-width
        match = content.match(/\.container\s*{[^}]*width:\s*(\d+)px/i) ||
            content.match(/\.container\s*{[^}]*max-width:\s*(\d+)px/i)
        if (match) return parseInt(match[1])
    } catch (err) {
        logger.warn(`[Schedule] 解析模板宽度失败: ${tplFile}`, err)
    }
    return 800 // 默认宽度，与 Yunzai 核心渲染器一致
}

/**
 * 通用渲染函数（支持 deviceScaleFactor 提高清晰度，自动适配布局）
 * @param {string} templateName - 模板文件名（不含路径）
 * @param {object} data - 模板数据
 * @param {object} options - 额外选项，如 { e, scale }
 * @returns {Promise<Buffer|null>}
 */
async function renderTemplate(templateName, data, options = {}) {
    const start = Date.now()
    const scale = options.scale ?? 1.0
    const tplFile = path.join(pluginRoot, 'resources', 'template', `${templateName}.html`)
    if (!fs.existsSync(tplFile)) {
        logger.error(`[Schedule] 模板文件不存在: ${tplFile}`)
        return null
    }
    // 注入字体和字体类别参数
    if (!data._fontFile) {
        const { fontFile, formatType } = getFontFileInfo()
        data._fontFile = fontFile
        data._fontFormat = formatType
        // 构造完整的 file:// URL
        // 在 renderTemplate 函数内，获取字体文件后添加 Base64 转换
        const fontFilePath = path.join(pluginRoot, 'resources', 'fonts', fontFile)
        if (fs.existsSync(fontFilePath)) {
            const fontBuffer = fs.readFileSync(fontFilePath)
            const fontBase64 = fontBuffer.toString('base64')
            const mimeType = data._fontFormat === 'truetype' ? 'font/ttf' : 'font/otf'
            data._fontInlineUrl = `data:${mimeType};base64,${fontBase64}`
        } else {
            data._fontInlineUrl = data._fontUrl  // 回退
        }
        // 固定逻辑字体族名，避免使用文件名
        data._fontFamily = 'ScheduleFont'
    }
    const designWidth = getDesignWidth(tplFile)
    const renderData = {
        ...data,
        _res_path: data._res_path || `./plugins/schedule/resources/`
    }
    let html
    try {
        html = art(tplFile, renderData)
    } catch (err) {
        logger.error(`[Schedule] 模板 ${templateName} 解析失败:`, err)
        return null
    }
    const browser = await getBrowser()
    const page = await browser.newPage()
    try {
        await page.setViewport({
            width: designWidth,
            height: 100,
            deviceScaleFactor: scale
        })
        await page.setContent(html, { waitUntil: 'networkidle0' })
        // 等待所有图片加载 + 字体加载完成
        await page.evaluate(async () => {
            // 等待图片
            await Promise.all(
                Array.from(document.images)
                    .filter(img => !img.complete)
                    .map(img => new Promise(resolve => { img.onload = img.onerror = resolve; }))
            );
            // 等待字体加载
            await document.fonts.ready;
        });
        const screenshotBuffer = await page.screenshot({ fullPage: true, type: 'png' })
        const result = Buffer.isBuffer(screenshotBuffer) ? screenshotBuffer : Buffer.from(screenshotBuffer)
        // 成功渲染后增加计数，并判断是否需要重启
        renderCount++
        /** 计算图片大小 */
        const kb = (result.length / 1024).toFixed(2) + "KB"
        logger.mark(
            `[图片生成][${templateName}][${renderCount}次] ${kb} ${logger.green(`${Date.now() - start}ms`)}`,
        )
        if (renderCount >= restartThreshold) {
            logger.info(`[Schedule] 已达到渲染次数阈值 (${renderCount}/${restartThreshold})，重启Puppeteer`)
            // 异步执行重启，不阻塞当前图片返回
            restartBrowser().catch(err => logger.error('[Schedule] 异步重启失败', err))
        }
        return result
    } catch (err) {
        logger.error(`[Schedule] 渲染模板 ${templateName} 失败:`, err)
        return null
    } finally {
        await page.close()
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
    let dateStr = '';
    if (targetDate) {
        dateStr = targetDate.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
    }
    const weekdayMap = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '日' };
    const templateData = {
        nickname: userData.nickname,
        week: userData.week,
        weekday: weekdayMap[userData.day],
        date: dateStr,
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
        tips: '使用 #今日课表 等命令查看每日课程'
    };

    return await renderTemplate('user-info-template', templateData, mergedOptions);
}

/**
 * 生成生日列表图片
 * @param {Object} data 模板数据
 * @param {Object} options 额外选项
 * @returns {Promise<Buffer|null>}
 */
export async function renderBirthdayList(data, options = {}) {
    const config = ConfigManager.getConfig()
    const scale = config.renderScale ?? 1.0
    const mergedOptions = { ...options, scale }

    const now = new Date()
    const templateData = {
        ...data,
        updateTime: now.toLocaleString('zh-CN')
    }
    return await renderTemplate('birthday-list', templateData, mergedOptions)
}
/**
 *  获取字体映射
 */
function getFontMap() {
    if (fontMapCache) return fontMapCache
    const fontMapPath = path.join(pluginRoot, 'resources', 'fonts.json')
    try {
        if (fs.existsSync(fontMapPath)) {
            const content = fs.readFileSync(fontMapPath, 'utf8')
            fontMapCache = JSON.parse(content)
        } else {
            fontMapCache = { "像素": "unifont.otf" }  // 默认回退
        }
    } catch (err) {
        logger.error('[Schedule] 读取 fonts.json 失败', err)
        fontMapCache = { "像素": "unifont.otf" }
    }
    return fontMapCache
}
/**
 * 获取字体配置
 */
function getFontFileInfo() {
    const config = ConfigManager.getConfig()
    const fontName = config.font || "像素"
    const fontMap = getFontMap()
    let fontFile = fontMap[fontName]
    if (!fontFile) {
        logger.warn(`[Schedule] 未找到字体映射：${fontName}，将使用默认字体 unifont.otf`)
        fontFile = "unifont.otf"
    }
    // 根据扩展名决定 format 类型
    const ext = path.extname(fontFile).toLowerCase()
    let formatType = 'opentype'  // 默认
    if (ext === '.ttf') formatType = 'TrueType'
    else if (ext === '.otf') formatType = 'opentype'
    else if (ext === '.woff') formatType = 'woff'
    else if (ext === '.woff2') formatType = 'woff2'
    return { fontFile, formatType }
}
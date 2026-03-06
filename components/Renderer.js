/*
 * @Author: Temmie0125 1179755948@qq.com
 * @Date: 2026-03-06 13:48:02
 * @LastEditors: Temmie0125 1179755948@qq.com
 * @LastEditTime: 2026-03-06 13:48:28
 * @FilePath: \实验与作业e:\bot\Yunzai\plugins\schedule\components\Renderer.js
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
// components/Renderer.js
// import fs from 'node:fs'
// import path from 'node:path'

// 动态导入 puppeteer（避免启动时加载）
let puppeteer
async function getPuppeteer() {
    if (!puppeteer) {
        puppeteer = (await import('../../../lib/puppeteer/puppeteer.js')).default
    }
    return puppeteer
}

/**
 * 生成群课表图片
 * @param {Array} members - 成员数据
 * @param {number} currentWeek - 当前周（系统周）
 * @param {number} currentDay - 当前星期（1-7）
 * @returns {Promise<Buffer|null>}
 */
export async function generateScheduleImage(members, currentWeek, currentDay) {
    try {
        const puppeteer = await getPuppeteer()
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

        return await puppeteer.screenshot('群课表状态', {
            tplFile: './plugins/schedule/resources/template/schedule-template.html',
            filePath: './plugins/schedule/resources/',
            ...templateData
        })
    } catch (err) {
        logger.error(`生成课表图片失败: ${err}`)
        return null
    }
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
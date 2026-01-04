import fs from 'node:fs'
import path from 'node:path'

export class GroupSchedulePlugin extends plugin {
  constructor() {
    super({
      name: "群课表查询",
      dsc: "查看群成员上课状态与翘课功能",
      event: "message",
      priority: 1000,
      rule: [
        {
          reg: "^#(群课表|课程表|群友课表)$",
          fnc: "showGroupSchedule"
        },
        {
          reg: "^#(翘课|取消翘课)$",
          fnc: "toggleSkipClass"
        }
      ]
    })

    this.dataPath = 'plugins/schedule/data/'
    this.skipStatusPath = 'plugins/schedule/skip-status.json'
  }

  /**
   * 显示群上课情况
   */
  async showGroupSchedule() {
    const groupId = this.e.group_id

    if (!groupId) {
      await this.reply("请在群聊中使用此命令")
      return false
    }

    // 获取当前时间信息
    const now = new Date()
    const currentWeek = this.calculateCurrentWeek()
    const currentDay = now.getDay() === 0 ? 7 : now.getDay()
    const currentTime = now.toTimeString().slice(0, 5) // HH:MM

    // 获取群成员列表（简化版，实际需要调用bot接口）
    const groupMembers = await this.getGroupMembers(groupId)

    // 收集有课表的成员信息
    const membersWithSchedule = []

    for (const member of groupMembers) {
      const userId = member.user_id
      const scheduleData = this.loadScheduleData(userId)

      if (scheduleData) {
        // 获取用户翘课状态
        const skipStatus = await this.loadSkipStatus(userId)
        // 获取用户个性签名
        const signature = scheduleData.signature || "此人很懒，还没有设置个性签名~"

        // 获取学期开始日期并计算当前周数
        const semesterStart = scheduleData.semesterStart
        const userCurrentWeek = this.calculateCurrentWeek(semesterStart)

        // 获取今日课程和当前状态
        const todayCourses = scheduleData.courses.filter(course =>
          parseInt(course.day) === currentDay &&
          course.weeks.includes(userCurrentWeek)
        )

        // 按时间排序
        todayCourses.sort((a, b) => a.startTime.localeCompare(b.startTime))

        // 查找当前课程或最近课程
        let currentCourse = null
        let status = '无课程'
        let remainingTime = null

        if (todayCourses.length > 0) {
          // 查找正在进行的课程
          const ongoingCourse = todayCourses.find(course =>
            currentTime >= course.startTime && currentTime <= course.endTime
          )

          if (ongoingCourse) {
            currentCourse = ongoingCourse
            if (skipStatus) {
              status = '翘课中'
            } else {
              status = '进行中'
              // 计算剩余时间
              remainingTime = this.calculateRemainingTime(currentTime, ongoingCourse.endTime)
            }
          } else {
            // 查找下一个课程
            const nextCourse = todayCourses.find(course => currentTime < course.startTime)
            if (nextCourse) {
              currentCourse = nextCourse
              status = '未开始'
              // 计算距离开始时间
              remainingTime = this.calculateTimeUntil(currentTime, nextCourse.startTime)
            } else {
              // 所有课程都已结束
              currentCourse = todayCourses[todayCourses.length - 1]
              status = '已结束'
            }
          }
        }

        membersWithSchedule.push({
          userId,
          nickname: scheduleData.nickname || member.nickname || `用户${userId}`,
          avatar: await this.getAvatarUrl(userId),
          currentCourse,
          status,
          remainingTime,
          skipStatus,
          signature,  // 新增：个性签名
          currentWeek: userCurrentWeek, // 添加个人周数
          hasSemesterStart: !!semesterStart // 标记是否有学期开始日期
        })
      }
    }

    // 修改showGroupSchedule方法的最后部分
    if (membersWithSchedule.length === 0) {
      await this.reply("本群暂无成员设置课程表");
      return false;
    }

    // 发送课表消息
    await this.sendScheduleMessage(membersWithSchedule, currentWeek, currentDay);
    return true;
  }
  /**
 * 发送课表消息
 */
  async sendScheduleMessage(members, currentWeek, currentDay) {
    try {
      // 生成图片
      const image = await this.generateScheduleImage(members, currentWeek, currentDay);

      if (image) {
        await this.reply(image);
        return true;
      } else {
        // 降级为文本消息
        logger.error(`发送课表图片失败`);
        //await this.reply(this.generateTextSchedule(members, currentWeek, currentDay));
        return false;
      }
    } catch (error) {
      logger.error(`发送课表消息失败: ${error}`);
      await this.reply("生成课表失败，请稍后重试");
      return false;
    }
  }

  /**
  * 生成文本格式的课表（备用方案）
  */
  generateTextSchedule(members, currentWeek, currentDay) {
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
   * 切换翘课状态
   */
  async toggleSkipClass() {
    const userId = this.e.user_id
    const message = this.e.msg

    // 检查是否有课程表
    const scheduleData = this.loadScheduleData(userId)
    if (!scheduleData) {
      await this.reply("请先使用 #设置课表 命令导入课程表")
      return false
    }

    // 加载当前翘课状态
    const skipData = await this.loadAllSkipStatus()
    const currentStatus = skipData[userId] || false
    let newStatus = true
    if (message.search("取消") !== -1) {
      if (!currentStatus) {
        return this.reply(`你还未处于翘课模式，无需取消`)
      }
      newStatus = false
    }
    else {
      if (currentStatus) {
        return this.reply(`你已经处于翘课模式，无需再次开启`)
      }
      newStatus = true
    }
    // 更新状态
    skipData[userId] = newStatus
    await this.saveSkipStatus(skipData)

    // 获取昵称
    const nickname = scheduleData.nickname || `用户${userId}`

    await this.reply(`${nickname} ${newStatus ? '已开启翘课模式' : '已取消翘课模式'}`)
    return true
  }

  /**
   * 生成HTML卡片
   */
  generateScheduleCard(members, currentWeek, currentDay) {
    const weekdayMap = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '日' }
    const weekday = weekdayMap[currentDay]
    const now = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })

    // 按状态分组和排序：进行中 > 翘课中 > 未开始 > 已结束 > 无课程
    const statusOrder = {
      '进行中': 0,
      '翘课中': 1,
      '未开始': 2,
      '已结束': 3,
      '无课程': 4
    }

    members.sort((a, b) => {
      if (statusOrder[a.status] !== statusOrder[b.status]) {
        return statusOrder[a.status] - statusOrder[b.status]
      }
      return a.nickname.localeCompare(b.nickname)
    })

    let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body {
          font-family: 'Microsoft YaHei', sans-serif;
          margin: 0;
          padding: 20px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
        }
        .container {
          max-width: 1200px;
          margin: 0 auto;
          background: rgba(255, 255, 255, 0.95);
          border-radius: 20px;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
          overflow: hidden;
        }
        .header {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 30px;
          text-align: center;
        }
        .header h1 {
          margin: 0;
          font-size: 28px;
          font-weight: bold;
        }
        .header .subtitle {
          margin-top: 10px;
          opacity: 0.9;
          font-size: 16px;
        }
        .stats {
          display: flex;
          justify-content: space-around;
          padding: 20px;
          background: #f8f9fa;
          border-bottom: 1px solid #dee2e6;
        }
        .stat-item {
          text-align: center;
        }
        .stat-value {
          font-size: 24px;
          font-weight: bold;
          color: #667eea;
        }
        .stat-label {
          font-size: 14px;
          color: #6c757d;
          margin-top: 5px;
        }
        .members-list {
          padding: 20px;
        }
        .member-card {
          display: flex;
          align-items: center;
          background: white;
          border-radius: 15px;
          padding: 20px;
          margin-bottom: 15px;
          box-shadow: 0 5px 15px rgba(0, 0, 0, 0.08);
          transition: transform 0.3s, box-shadow 0.3s;
          border-left: 5px solid #667eea;
        }
        .member-card:hover {
          transform: translateY(-5px);
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
        }
        .member-avatar {
          width: 60px;
          height: 60px;
          border-radius: 50%;
          overflow: hidden;
          margin-right: 20px;
          border: 3px solid #fff;
          box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1);
        }
        .member-avatar img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .member-info {
          flex: 1;
        }
        .member-name {
          font-size: 18px;
          font-weight: bold;
          color: #333;
          margin-bottom: 5px;
        }
        .member-status {
          display: inline-block;
          padding: 4px 12px;
          border-radius: 20px;
          font-size: 14px;
          font-weight: bold;
          margin-bottom: 8px;
        }
        .status-进行中 { background: #4caf50; color: white; }
        .status-翘课中 { background: #f44336; color: white; }
        .status-未开始 { background: #2196f3; color: white; }
        .status-已结束 { background: #9e9e9e; color: white; }
        .status-无课程 { background: #ff9800; color: white; }
        .course-info {
          font-size: 14px;
          color: #666;
          margin-bottom: 5px;
        }
        .course-time {
          font-size: 13px;
          color: #888;
        }
        .remaining-time {
          font-size: 13px;
          color: #e91e63;
          font-weight: bold;
        }
        .skip-tag {
          display: inline-block;
          background: #ff5252;
          color: white;
          font-size: 12px;
          padding: 2px 8px;
          border-radius: 10px;
          margin-left: 10px;
          animation: pulse 2s infinite;
        }
        @keyframes pulse {
          0% { opacity: 1; }
          50% { opacity: 0.7; }
          100% { opacity: 1; }
        }
        .no-courses {
          text-align: center;
          padding: 40px;
          color: #666;
          font-size: 16px;
        }
        .footer {
          text-align: center;
          padding: 20px;
          background: #f8f9fa;
          color: #666;
          font-size: 14px;
          border-top: 1px solid #dee2e6;
        }
        .legend {
          display: flex;
          justify-content: center;
          gap: 20px;
          margin-top: 10px;
        }
        .legend-item {
          display: flex;
          align-items: center;
          font-size: 12px;
        }
        .legend-color {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          margin-right: 5px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>📚 群课表状态</h1>
          <div class="subtitle">
            第${currentWeek}周 星期${weekday} | 当前时间: ${now}
          </div>
        </div>
        
        <div class="stats">
          <div class="stat-item">
            <div class="stat-value">${members.length}</div>
            <div class="stat-label">有课表成员</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">${members.filter(m => m.status === '进行中').length}</div>
            <div class="stat-label">上课中</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">${members.filter(m => m.status === '翘课中').length}</div>
            <div class="stat-label">翘课中</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">${members.filter(m => m.skipStatus).length}</div>
            <div class="stat-label">开启翘课</div>
          </div>
        </div>
        
        <div class="members-list">
    `

    members.forEach(member => {
      const statusClass = `status-${member.status}`
      const avatarUrl = member.avatar || 'https://q1.qlogo.cn/g?b=qq&nk=' + member.userId + '&s=640'

      html += `
          <div class="member-card">
            <div class="member-avatar">
              <img src="${avatarUrl}" alt="${member.nickname}">
            </div>
            <div class="member-info">
              <div class="member-name">
                ${member.nickname}
                ${member.skipStatus ? '<span class="skip-tag">翘课模式</span>' : ''}
              </div>
              <div class="member-status ${statusClass}">
                ${member.status}
              </div>
      `
      // 新增：显示签名（当状态为"无课程"或"已结束"时）
      if ((member.status === '无课程' || member.status === '已结束') && member.signature) {
        html += `
              <div class="member-signature">
                💭 ${member.signature}
              </div>
      `
      }

      if (member.currentCourse) {
        html += `
              <div class="course-info">
                📖 ${member.currentCourse.name}
              </div>
              <div class="course-time">
                ⏰ ${member.currentCourse.startTime} - ${member.currentCourse.endTime}
                ${member.currentCourse.location ? ` | 📍 ${member.currentCourse.location}` : ''}
              </div>
        `

        if (member.remainingTime) {
          if (member.status === '进行中') {
            html += `
              <div class="remaining-time">
                ⏳ 剩余时间: ${member.remainingTime}
              </div>
            `
          } else if (member.status === '未开始') {
            html += `
              <div class="remaining-time">
                ⏳ 距离上课: ${member.remainingTime}
              </div>
            `
          }
        }
      } else {
        html += `
              <div class="course-info">
                今日暂无课程安排
              </div>
        `
      }

      html += `
            </div>
          </div>
      `
    })

    html += `
        </div>
        
        <div class="footer">
          <div>使用 #翘课 或 #取消翘课 切换翘课状态</div>
          <div class="legend">
            <div class="legend-item">
              <div class="legend-color" style="background: #4caf50;"></div>
              上课中
            </div>
            <div class="legend-item">
              <div class="legend-color" style="background: #f44336;"></div>
              翘课中
            </div>
            <div class="legend-item">
              <div class="legend-color" style="background: #2196f3;"></div>
              未开始
            </div>
            <div class="legend-item">
              <div class="legend-color" style="background: #9e9e9e;"></div>
              已结束
            </div>
            <div class="legend-item">
              <div class="legend-color" style="background: #ff9800;"></div>
              无课程
            </div>
          </div>
          <div style="margin-top: 10px; font-size: 12px;">
            更新时间: ${new Date().toLocaleString('zh-CN')}
          </div>
        </div>
      </div>
    </body>
    </html>
    `

    return html
  }

  /**
 * 计算当前周数
 */
  calculateCurrentWeek(semesterStart) {
    if (!semesterStart) {
      // 如果没有提供学期开始日期，使用默认值
      const defaultStart = new Date('2024-02-26')
      const now = new Date()
      const timeDiff = now.getTime() - defaultStart.getTime()
      const dayDiff = Math.floor(timeDiff / (1000 * 3600 * 24))
      const week = Math.ceil(dayDiff / 7)
      return Math.max(1, week)
    }

    const startDate = new Date(semesterStart)
    const now = new Date()

    // 计算天数差
    const timeDiff = now.getTime() - startDate.getTime()
    const dayDiff = Math.floor(timeDiff / (1000 * 3600 * 24))

    // 计算周数（向上取整，第一周从1开始）
    const week = Math.ceil(dayDiff / 7)

    return Math.max(1, week) // 确保周数至少为1
  }

  /**
   * 计算剩余时间
   */
  calculateRemainingTime(currentTime, endTime) {
    const [currentHour, currentMinute] = currentTime.split(':').map(Number)
    const [endHour, endMinute] = endTime.split(':').map(Number)

    const currentTotalMinutes = currentHour * 60 + currentMinute
    const endTotalMinutes = endHour * 60 + endMinute

    const remainingMinutes = endTotalMinutes - currentTotalMinutes

    if (remainingMinutes >= 60) {
      const hours = Math.floor(remainingMinutes / 60)
      const minutes = remainingMinutes % 60
      return `${hours}小时${minutes}分钟`
    } else {
      return `${remainingMinutes}分钟`
    }
  }

  /**
   * 计算距离上课时间
   */
  calculateTimeUntil(currentTime, startTime) {
    const [currentHour, currentMinute] = currentTime.split(':').map(Number)
    const [startHour, startMinute] = startTime.split(':').map(Number)

    const currentTotalMinutes = currentHour * 60 + currentMinute
    const startTotalMinutes = startHour * 60 + startMinute

    const minutesUntil = startTotalMinutes - currentTotalMinutes

    if (minutesUntil >= 60) {
      const hours = Math.floor(minutesUntil / 60)
      const minutes = minutesUntil % 60
      return `${hours}小时${minutes}分钟`
    } else {
      return `${minutesUntil}分钟`
    }
  }

  /**
   * 加载课程表数据
   */
  loadScheduleData(userId) {
    const filePath = path.join(this.dataPath, `${userId}.json`)

    if (fs.existsSync(filePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
        return data
      } catch (error) {
        logger.error(`读取用户 ${userId} 课程表失败: ${error}`)
        return null
      }
    }

    return null
  }

  /**
   * 加载翘课状态
   */
  async loadSkipStatus(userId) {
    const skipData = await this.loadAllSkipStatus()
    return skipData[userId] || false
  }

  /**
   * 加载所有翘课状态
   */
  async loadAllSkipStatus() {
    if (fs.existsSync(this.skipStatusPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.skipStatusPath, 'utf8'))
        return data
      } catch (error) {
        logger.error(`读取翘课状态失败: ${error}`)
        return {}
      }
    }
    return {}
  }

  /**
   * 保存翘课状态
   */
  async saveSkipStatus(data) {
    try {
      // 确保目录存在
      const dir = path.dirname(this.skipStatusPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      fs.writeFileSync(this.skipStatusPath, JSON.stringify(data, null, 2), 'utf8')
      return true
    } catch (error) {
      logger.error(`保存翘课状态失败: ${error}`)
      return false
    }
  }

  /**
   * 获取群成员列表
   */
  async getGroupMembers(groupId) {
    try {
      // 这里需要根据实际的Bot API获取群成员
      // 示例代码，实际需要替换为正确的API调用
      if (typeof Bot === 'undefined') {
        // 模拟数据用于测试
        const mockMembers = [
          { user_id: 10001, nickname: '张三' },
          { user_id: 10002, nickname: '李四' },
          { user_id: 10003, nickname: '王五' },
        ]
        return mockMembers
      }

      // 实际调用Bot API获取群成员
      const group = await Bot.pickGroup(groupId)
      const memberList = await group.getMemberMap()
      return Array.from(memberList.values())
    } catch (error) {
      logger.error(`获取群成员失败: ${error}`)
      return []
    }
  }

  /**
   * 获取用户头像URL
   */
  async getAvatarUrl(userId) {
    // QQ头像地址
    return `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=640`
  }
  /**
* 生成课表图片
*/
  async generateScheduleImage(members, currentWeek, currentDay) {
    try {
      const puppeteer = (await import('../../../lib/puppeteer/puppeteer.js')).default;

      const weekdayMap = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '日' };
      const weekday = weekdayMap[currentDay];
      const now = new Date();
      const currentTime = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      const updateTime = now.toLocaleString('zh-CN');

      // 准备模板数据
      const templateData = {
        // 移除 currentWeek 和 weekday
        weekday,
        currentTime,
        updateTime,
        totalMembers: members.length,
        studyingCount: members.filter(m => m.status === '进行中').length,
        skippingCount: members.filter(m => m.status === '翘课中').length,
        skipModeCount: members.filter(m => m.skipStatus).length,
        members: members.map(member => ({
          ...member,
          avatar: member.avatar || `https://q1.qlogo.cn/g?b=qq&nk=${member.userId}&s=640`,
          signature: member.signature || "", // 新增：传递签名
          currentWeek: member.currentWeek, // 个人周数
          hasSemesterStart: member.hasSemesterStart
        }))
      };

      // 使用puppeteer.screenshot，传递模板路径和数据
      const image = await puppeteer.screenshot('群课表状态', {
        tplFile: './plugins/schedule/resources/template/schedule-template.html',
        filePath: './plugins/schedule/resources/',
        ...templateData
      });

      return image;
    } catch (error) {
      logger.error(`生成课表图片失败: ${error}`);
      return null;
    }
  }

  // 在GroupSchedulePlugin类中添加
  // 修改generateImageFromHtml方法
  async generateImageFromHtml(html) {
    try {
      // 使用已有的puppeteer模块（与work.js相同）
      const puppeteer = (await import('../../../lib/puppeteer/puppeteer.js')).default;

      // 创建临时HTML文件
      const tempHtmlPath = path.join(this.dataPath, 'temp_schedule.html')

      // 确保目录存在
      const dir = path.dirname(tempHtmlPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      // 写入HTML内容到临时文件
      fs.writeFileSync(tempHtmlPath, html, 'utf8')

      // 使用puppeteer.screenshot方法（与work.js相同）
      const image = await puppeteer.screenshot('群课表状态', {
        tplFile: tempHtmlPath,
        // 设置文件路径，确保能找到HTML文件
        filePath: dir,
        // 这里可以根据需要传递数据，但我们使用完整的HTML所以不需要额外数据
        data: {}
      })

      // 清理临时文件
      setTimeout(() => {
        if (fs.existsSync(tempHtmlPath)) {
          fs.unlinkSync(tempHtmlPath)
        }
      }, 5000)

      return image
    } catch (error) {
      logger.error(`生成图片失败: ${error}`)
      return null
    }
  }

  // 修改sendHtmlMessage方法
  async sendHtmlMessage(html) {
    try {
      // 生成图片
      const imageBuffer = await this.generateImageFromHtml(html)

      if (imageBuffer) {
        // 保存临时文件并发送
        const tempPath = path.join(this.dataPath, 'temp_schedule.png')
        fs.writeFileSync(tempPath, imageBuffer)

        // 发送图片
        await this.reply(segment.image(`file://${tempPath}`))

        // 清理临时文件
        setTimeout(() => {
          if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath)
          }
        }, 5000)
      }
    } catch (error) {
      logger.error(`发送HTML消息失败: ${error}`)
      // 降级为文本格式
      await this.reply("生成课表卡片失败，请稍后重试")
    }
  }
}

export default GroupSchedulePlugin
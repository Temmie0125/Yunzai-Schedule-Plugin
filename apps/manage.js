import fs from 'node:fs'
import path from 'node:path'
import { getFileInfo } from '../components/common.js'
import { DataManager } from '../components/DataManager.js'
import { importScheduleFromCode, importScheduleFromJsonData } from '../services/scheduleImporter.js'
export class ScheduleManage extends plugin {
    constructor() {
        super({
            name: "课程表管理",
            dsc: "课表管理，包括导入、导出与个人信息维护",
            event: "message",
            priority: 1000,
            rule: [
                // ===== 基础命令区 =====
                {
                    reg: "^#(设置课表|schedule set)(?:\\s+(.+))?$",
                    fnc: "setSchedule"
                },
                {
                    reg: "^#导入课表$",
                    fnc: "importFromFile"
                },
                {
                    reg: "^#导出(拾光)?课表(拾光)?$",
                    fnc: "exportSchedule"
                },
                {
                    reg: "^#(清除课表|schedule (clear|delete))$",
                    fnc: "clearSchedule"
                },
                {
                    reg: "^#(课表设置昵称|schedule setname)(?:\\s+(.+))?$",
                    fnc: "setNickname"
                },
                {
                    reg: "^#(课表设置签名|schedule setsign)(?:\\s+(.+))?$",
                    fnc: "setSignature"
                },
                // ===== 新增规则：直接识别包含「口令」的消息 =====
                {
                    reg: ".*「[0-9a-zA-Z\\-_]+」.*",
                    fnc: "handleDirectCode"
                },

            ]
        })
    }
    /**
     * 处理 #设置课表 命令
     */
    async setSchedule() {
        const userId = this.e.user_id;
        const message = this.e.msg;
        let code = message.match(/^#(?:设置课表|schedule set)\s+(.+)$/)?.[1];
        if (!code) {
            this.setContext("waitingForCode");
            await this.reply("请发送你的WakeUp课程表分享口令", false, { at: true });
            return true;
        }
        code = code.trim();
        const match = code.match(/「([0-9a-zA-Z\-_]+?)」/u);
        if (match) {
            code = match[1];
        }
        // 调用服务
        const result = await importScheduleFromCode(userId, code, this.e);
        await this.reply(result.message);
        return true;
    }
    /**
     * 上下文等待口令
     */
    async waitingForCode() {
        const userId = this.e.user_id;
        let code = this.e.msg.trim();
        this.finish("waitingForCode");
        const match = code.match(/「([0-9a-zA-Z\-_]+?)」/u);
        if (match) {
            code = match[1];
        }
        const result = await importScheduleFromCode(userId, code, this.e);
        await this.reply(result.message);
        return true;
    }
    /**
     * 直接处理包含「口令」的消息
     */
    async handleDirectCode() {
        const userId = this.e.user_id;
        const message = this.e.msg;
        const match = message.match(/「([0-9a-zA-Z\-_]+?)」/u);
        if (!match) return false;  // 没有口令，不处理
        const code = match[1];
        // 一般分享口令为32位，为避免误触发，小于20位的不处理
        if (code.length < 20) {
            logger.warn("[课表导入] 非标准分享口令，请检查是否有误")
            return false;
        }
        const result = await importScheduleFromCode(userId, code, this.e);
        await this.reply(result.message);
        return true;
    }
    /**
     * 课表昵称
     */
    async setNickname() {
        const userId = this.e.user_id
        const message = this.e.msg
        // 提取昵称
        const match = message.match(/^#(?:课表设置昵称|schedule setname)\s+(.+)$/)
        if (!match) {
            this.setContext("waitingForNickname")
            await this.reply("请发送你想要设置的昵称", false, { at: true })
            return true
        }
        const nickname = match[1].trim()
        // 昵称长度检查
        if (nickname.length > 20) {
            await this.reply("昵称太长了，请控制在20个字符以内")
            return false
        }
        // 保存昵称
        const success = await DataManager.saveUserNickname(userId, nickname)
        if (success) {
            await this.reply(`昵称设置成功：${nickname}`)
            logger.info(`用户 ${userId} 设置昵称为：${nickname}`)
        } else {
            await this.reply("昵称设置失败，请重试")
        }
        return true
    }
    /**
     * 等待用户发送昵称（上下文模式）
     */
    async waitingForNickname() {
        const userId = this.e.user_id
        const nickname = this.e.msg.trim()
        // 结束上下文
        this.finish("waitingForNickname")
        // 昵称长度检查
        if (nickname.length > 20) {
            await this.reply("昵称太长了，请控制在20个字符以内")
            return false
        }
        // 保存昵称
        const success = await DataManager.saveUserNickname(userId, nickname)
        if (success) {
            await this.reply(`昵称设置成功：${nickname}`)
            logger.info(`用户 ${userId} 设置昵称为：${nickname}`)
        } else {
            await this.reply("昵称设置失败，请重试")
        }
        return true
    }
    /**
     * 设置个性签名
     */
    async setSignature() {
        const userId = this.e.user_id
        const message = this.e.msg
        // 提取签名
        const match = message.match(/^#(?:课表设置签名|schedule setsign)\s+(.+)$/)
        if (!match) {
            this.setContext("waitingForSignature")
            await this.reply("请发送你想要设置的个性签名（最多30字）", false, { at: true })
            return true
        }
        let signature = match[1].trim()
        // 签名长度检查
        if (signature.length > 30) {
            await this.reply("签名太长了，请控制在30字以内")
            return false
        }
        // 保存签名
        const success = await DataManager.saveUserSignature(userId, signature)
        if (success) {
            await this.reply(`个性签名设置成功：${signature}`)
            logger.info(`用户 ${userId} 设置个性签名：${signature}`)
        } else {
            await this.reply("签名设置失败，请重试")
        }
        return true
    }
    /**
     * 等待用户发送签名（上下文模式）
     */
    async waitingForSignature() {
        const userId = this.e.user_id
        let signature = this.e.msg.trim()
        // 结束上下文
        this.finish("waitingForSignature")
        // 签名长度检查
        if (signature.length > 30) {
            await this.reply("签名太长了，请控制在30字以内")
            return false
        }
        // 保存签名
        const success = await DataManager.saveUserSignature(userId, signature)
        if (success) {
            await this.reply(`个性签名设置成功：${signature}`)
            logger.info(`用户 ${userId} 设置个性签名：${signature}`)
        } else {
            await this.reply("签名设置失败，请重试")
        }
        return true
    }
    /**
     * 清除课表
     */
    async clearSchedule() {
        const userId = this.e.user_id;
        const result = DataManager.clearUserCourses(userId);
        if (result.success) {
            await this.reply("你的课程表已清除");
        } else {
            if (!result.exists) {
                await this.reply("你还没有设置课程表");
            } else {
                await this.reply("清除课程表失败，请稍后重试");
            }
        }
        return true;
    }
    /**
     * 导入课表文件（命令入口）
     */
    async importFromFile() {
        this.setContext("waitingForImportFile");
        await this.reply("请发送你要导入的JSON文件（支持本插件原生课表JSON或拾光课程表导出文件）", false, { at: true });
        return true;
    }
    async waitingForImportFile() {
        this.finish("waitingForImportFile");
        const e = this.e;
        const fileInfo = getFileInfo(e);
        if (!fileInfo) {
            await this.reply("未检测到有效的文件信息，请直接发送 JSON 文件");
            return false;
        }
        const { fileName, fileSize, fileId } = fileInfo;
        const MAX_SIZE = 2 * 1024 * 1024; // 2MB
        // 1. 校验文件扩展名
        if (!fileName.toLowerCase().endsWith('.json')) {
            await this.reply("❌ 只支持 JSON 格式的文件，请发送扩展名为 .json 的文件");
            return false;
        }
        // 2. 校验文件大小
        if (fileSize > MAX_SIZE) {
            const sizeKB = (fileSize / 1024).toFixed(2);
            await this.reply(`❌ 文件过大（${sizeKB}KB），请确保 JSON 文件小于 2MB`);
            return false;
        }
        // 3. 获取文件内容
        let fileContent;
        try {
            fileContent = await this.getFileContent(fileId);
        } catch (err) {
            logger.error(`[课表导入] 获取文件内容异常: ${err}`);
            await this.reply("读取文件失败，请稍后重试");
            return false;
        }
        if (!fileContent) {
            await this.reply("无法读取文件内容，请确保文件有效");
            return false;
        }
        // 4. 解析 JSON
        let jsonData;
        try {
            jsonData = JSON.parse(fileContent);
        } catch (err) {
            await this.reply("文件内容不是合法的 JSON 格式");
            return false;
        }
        // 5. 导入课表
        const result = await importScheduleFromJsonData(e.user_id, jsonData, e);
        await this.reply(result.message);
        return true;
    }
    /**
   * 辅助方法：从消息中获取文件文本内容（适配 TRSS 框架）
   * @returns {Promise<string|null>}
   */
    async getFileContent() {
        const e = this.e;
        let fileId = e.file?.data?.file_id || e.file?.file_id;
        if (!fileId) {
            logger.warn("[课表导入] 无法获取 file_id");
            return null;
        }
        try {
            // 调用 get_file API 获取文件信息
            let fileInfo = null;
            if (typeof Bot.sendApi === 'function') {
                fileInfo = await Bot.sendApi('get_file', { file_id: fileId });
            } else if (Bot.api && typeof Bot.api.get_file === 'function') {
                fileInfo = await Bot.api.get_file({ file_id: fileId });
            } else if (e.friend && typeof e.friend.sendApi === 'function') {
                fileInfo = await e.friend.sendApi('get_file', { file_id: fileId });
            } else if (e.group && typeof e.group.sendApi === 'function') {
                fileInfo = await e.group.sendApi('get_file', { file_id: fileId });
            } else {
                logger.error("[课表导入] 无法找到调用 OneBot API 的方法");
                return null;
            }
            if (!fileInfo || !fileInfo.data) {
                logger.error("[课表导入] 获取文件信息失败:", fileInfo);
                return null;
            }
            const data = fileInfo.data;
            // 优先使用 url 下载（若存在）
            if (data.url && data.url.startsWith('http')) {
                const response = await fetch(data.url);
                if (!response.ok) return null;
                return await response.text();
            }
            // 若 url 为空，尝试读取本地文件（data.file 为路径）
            if (data.file && typeof data.file === 'string') {
                const filePath = data.file;
                // 安全检查：只允许读取 .json 文件
                if (path.extname(filePath).toLowerCase() !== '.json') {
                    logger.warn(`[课表导入] 文件扩展名不是 .json: ${filePath}`);
                    return null;
                }
                // 二次确认文件大小（防止外层校验后文件被替换）
                if (fs.existsSync(filePath)) {
                    const stats = fs.statSync(filePath);
                    const MAX_SIZE = 2 * 1024 * 1024; // 2MB
                    if (stats.size > MAX_SIZE) {
                        logger.warn(`[课表导入] 文件大小超限: ${stats.size} bytes`);
                        return null;
                    }
                    const content = fs.readFileSync(filePath, 'utf-8');
                    logger.info(`[课表导入] 成功读取本地文件: ${filePath}`);
                    // 异步删除临时文件（不阻塞返回，删除失败仅记录日志）
                    fs.unlink(filePath, (err) => {
                        if (err) {
                            logger.warn(`[课表导入] 删除临时文件失败: ${filePath}`, err);
                        } else {
                            logger.info(`[课表导入] 已删除临时文件: ${filePath}`);
                        }
                    });
                    return content;
                } else {
                    logger.warn(`[课表导入] 本地文件不存在: ${filePath}`);
                    return null;
                }
            }
            logger.error("[课表导入] 无法获取文件内容，既无下载链接也无本地路径");
            return null;
        } catch (err) {
            logger.error(`[课表导入] 获取文件内容失败: ${err}`);
            return null;
        }
    }
    /**
   * 导出课表
   */
    async exportSchedule() {
        const userId = this.e.user_id;
        const scheduleData = DataManager.loadSchedule(userId);
        if (!scheduleData) {
            await this.reply("你还没有设置课程表，请先导入课表");
            return false;
        }
        const isShiguang = this.e.msg.includes('拾光');
        let exportJson, fileName;
        if (isShiguang) {
            exportJson = DataManager.convertToShiguangFormat(scheduleData);
            fileName = `shiguang_schedule_${userId}_${Date.now()}.json`;
        } else {
            exportJson = DataManager.convertToNativeFormat(scheduleData);
            fileName = `schedule_${userId}_${Date.now()}.json`;
        }
        const jsonStr = JSON.stringify(exportJson, null, 2);
        const tmpDir = path.join(process.cwd(), 'data', 'temp');
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
        const filePath = path.join(tmpDir, fileName);
        fs.writeFileSync(filePath, jsonStr, 'utf-8');
        try {
            // 显式指定文件名（包含后缀）
            await this.e.reply(segment.file(filePath, fileName));
            // 5秒后删除临时文件
            setTimeout(() => {
                fs.unlink(filePath, (err) => {
                    if (err) logger.warn(`删除临时文件失败: ${filePath}`, err);
                    else logger.debug(`已删除临时文件: ${filePath}`);
                });
            }, 5000);
        } catch (err) {
            logger.error(`发送文件失败: ${err}`);
            await this.reply("生成文件失败，请稍后重试");
            fs.unlink(filePath, () => { });
        }
        return true;
    }
}
export default ScheduleManage
import fs from 'node:fs'
import path from 'node:path'
import { ConfigManager } from '../components/ConfigManager.js'
import { getBotName, getFileInfo, getFileContent, getGroupBotState, isOfficialMsg } from '../components/common.js'
import { DataManager } from '../components/DataManager.js'
import { urlImportButtons } from '../components/buttons.js'
import {
    importScheduleFromCode,
    importScheduleFromStarlinkCode,
    importScheduleFromJsonData,
    importScheduleFromIcsData,
    importScheduleFromWakeupData,
    handleAutoRecall
} from '../services/scheduleImporter.js'
import { importScheduleFromUrl } from '../services/urlImporter.js'
import { classifyImportInput, WAKEUP_CODE_MIN_LENGTH } from '../services/importInputRouter.js'
import { parseTimeTableJson } from '../services/timeTableParser.js'
import {
    parseChineseDateToMD,
    parseSemesterStartDate,
    formatDate
} from '../utils/timeUtils.js';

// 直链导入教程图（tmpfile.link 上传指引截图）
const URL_GUIDE_IMAGE = path.join(process.cwd(), 'plugins', 'schedule', 'resources', 'images', 'url_guide.png')
// 官方Bot群内接收消息设置文案
const RECV_SETTING_TEXT = {
    all: '接收全部消息',
    only_mention: '仅接收@消息',
    mention_and_context: '仅接收@与上下文消息'
}
export class ScheduleManage extends plugin {
    constructor() {
        super({
            name: "[Schedule] 课程表管理",
            dsc: "课表管理，包括导入、导出与个人信息维护",
            event: "message",
            priority: 1000,
            rule: [
                // ===== 基础命令区 =====
                {
                    // 统一导入入口：文件 / 文件直链 / 分享口令(码) / JSON 文本 均由本命令自动识别
                    // （原 #设置课表、#设置星链课表 等口令入口已合并至本命令）
                    // 参数用 [\s\S]+ 而非 .+ ：粘贴的课表 JSON 通常是多行文本，需允许跨行匹配
                    reg: "^#导入课表(?:\\s+([\\s\\S]+))?$",
                    fnc: "importSchedule"
                },
                {
                    // 直链导入教程：#导入课表(直链|链接)?教程 / #(导入)?(直链|链接)(导入)?教程 等
                    // 注意：无空格的 #导入课表直链教程 不会命中上面的通用规则（其参数要求前导空白）
                    reg: "^#导入课表(直链|链接)?(教程|指南|说明)$|^#(导入)?(直链|链接)(?:导入)?(教程|指南|说明)$",
                    fnc: "showUrlImportGuide"
                },
                {
                    reg: "^#导出(拾光)?课表(\\s)?(拾光)?$",
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
                {
                    reg: "^#(设置|修改)?学期开始(日期)?\\s+(.+)$",
                    fnc: "setSemesterStart"
                },
                {
                    reg: "^#(对齐课表|校历对齐|课表对齐|设置校历开学(日|日期))\\s+(.+)$",
                    fnc: "alignScheduleToCalendar"
                },
                {
                    reg: "^#(设置|上传|导入|更新)时间表$",
                    fnc: "updateTimeTable"
                },
                {
                    // 旧命令迁移提示：旧入口已删除，但静默无响应会让老用户以为 Bot 坏了。
                    // 本规则只提示、不导入，且必须排在下面的口令/文件被动监听之前——
                    // 宿主按规则顺序取首个返回非 false 的规则，避免旧命令消息被被动监听直接导入
                    reg: "^#(?:设置课表|设置星链课表|星链设置课表|schedule\\s+set)(?:\\s+[\\s\\S]+)?$",
                    fnc: "replyImportCommandMoved"
                },
                // ===== 被动识别规则（直接识别包含「口令」/「星链课表」的消息与文件） =====
                {
                    reg: ".*「[0-9a-zA-Z\\-_]+」.*",
                    fnc: "handleDirectCode"
                },
                {
                    reg: ".*「星链课表」.*",
                    fnc: "handleStarlinkDirect"
                },
                {
                    // 直接监听文件
                    reg: "",
                    fnc: "handleDirectFile",
                    log: false
                }
            ]
        })
    }
    /**
     * 统一导入入口（原 #设置课表 / #导入课表 已合并到本命令）
     * 带参数时按内容自动识别：文件直链 / 分享口令(码) / JSON 文本，识别失败给出用法提示；
     * 不带参数时：私聊直接进入统一等待上下文，群聊先做一次隐私确认（官方Bot群按接收设置走特例分支）。
     */
    async importSchedule() {
        const e = this.e;
        // 与规则正则保持一致：允许参数跨行（多行 JSON 文本直接粘贴导入）
        const arg = e.msg.match(/^#导入课表(?:\s+([\s\S]+))?$/)?.[1];
        if (arg && arg.trim()) {
            const input = classifyImportInput(arg);
            switch (input.type) {
                case 'url':
                    // 直链本身已公开于群聊，不做二次确认，直接导入
                    return await this.doImportFromUrl(input.value);
                case 'code':
                    return await this.doImportFromCode(input.value, input.variant);
                case 'json':
                    return await this.doImportFromJsonText(input.value);
                default:
                    return await this.replyImportUsage();
            }
        }
        if (e.group_id) {
            const isOfficial = isOfficialMsg(e);
            // 官方Bot群聊：未开启「接收全部消息」时文件导入闭环失效
            // （QQ客户端无法在发送文件的同时@机器人，Bot收不到文件），直接引导而非进入等待
            const botState = isOfficial ? await getGroupBotState(e) : null;
            if (botState?.recv_msg_setting && botState.recv_msg_setting !== 'all') {
                return await this.replyNonFullImportGuide(botState);
            }
            if (isOfficial && !botState?.recv_msg_setting) {
                // 官方Bot但群状态未知（bot_state接口需平台白名单，多数机器人调用失败）：
                // 跳过二次确认直接进入等待，并在提示中前置说明非全量限制与替代途径——
                // 避免"确认→发文件→Bot收不到"的死循环（确认换来的也是无法用文件）
                return await this.promptOfficialImport();
            }
            // 已知全量（或非官方平台）群聊：保留二次确认（导入内容可能包含个人课表，先提醒隐私）
            return await this.waitForConfirm('导入', 'confirmImport');
        }
        return await this.promptImportInput();
    }
    /**
     * 统一的导入等待提示（私聊 / 已知全量群聊）
     */
    async promptImportInput() {
        this.setContext("waitingForScheduleImport");
        await this.reply(
            `📥 请发送你的课表，以下方式任选其一：\n` +
            `① 课表文件：本插件原生JSON / 拾光课程表JSON / ICS / WakeUp备份(.wakeup_schedule)\n` +
            `② 文件直链：直接发送公网直链，或 #导入课表 <直链>（发送 #导入课表直链教程 查看教程）\n` +
            `③ 分享口令：直接发送 WakeUp 口令或星链课表分享码\n` +
            `输入“取消”以取消操作。`, false, { at: true });
        return true;
    }
    /**
     * 分享口令/分享码导入
     * @param {string} code 口令或分享码
     * @param {'wakeup'|'starlink'} variant 口令类型（由 importInputRouter 按长度判定）
     */
    async doImportFromCode(code, variant = 'wakeup') {
        const result = variant === 'starlink'
            ? await importScheduleFromStarlinkCode(this.e.user_id, code, this.e)
            : await importScheduleFromCode(this.e.user_id, code, this.e);
        await this.reply(result.message);
        return true;
    }
    /**
     * JSON 文本导入（用户直接把课表 JSON 粘进聊天）
     * @param {string} jsonText
     */
    async doImportFromJsonText(jsonText) {
        let jsonData;
        try {
            jsonData = JSON.parse(jsonText);
        } catch (err) {
            await this.reply('这段内容看起来是 JSON，但格式不合法，请检查后重试~');
            return false;
        }
        const result = await importScheduleFromJsonData(this.e.user_id, jsonData, this.e);
        await this.reply(result.message);
        return true;
    }
    /**
     * 无法识别的导入输入：给出统一用法提示
     */
    async replyImportUsage() {
        const botName = getBotName(this.e);
        await this.reply(
            `${botName}没能识别这条内容哦(｡•﹃•｡)\n` +
            `#导入课表 支持：课表文件 / 文件直链 / 分享口令(码) / JSON 文本\n` +
            `也可以只发送 #导入课表 后再发送文件、直链或口令。\n` +
            `直链获取方式见 #导入课表直链教程。`, false, { at: true });
        return true;
    }
    /**
     * 旧导入命令（#设置课表 等）迁移提示
     * 只提示不导入：旧入口已合并到 #导入课表，但仍需给出可照抄的新用法；
     * 若消息里带了口令且开启了自动撤回，则一并撤回该口令消息（否则口令会残留在群里）
     */
    async replyImportCommandMoved() {
        const e = this.e;
        const botName = getBotName(e);
        const config = ConfigManager.getConfig();
        let msg = `⚠️「#设置课表」已合并到「#导入课表」，用法如下：\n` +
            `① 分享口令/分享码：#导入课表 <口令>\n` +
            `② 课表文件直链：#导入课表 <直链>（教程：#导入课表直链教程）\n` +
            `③ 课表文件：只发送 #导入课表，随后发送文件即可\n` +
            `（文件、直链、口令、JSON 文本现在都由 #导入课表 自动识别）`;
        msg = await handleAutoRecall(msg, e, config.autoRecallCode ?? false, botName);
        await this.reply(msg, false, { at: true });
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
        // 一般分享口令为32位，为避免误触发，小于20位的不处理（可能是星链口令，由其他规则处理）
        if (code.length < WAKEUP_CODE_MIN_LENGTH) {
            return false;
        }
        const result = await importScheduleFromCode(userId, code, this.e);
        await this.reply(result.message);
        return true;
    }
    /**
    * 直接处理包含「星链课表」的消息，自动导入星链课表
    */
    async handleStarlinkDirect() {
        const userId = this.e.user_id;
        const message = this.e.msg;
        // 提取分享码：匹配“输入：XXXXX”或“输入:XXXXX”
        let code = null;
        const match = message.match(/输入[：:]\s*([0-9a-zA-Z\-_]+)/);
        if (match) {
            code = match[1];
        } else {
            // 兜底：提取5-20位字母数字横线（常见星链分享码长度）
            const fallback = message.match(/([0-9a-zA-Z\-_]{5,20})/);
            if (fallback) code = fallback[1];
        }
        if (!code) {
            logger.warn("[星链导入] 消息中包含「星链课表」但未找到分享码");
            return false; // 不处理，让其他插件继续
        }
        const result = await importScheduleFromStarlinkCode(userId, code, this.e);
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
     * 设置/上传/导入/更新时间表（命令入口）
     */
    async updateTimeTable() {
        // 检查用户是否有课程节次数据
        const userId = this.e.user_id;
        const schedule = DataManager.loadSchedule(userId);
        if (!schedule || !schedule.courses || schedule.courses.length === 0) {
            await this.reply('你还没有设置课程表，请先导入课表后再更新时间表。');
            return true;
        }
        if (this.e.group_id) {
            return await this.waitForConfirm('更新时间表', 'confirmUpdateTimeTable', '更新时间表');
        }
        this.setContext("waitingForTimeTable");
        await this.reply("请发送你的时间表 JSON 文件，或直接发送时间表的 JSON 文本内容。\n" +
            "时间表 JSON 可以从星链课表-右上角-上课时间-点击分享获取\n" +
            "输入\"取消\"以取消操作。", false, { at: true });
        return true;
    }

    async confirmUpdateTimeTable() {
        const userReply = this.e.msg.trim();
        this.finish("confirmUpdateTimeTable");
        if (userReply !== "确认") {
            await this.reply("❌ 已取消更新时间表操作。");
            return true;
        }
        this.setContext("waitingForTimeTable");
        await this.reply("请发送你的时间表 JSON 文件，或直接发送时间表的 JSON 文本内容。\n" +
            "时间表 JSON 可以从星链课表-右上角-上课时间-点击分享获取\n" +
            "输入\"取消\"以取消操作。", false, { at: true });
        return true;
    }

    async waitingForTimeTable() {
        this.finish("waitingForTimeTable");
        const e = this.e;
        const userId = e.user_id;
        const botName = getBotName(e);
        // 处理取消
        if (typeof e.msg === 'string') {
            const code = e.msg.trim();
            if (code === "取消" || code.toLowerCase() === "cancel") return this.reply("已取消更新时间表操作。");
        }
        let jsonText = null;
        // 优先检查是否为文件消息
        const fileInfo = getFileInfo(e);
        if (fileInfo) {
            const { fileName, fileSize, fileId, busid, fileHash, fileUrl } = fileInfo;
            const MAX_SIZE = 512 * 1024; // 512KB
            const ext = path.extname(fileName).toLowerCase();
            if (ext !== '.json') {
                await this.reply(`${botName}只接受 JSON 格式的时间表文件哦~`);
                return false;
            }
            if (fileSize > MAX_SIZE) {
                const sizeKB = (fileSize / 1024).toFixed(2);
                await this.reply(`文件太大了(${sizeKB}KB)，请发送小于 512KB 的 JSON 文件~`);
                return false;
            }
            try {
                jsonText = await getFileContent(e, fileId, busid, fileHash, fileUrl);
            } catch (err) {
                logger.error(`[时间表更新] 获取文件内容异常: ${err}`);
                await this.reply(`${botName}读取文件失败惹(｡•﹃•｡)，稍后再试试吧~`);
                return false;
            }
            if (!jsonText) {
                await this.reply(`${botName}无法读取文件内容，请确保文件有效`);
                return false;
            }
        } else if (typeof e.msg === 'string') {
            // 尝试直接解析为 JSON 文本
            jsonText = e.msg.trim();
        } else {
            await this.reply(`请发送 JSON 文件或 JSON 文本，${botName}看不懂其他格式哦~`);
            return false;
        }
        // 解析 JSON
        let jsonData;
        try {
            jsonData = JSON.parse(jsonText);
        } catch (err) {
            await this.reply('时间表内容不是合法的 JSON 格式，请检查后重试~');
            return false;
        }
        let timeSlotResult = parseTimeTableJson(jsonData)
        if (!timeSlotResult.success) {
            return this.reply(timeSlotResult.reply);
        }
        const timeSlotMap = timeSlotResult.timeSlotMap;
        // 执行更新
        const result = DataManager.updateCourseTimesBySlots(userId, timeSlotMap);
        if (!result.success) {
            await this.reply(`❌ 更新时间表失败：${result.error || '未知错误'}`);
            return true;
        }
        // 同时保存用户的时间表配置到数据文件
        const timeSlots = []
        for (const [number, { start, end }] of timeSlotMap) {
            timeSlots.push({ number, startTime: start, endTime: end })
        }
        timeSlots.sort((a, b) => a.number - b.number)
        DataManager.saveUserTimeSlots(userId, timeSlots)
        // 尝试重建节次信息
        let schedule = DataManager.loadSchedule(userId);
        if (schedule && schedule.courses) {
            // 清除所有课程的旧节次信息，以便根据新时间表重新匹配
            for (const course of schedule.courses) {
                delete course.startNode;
                delete course.step;
            }
        }
        const reconResult = DataManager.reconstructCourseSections(schedule);
        // 保存更新后的课表（包含重建的节次和时间表配置）
        DataManager.saveSchedule(userId, schedule);
        let reply = `✅ 时间表更新完成！\n`;
        reply += `📝 更新了 ${result.updatedCount} 门课程的时间\n`;
        reply += `💾 已保存你的时间表配置，共 ${timeSlots.length} 个时间段\n`;
        if (result.skippedCount > 0) {
            reply += `⏭️ 跳过了 ${result.skippedCount} 门课程（缺少节次数据或新时间表中未找到对应节次）\n`;
        }
        if (reconResult.reconstructed > 0) {
            reply += `🔄 根据新时间表重建了 ${reconResult.reconstructed} 门课程的节次信息`;
        } else if (reconResult.skipped > 0) {
            reply += `⚠️ 有 ${reconResult.skipped} 门课程未能匹配到节次，请检查时间表配置`;
        }
        await this.reply(reply);
        return true;
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
 * 发送确认提示并等待用户确认
 * @param {string} action 操作名称（导入/导出）
 * @param {string} confirmContext 确认状态的上下文名称
 * @returns {Promise<boolean>} 是否确认
 */
    async waitForConfirm(action, confirmContext, actionLabel = null) {
        const botName = getBotName(this.e);
        const label = actionLabel || `${action}课表`;
        const msg = `⚠️ ${botName}检测到您正在群聊中执行「${label}」操作，这可能会泄露您的课表信息。\n` +
            `请发送「确认」继续，发送任意其他内容取消操作。\n` +
            `（提示：建议在私聊中操作以保护隐私）`;
        await this.reply(msg);
        this.setContext(confirmContext);
        return true; // 等待异步回调
    }
    async confirmImport() {
        const userReply = this.e.msg.trim();
        this.finish("confirmImport");
        if (userReply !== "确认") {
            await this.reply("❌ 已取消导入操作。");
            return true;
        }
        // 确认后进入统一导入等待（支持文件 / 直链 / 口令 / JSON 文本）
        return await this.promptImportInput();
    }
    /**
 * 确认导出回调
 */
    async confirmExport() {
        const userReply = this.e.msg.trim();
        this.finish("confirmExport");
        if (userReply !== "确认") {
            await this.reply("❌ 已取消导出操作。");
            return true;
        }
        return await this.doExport(false);
    }
    /**
     * 确认导出回调（拾光格式）
     */
    async confirmExportShiguang() {
        const userReply = this.e.msg.trim();
        this.finish("confirmExportShiguang");
        if (userReply !== "确认") {
            await this.reply("❌ 已取消导出操作。");
            return true;
        }
        return await this.doExport(true);
    }
    /**
     * 执行直链导入并回复结果
     * @param {string} rawUrl 用户提供的文件直链
     */
    async doImportFromUrl(rawUrl) {
        const botName = getBotName(this.e);
        await this.reply(`${botName}正在从直链获取课表文件，请稍候~`);
        const result = await importScheduleFromUrl(this.e.user_id, rawUrl, this.e);
        await this.reply(result.message);
        return true;
    }
    /**
     * 官方群聊导入提示（群状态未知时）：合并隐私提醒与文件等待，跳过「确认」步骤。
     * 官方Bot群大概率仅接收@消息（且QQ客户端@与文件不能同时发送），
     * 逐条确认只会徒增@往返，因此在首次提示中前置说明限制与替代途径：
     * 全量群用户直接发文件即可导入，非全量群用户当场就能看到直链/口令方案
     */
    async promptOfficialImport() {
        this.setContext("waitingForScheduleImport");
        const msg = `📥 请直接发送你要导入的课表：课表文件（本插件原生/拾光JSON、ICS、WakeUp备份）、文件直链，或分享口令(码)。\n` +
            `⚠️ 群聊发送课表可能泄露隐私，建议私聊操作。\n` +
            `⚠️ 若本群机器人未开启「接收全部消息」（仅@消息模式），Bot 将收不到你发送的文件——` +
            `请改用 #导入课表 <直链> 或 #导入课表 <分享口令> 导入，或请群主在群设置中开启「接收全部消息」。\n` +
            `发送 #导入课表直链教程 查看直链获取教程。输入"取消"取消操作。`;
        await this.reply([msg, ...urlImportButtons(this.e)]);
        return true;
    }
    /**
     * 直链导入教程：tmpfile.link 上传指引截图 + 使用说明
     */
    async showUrlImportGuide() {
        let msg = `📖 课表文件直链导入教程\n` +
            `① 打开 https://tmpfile.link/index-zh ，上传你的课表文件（JSON/ICS/WakeUp备份）\n` +
            `② 上传完成后复制返回的 downloadLink 下载直链（见下图）\n` +
            `③ 发送 #导入课表 <直链> 即可完成导入\n` +
            `其他可公开访问的课表文件直链同样支持哦~`;
        const replyMsg = [msg];
        if (fs.existsSync(URL_GUIDE_IMAGE)) replyMsg.push(segment.image(URL_GUIDE_IMAGE));
        await this.reply(replyMsg);
        return true;
    }
    /**
     * 非全量消息群导入引导：官方Bot群未开启「接收全部消息」时，
     * 文件监听失效且文件无法携带@，引导改用直链/口令导入或开启全量
     * @param {object} botState getGroupBotState 返回的群内Bot状态
     */
    async replyNonFullImportGuide(botState) {
        const e = this.e;
        const botName = getBotName(e);
        const settingText = RECV_SETTING_TEXT[botState.recv_msg_setting] || botState.recv_msg_setting;
        const msg = `⚠️ 检测到本群机器人的消息接收设置为「${settingText}」，未开启「接收全部消息」。\n` +
            `此环境下QQ客户端无法在发送文件的同时@${botName}，Bot收不到课表文件，文件导入无法使用。可通过以下方式导入：\n` +
            `① 直链导入：先将课表文件上传到 tmpfile.link 等工具获取公开直链（教程见下图），再发送\n#导入课表 <直链>\n` +
            `② 口令导入：发送 #导入课表 <分享口令>（发送时记得@${botName}）\n` +
            `③ 请群主在群设置中把机器人的消息接收设置改为「接收全部消息」后，重新发送 #导入课表`;
        const replyMsg = [msg];
        if (fs.existsSync(URL_GUIDE_IMAGE)) replyMsg.push(segment.image(URL_GUIDE_IMAGE));
        replyMsg.push(...urlImportButtons(e));
        await this.reply(replyMsg);
        return true;
    }
    /**
     * 统一导入等待上下文：文件 / 文件直链 / 分享口令(码) / JSON 文本 都能接
     * （原 waitingForCode、waitingForStarlinkCode、waitingForImportFile 三个上下文已合并至此）
     */
    async waitingForScheduleImport() {
        this.finish("waitingForScheduleImport");
        const e = this.e;
        if (typeof e.msg === 'string') {
            const text = e.msg.trim();
            if (text === "取消" || text.toLowerCase() === "cancel") return this.reply("已取消导入操作。");
        }
        const botName = getBotName(e);
        // 1. 文件消息：按扩展名分发
        const fileInfo = getFileInfo(e);
        if (fileInfo) {
            return await this.handleScheduleFileImport(fileInfo);
        }
        // 2. 文本消息：直链 / 分享口令 / JSON 文本
        if (typeof e.msg === 'string') {
            const input = classifyImportInput(e.msg);
            switch (input.type) {
                case 'url':
                    return await this.doImportFromUrl(input.value);
                case 'code':
                    return await this.doImportFromCode(input.value, input.variant);
                case 'json':
                    return await this.doImportFromJsonText(input.value);
                default:
                    break;
            }
        }
        // 3. 无法识别：给出可接受的输入形式
        await this.reply(`${botName}没检测到可导入的内容哦，请发送课表文件（JSON/ICS/WakeUp备份）、文件直链、分享口令，或直接粘贴 JSON 文本~` +
            (isOfficialMsg(e) ? `\n💡 若本群机器人未开启「接收全部消息」，Bot 将收不到文件，可改用 #导入课表 <直链> 或 #导入课表 <口令> 导入` : ''));
        return false;
    }
    /**
     * 按扩展名导入课表文件（统一导入上下文与文件监听共用）
     * @param {{fileName:string,fileSize:number,fileId:string,busid:*,fileHash:string,fileUrl:string}} fileInfo
     * @param {{silent?:boolean}} [options] silent=true 时失败只记日志不回复（供 watchFiles 文件监听复用，
     *   避免群里的其他 JSON 文件触发报错刷屏），成功仍会回复一次结果
     * @returns {Promise<boolean>} 是否处理成功
     */
    async handleScheduleFileImport(fileInfo, { silent = false } = {}) {
        const e = this.e;
        const botName = getBotName(e);
        const { fileName, fileSize, fileId, busid, fileHash, fileUrl } = fileInfo;
        const MAX_SIZE = 2 * 1024 * 1024;
        // 获取文件扩展名
        const ext = path.extname(fileName).toLowerCase();
        // 失败提示统一走这里：静默模式下只记录日志
        const fail = async (msg, logMsg = msg) => {
            if (silent) logger.warn(`[课表自动导入] ${logMsg} (${fileName})`);
            else await this.reply(msg);
            return false;
        };
        if (ext !== '.json' && ext !== '.ics' && ext !== '.wakeup_schedule') {
            return await fail(`${botName}暂时只认识 JSON、ICS 和 WakeUp备份文件(.wakeup_schedule)格式哦喵>_<`, '不支持的格式，跳过处理');
        }
        if (fileSize > MAX_SIZE) {
            const sizeKB = (fileSize / 1024).toFixed(2);
            return await fail(`文件太大了(${sizeKB}KB)，${botName}吃不下惹QAQ，请确保发送的文件小于 2MB~`, `文件过大 (${sizeKB}KB)，跳过处理`);
        }
        let fileContent;
        try {
            fileContent = await getFileContent(e, fileId, busid, fileHash, fileUrl);
        } catch (err) {
            logger.error(`[课表管理] 获取文件内容异常: ${fileName}`, err);
            return await fail(`${botName}读取文件失败惹(｡•﹃•｡)，稍后再试试吧~`, '读取文件失败');
        }
        if (!fileContent) {
            return await fail(`${botName}无法读取文件内容(｡•﹃•｡)，请确保文件有效`, '文件内容为空');
        }
        let result;
        if (ext === '.json') {
            let jsonData;
            try {
                jsonData = JSON.parse(fileContent);
            } catch (err) {
                return await fail('文件内容不是合法的 JSON 格式，请检查后重试~', 'JSON 解析失败');
            }
            result = await importScheduleFromJsonData(e.user_id, jsonData, e);
        } else if (ext === '.ics') { // .ics
            result = await importScheduleFromIcsData(e.user_id, fileContent, e);
        } else { // .wakeup_schedule
            result = await importScheduleFromWakeupData(e.user_id, fileContent, e);
        }
        await this.reply(result.message);
        return true;
    }
    /**
   * 导出课表
   */
    async exportSchedule() {
        const userId = this.e.user_id;
        const isShiguang = this.e.msg.includes('拾光');
        if (this.e.group_id) {
            // 群聊需要二次确认，根据格式选择不同的context方法
            if (isShiguang) {
                return await this.waitForConfirm('导出', 'confirmExportShiguang');
            } else {
                return await this.waitForConfirm('导出', 'confirmExport');
            }
        }
        // 私聊直接导出，传递标志
        return await this.doExport(isShiguang);
    }
    /**
      * 实际执行导出的方法
      * @param {boolean} isShiguang 是否导出拾光格式
    */
    async doExport(isShiguang = false) {
        const userId = this.e.user_id;
        // 安全兜底：若参数异常未传递，尝试从消息中检测
        if (isShiguang === undefined) {
            isShiguang = this.e.msg.includes('拾光');
        }
        const scheduleData = DataManager.loadSchedule(userId);
        if (!scheduleData) {
            await this.reply("你还没有设置课程表，请先设置或导入课表哦~");
            return false;
        }
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
            // 根据私聊/群聊场景，调用适配器封装的 sendFile 方法发送文件
            if (this.e.group_id) {
                await this.e.group.sendFile(filePath, fileName);
            } else {
                await this.e.friend.sendFile(filePath, fileName);
            }
            setTimeout(() => {
                fs.unlink(filePath, (err) => {
                    if (err) logger.warn(`[课表导出] 删除临时文件失败: ${filePath}`, err);
                    else logger.mark(`[课表导出] 已删除临时文件: ${filePath}`);
                });
            }, 5000);
        } catch (err) {
            logger.error(`[课表导出] 发送文件失败: ${err}`);
            await this.reply("生成文件失败，请稍后重试");
            fs.unlink(filePath, () => { });
        }
        return true;
    }
    /**
 * 设置学期开始日期
 */
    async setSemesterStart() {
        const userId = this.e.user_id;
        let dateInput = this.e.msg.match(/^#(?:设置|修改)?学期开始(?:日期)?\s+(.+)$/)?.[1];
        if (!dateInput) {
            await this.reply("请提供日期，格式如：2026-03-02 或 03-02");
            return false;
        }
        dateInput = dateInput.trim();
        // 1. 尝试中文日期转换（如“3月2日”）
        let converted = null;
        if (/[月日]/.test(dateInput)) {
            converted = parseChineseDateToMD(dateInput);
            if (converted) dateInput = converted;
        }
        // 2. 解析日期字符串（支持 YYYY-MM-DD 或 MM-DD）
        const parsed = parseSemesterStartDate(dateInput);
        if (!parsed.valid || !parsed.date) {
            await this.reply(`日期格式无效，请使用 YYYY-MM-DD 或 MM-DD 格式\n例如：#设置学期开始 2026-03-02 或 #设置学期开始 03-02`);
            return false;
        }
        // 3. 校验日期不能晚于今天
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (parsed.date > today) {
            await this.reply(`学期开始日期不能晚于今天（${formatDate(today)}）`);
            return false;
        }
        // 4. 保存日期
        const dateStr = parsed.dateStr; // YYYY-MM-DD 格式
        const success = await DataManager.updateSemesterStart(userId, dateStr);
        if (success) {
            let warnMsg = "";
            const existingSchedule = DataManager.loadSchedule(userId);
            if (existingSchedule && existingSchedule.courses && existingSchedule.courses.length > 0) {
                warnMsg = "\n⚠️ 注意：修改学期开始日期不会自动调整已有课表的周次，请确认新日期与课表周数匹配。";
            }
            await this.reply(`✅ 学期开始日期已设置为 ${dateStr}${warnMsg}`);
        } else {
            await this.reply("❌ 保存失败，请稍后重试");
        }
        return true;
    }
    /**
     * 对齐课表到真实校历开学日期
     * 适用于周次以自己第一节课为第1周的课表（如缺少学期开始信息的ICS导入），
     * 与真实校历存在整体偏移的情况（例：开学第一个月没有课，10-05被当成第1周，实际是校历第5周）。
     * 与 #设置学期开始（仅改日期、不动周次）不同，本命令会连带把课程周次整体平移，
     * 上课的具体日期保持不变，仅周次编号与校历对齐。
     */
    async alignScheduleToCalendar() {
        const userId = this.e.user_id;
        let dateInput = this.e.msg.match(/^#(?:对齐课表|校历对齐|课表对齐|设置校历开学(?:日|日期))\s+(.+)$/)?.[1];
        if (!dateInput) {
            await this.reply("请提供你的真实校历开学日期，格式如：#对齐课表 2026-09-07 或 #对齐课表 09-07");
            return false;
        }
        dateInput = dateInput.trim();
        // 中文日期转换（如"9月7日"）
        if (/[月日]/.test(dateInput)) {
            const converted = parseChineseDateToMD(dateInput);
            if (converted) dateInput = converted;
        }
        // 解析日期（支持 YYYY-MM-DD 或 MM-DD）
        const parsed = parseSemesterStartDate(dateInput);
        if (!parsed.valid || !parsed.date) {
            await this.reply(`日期格式无效，请使用 YYYY-MM-DD 或 MM-DD 格式\n例如：#对齐课表 2026-09-07`);
            return false;
        }
        const result = DataManager.realignSemesterToCalendar(userId, parsed.dateStr);
        if (!result.success) {
            await this.reply(result.error);
            return true;
        }
        if (result.delta === 0) {
            await this.reply(`✅ 对齐日期与当前学期开始日期在同一周，已直接更新为 ${result.newStart}（课程周次不变）。\n⚠️ 如需在周次不变的前提下仅调整日期，请使用 #设置学期开始 命令。`);
            return true;
        }
        const sign = result.delta > 0 ? '+' : '';
        let reply = `✅ 课表已对齐到真实校历开学日 ${result.newStart}\n`;
        reply += `📅 学期开始：${result.oldStart} → ${result.newStart}\n`;
        reply += `🗓️ 课程周次整体${sign}${result.delta}：范围由 第${result.oldRange}周 变为 第${result.newRange}周`;
        if (result.delta > 0) reply += `（例如你原本的第1周现在对应校历第${1 + result.delta}周）`;
        reply += `\nℹ️ 上课的具体日期保持不变，仅周次编号与校历对齐。`;
        reply += `\n⚠️ 若想撤销，可再次使用本命令并填入 ${result.oldStart}。`;
        reply += `\n⚠️ 本命令适用于课表周次以自己第一节课为第1周的情况；若你的课表周次本就是校历周次，仅日期不对，请改用 #设置学期开始。`;
        await this.reply(reply);
        return true;
    }
    /**
 * 直接监听文件消息并自动导入（由配置 watchFiles 控制）
 * 仅处理受支持的课表文件格式，其他消息静默返回 false
 */
    async handleDirectFile() {
        const config = ConfigManager.getConfig();
        const doWatchFile = config.watchFiles;
        if (!doWatchFile) return false;
        const e = this.e;
        if (e.user_id == Bot.uin) return false;  // 避免bot导出课表回环调用
        // 非文件消息不处理
        const fileInfo = getFileInfo(e);
        if (!fileInfo) return false;
        const { fileName, fileSize } = fileInfo;
        const ext = path.extname(fileName).toLowerCase();
        const SUPPORTED_EXTS = ['.json', '.ics', '.wakeup_schedule'];
        if (!SUPPORTED_EXTS.includes(ext)) return false;  // 不支持的格式，静默放行
        const MAX_SIZE = 2 * 1024 * 1024; // 2MB
        if (fileSize > MAX_SIZE) {
            logger.warn(`[课表自动导入] 文件过大 (${(fileSize / 1024).toFixed(2)}KB)，跳过处理: ${fileName}`);
            return false; // 静默失败，避免刷屏
        }
        // 复用统一上下文同一套导入实现，避免两处解析逻辑漂移；失败时静默放行不刷屏
        try {
            return await this.handleScheduleFileImport(fileInfo, { silent: true });
        } catch (err) {
            logger.error(`[课表自动导入] 导入过程异常: ${fileName}`, err);
            return false;
        }
    }
}
export default ScheduleManage
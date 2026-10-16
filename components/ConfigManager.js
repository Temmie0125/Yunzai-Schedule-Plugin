// components/ConfigManager.js 
import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
export const DEFAULT_CONFIG_PATH = path.join(process.cwd(), 'plugins/schedule/config/default_config');
export const CONFIG_PATH = path.join(process.cwd(), 'plugins/schedule/config/config');
export const CONFIG_FILE = 'schedule.yaml';
// 群课表每行成员列数允许范围：至少 2 列，最多 4 列（4 列已是 1080px 画布下卡片可读的上限）
export const MIN_SCHEDULE_COLUMNS = 2;
export const MAX_SCHEDULE_COLUMNS = 4;
export class ConfigManager {
    /**
     * 获取用户配置（若不存在则从默认配置复制）
     * @returns {Object}
     */
    static getConfig() {
        const userFile = path.join(CONFIG_PATH, CONFIG_FILE)
        const defaultFile = path.join(DEFAULT_CONFIG_PATH, CONFIG_FILE)
        // 确保配置目录存在
        if (!fs.existsSync(CONFIG_PATH)) {
            fs.mkdirSync(CONFIG_PATH, { recursive: true })
        }
        // 如果用户配置不存在，复制默认配置
        if (!fs.existsSync(userFile) && fs.existsSync(defaultFile)) {
            fs.copyFileSync(defaultFile, userFile)
            logger.info('[Schedule-配置管理] 已初始化用户配置文件')
        }
        let config = {};
        try {
            const content = fs.readFileSync(userFile, 'utf8')
            config = YAML.parse(content) || {}
        } catch (err) {
            logger.error('[Schedule-配置管理] 读取配置失败:', err)
            config = {};
        }

        // 默认配置值
        const defaultConfig = {
            pushHour: 20,
            showTableName: true,
            autoRecallCode: false,
            renderScale: 1.0,         // 渲染精度
            renderRestartCount: 100,  // 渲染重启计数
            maxRenderRetry: 1,        // 最大重试次数
            renderTimeOut: 10000,     // 渲染超时时间（ms）
            renderer: "puppeteer",    // 图片渲染器: puppeteer 插件独立实例 / shotium 宿主共享引擎 / auto 自动选择
            autoCancelCheckEnabled: false,
            autoCancelCheckInterval: 60,
            // 调试模式：开启后会打印高频扫描等详细日志（默认关闭，避免刷屏）
            debugMode: false,
            // 上课提醒配置
            classReminderEnabled: false,   // 上课提醒功能总开关（管理员可全局禁用）
            classReminderScanInterval: 1,  // 上课提醒扫描间隔（分钟）
            // 生日配置
            birthdayPushHour: 0,        // 生日推送小时，默认0点
            allowSelfModify: true,       // 允许用户自行修改/重新设置生日
            birthdayWhitelistGroups: [],  // 推送白名单
            birthdayBlacklistGroups: [],   // 推送黑名单
            // WakeUp 服务配置
            wakeupServiceUrl: "https://wakeup.cpc.cn.eu.org/",  // WakeUp 服务基础URL
            wakeupApiEndpoint: "/parse",    // WakeUp API端点路径
            wakeupAuthType: "Bearer",       // WakeUp 鉴权方式: Bearer / X-Auth-Token / None
            wakeupAuthToken: "",         // WakeUp 服务鉴权 Token
            defaultSemesterStart: "2026-03-02",   // 新增：默认学期开始日期
            botName: "",    // bot自定义名称，默认取机器人昵称
            font: "像素",    // 字体风格，默认为像素字体
            // 群课表排序方式，userId：按QQ号；courseStatus：按上课状态；
            // timeDistance：先按状态分组（上课中/分身中/翘课中 → 未开始 → 其他），组内按距上/下课时间升序
            sortMode: "userId",
            scheduleColumns: 2,    // 群课表图片每行展示的成员列数（2~4，3/4 列自动紧凑化卡片）
            hideEndedDays: 30,    // 群课表图片中隐藏学期已结束超过该天数的成员，0 表示不过滤
            showQQ: true,    // 生日列表是否展示QQ号。默认开启
            watchFiles: false,  // 监听所有文件以尝试自动导入课表，默认关闭
            urlImportEnabled: true,  // URL直链导入总开关
            birthdayCustomName: true  // 生日列表允许使用自定义昵称，关闭则同步QQ昵称
        };
        // 合并默认值（确保所有字段都有值）
        config = { ...defaultConfig, ...config };
        // 确保新增字段存在（防止旧配置没有这两个字段）
        if (!config.birthdayWhitelistGroups) config.birthdayWhitelistGroups = [];
        if (!config.birthdayBlacklistGroups) config.birthdayBlacklistGroups = [];
        if (config.wakeupServiceUrl === undefined) config.wakeupServiceUrl = "https://wakeup.cpc.cn.eu.org/";
        if (config.wakeupApiEndpoint === undefined) config.wakeupApiEndpoint = "/parse";
        if (config.wakeupAuthType === undefined) config.wakeupAuthType = "Bearer";
        if (config.wakeupAuthToken === undefined) config.wakeupAuthToken = "";
        // 上课提醒默认值兜底
        if (config.classReminderEnabled === undefined) config.classReminderEnabled = defaultConfig.classReminderEnabled;
        if (!config.classReminderScanInterval) config.classReminderScanInterval = defaultConfig.classReminderScanInterval;
        // 调试模式默认值兜底
        if (config.debugMode === undefined) config.debugMode = defaultConfig.debugMode;
        // 渲染器模式兜底：仅允许 puppeteer / shotium / auto
        if (!['puppeteer', 'shotium', 'auto'].includes(config.renderer)) config.renderer = defaultConfig.renderer;
        // 群课表排序模式兜底：仅允许 userId / courseStatus / timeDistance
        if (!['userId', 'courseStatus', 'timeDistance'].includes(config.sortMode)) config.sortMode = defaultConfig.sortMode;
        // 群课表列数兜底：非法值回落到默认，并夹在 2~4 之间（列数过大会让卡片拥挤到不可读）
        config.scheduleColumns = ConfigManager.normalizeColumns(config.scheduleColumns);
        // 若 pushHour 为空（比如旧配置解析失败），则使用默认值
        if (!config.pushHour) {
            config.pushHour = defaultConfig.pushHour;
        }
        if (!config.birthdayPushHour) {
            config.birthdayPushHour = defaultConfig.birthdayPushHour;
        }
        // 动态生成 pushCron 字段，供其他模块调用
        config.pushCron = `0 ${config.pushHour} * * *`;
        config.birthdayPushCron = `0 ${config.birthdayPushHour} * * *`;
        return config;
    }
    /**
     * 标准化群课表列数：非法值回落默认 2 列，越界值夹到 [MIN_SCHEDULE_COLUMNS, MAX_SCHEDULE_COLUMNS]
     * @param {*} value 配置中的列数（可能是字符串/小数/undefined）
     * @returns {number} 可直接用于渲染的列数
     */
    static normalizeColumns(value) {
        const n = Number.parseInt(value, 10);
        if (!Number.isFinite(n)) return MIN_SCHEDULE_COLUMNS;
        return Math.min(MAX_SCHEDULE_COLUMNS, Math.max(MIN_SCHEDULE_COLUMNS, n));
    }
    /**
     * 标准化cron表达式，适配node-schedule
     * @param {string} cron 原始cron字符串
     * @returns {string} 标准化后的cron
     */
    static normalizeCron(cron) {
        if (!cron) return cron;
        cron = cron.trim();
        const parts = cron.split(/\s+/);
        // 如果超过6个字段（如7字段含年），只保留前6个
        if (parts.length > 6) {
            parts.length = 6;
            cron = parts.join(' ');
        }
        // 如果是5字段，补一个秒字段（默认0），使格式统一为6字段
        if (parts.length === 5) {
            cron = `0 ${cron}`;
        }
        return cron;
    }
    /**
     * 保存用户配置
     * @param {Object} data 
     */
    static setConfig(data) {
        const userFile = path.join(CONFIG_PATH, CONFIG_FILE)
        if (!fs.existsSync(CONFIG_PATH)) {
            fs.mkdirSync(CONFIG_PATH, { recursive: true })
        }
        // 仅提取需要保存的字段
        const {
            pushHour, showTableName, autoRecallCode,
            renderScale, renderRestartCount, maxRenderRetry, renderTimeOut, renderer,
            autoCancelCheckEnabled, autoCancelCheckInterval,
            classReminderEnabled, classReminderScanInterval,
            debugMode,
            birthdayPushHour, allowSelfModify,
            birthdayWhitelistGroups, birthdayBlacklistGroups,
            wakeupServiceUrl, wakeupApiEndpoint, wakeupAuthType, wakeupAuthToken,
            defaultSemesterStart,
            botName, font,
            sortMode, scheduleColumns, hideEndedDays, showQQ,
            watchFiles, urlImportEnabled, birthdayCustomName
        } = data;
        const configToSave = {
            pushHour,
            showTableName,
            autoRecallCode,
            renderScale, renderRestartCount, maxRenderRetry, renderTimeOut,
            renderer,
            autoCancelCheckEnabled,
            autoCancelCheckInterval,
            classReminderEnabled, classReminderScanInterval,
            debugMode,
            birthdayPushHour, allowSelfModify,
            birthdayWhitelistGroups, birthdayBlacklistGroups,
            wakeupServiceUrl, wakeupApiEndpoint, wakeupAuthType, wakeupAuthToken,
            defaultSemesterStart,
            botName, font,
            sortMode, scheduleColumns, hideEndedDays, showQQ,
            watchFiles, urlImportEnabled, birthdayCustomName
        };
        // 列数落库前同样标准化，避免绕过前端校验写入越界值
        if (configToSave.scheduleColumns !== undefined) {
            configToSave.scheduleColumns = ConfigManager.normalizeColumns(configToSave.scheduleColumns);
        }
        // 过滤掉 undefined 的字段，避免写入 yaml 时出现空值
        Object.keys(configToSave).forEach(key => {
            if (configToSave[key] === undefined) {
                delete configToSave[key];
            }
        });
        fs.writeFileSync(userFile, YAML.stringify(configToSave), 'utf8')
        logger.info('[配置管理] 配置已保存')
    }
}
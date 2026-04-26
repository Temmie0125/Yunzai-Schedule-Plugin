// components/ConfigManager.js 
import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
export const DEFAULT_CONFIG_PATH = path.join(process.cwd(), 'plugins/schedule/config/default_config');
export const CONFIG_PATH = path.join(process.cwd(), 'plugins/schedule/config/config');
export const CONFIG_FILE = 'schedule.yaml';
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
            renderScale: 1.0,
            autoCancelCheckEnabled: false,
            autoCancelCheckInterval: 60,
            // 生日配置
            birthdayPushHour: 0,        // 生日推送小时，默认0点
            allowSelfModify: true,       // 允许用户自行修改/重新设置生日
            birthdayWhitelistGroups: [],  // 推送白名单
            birthdayBlacklistGroups: [],   // 推送黑名单
            // 新增字段
            proxyUrl: "",        // 中转服务地址
            apiToken: "",         // 中转服务所需的 API Token
            defaultSemesterStart: "2026-03-02",   // 新增：默认学期开始日期
            botName: "",    // bot自定义名称，默认取机器人昵称
            font: "像素"    // 字体风格，默认为像素字体
        };
        // 合并默认值（确保所有字段都有值）
        config = { ...defaultConfig, ...config };
        // 确保新增字段存在（防止旧配置没有这两个字段）
        if (!config.birthdayWhitelistGroups) config.birthdayWhitelistGroups = [];
        if (!config.birthdayBlacklistGroups) config.birthdayBlacklistGroups = [];
        if (config.proxyUrl === undefined) config.proxyUrl = "";
        if (config.apiToken === undefined) config.apiToken = "";
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
            pushHour, showTableName, autoRecallCode, renderScale,
            autoCancelCheckEnabled, autoCancelCheckInterval,
            birthdayPushHour, allowSelfModify,
            birthdayWhitelistGroups, birthdayBlacklistGroups,
            proxyUrl, apiToken,
            defaultSemesterStart,
            botName, font
        } = data;
        const configToSave = {
            pushHour,
            showTableName,
            autoRecallCode,
            renderScale,
            autoCancelCheckEnabled,
            autoCancelCheckInterval,
            birthdayPushHour, allowSelfModify,
            birthdayWhitelistGroups, birthdayBlacklistGroups,
            proxyUrl, apiToken,
            defaultSemesterStart,
            botName, font
        };
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
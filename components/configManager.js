/*
 * @Author: Temmie0125 1179755948@qq.com
 * @Date: 2026-03-09 22:09:48
 * @LastEditors: Temmie0125 1179755948@qq.com
 * @LastEditTime: 2026-03-27 00:58:07
 * @FilePath: \实验与作业e:\bot\Yunzai\plugins\schedule\components\configManager.js
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
/*
 * @Author: Temmie0125 1179755948@qq.com
 * @Date: 2026-03-09 21:54:50
 * @LastEditors: Temmie0125 1179755948@qq.com
 * @LastEditTime: 2026-03-25 17:21:43
 * @FilePath: \实验与作业e:\bot\plugins\schedule\components\configManager.js
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
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
    // components/ConfigManager.js
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
            logger.info('[配置管理] 已初始化用户配置文件')
        }

        let config = {};
        try {
            const content = fs.readFileSync(userFile, 'utf8')
            config = YAML.parse(content) || {}
        } catch (err) {
            logger.error('[配置管理] 读取配置失败:', err)
            config = {};
        }

        // 默认配置值
        const defaultConfig = {
            pushHour: 20,
            showTableName: true,
            autoRecallCode: false,
            renderScale: 1.0,
            autoCancelCheckEnabled: false,
            autoCancelCheckInterval: 60
        };

        // 合并默认值（确保所有字段都有值）
        config = { ...defaultConfig, ...config };

        // 兼容旧配置：如果配置中没有 pushHour 但有 pushCron，尝试从 pushCron 解析小时
        if (config.pushHour === undefined && config.pushCron !== undefined) {
            try {
                let cron = ConfigManager.normalizeCron(config.pushCron);
                const parts = cron.split(/\s+/);
                // 标准化后为6个字段：秒 分 时 日 月 周
                if (parts.length === 6) {
                    let hour = parseInt(parts[2], 10);
                    if (!isNaN(hour) && hour >= 0 && hour <= 23) {
                        config.pushHour = hour;
                    }
                }
            } catch (e) {
                logger.warn('[配置管理] 无法从旧 pushCron 解析小时，将使用默认值 20');
            }
        }

        // 若 pushHour 仍为空（比如旧配置解析失败），则使用默认值
        if (config.pushHour === undefined) {
            config.pushHour = defaultConfig.pushHour;
        }

        // 动态生成 pushCron 字段，供其他模块调用
        config.pushCron = `0 ${config.pushHour} * * *`;

        // 注意：此处返回的 config 对象中，pushCron 是动态生成的，
        // 但实际存储在文件中的 pushCron 字段（如果有）会被忽略，
        // 因为保存时我们只保存 pushHour（见 setConfig 修改）
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
        pushHour,
        showTableName,
        autoRecallCode,
        renderScale,
        autoCancelCheckEnabled,
        autoCancelCheckInterval
    } = data;

    const configToSave = {
        pushHour,
        showTableName,
        autoRecallCode,
        renderScale,
        autoCancelCheckEnabled,
        autoCancelCheckInterval
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
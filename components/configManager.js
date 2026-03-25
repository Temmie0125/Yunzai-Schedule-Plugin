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

        try {
            const content = fs.readFileSync(userFile, 'utf8')
            return YAML.parse(content)
        } catch (err) {
            logger.error('[配置管理] 读取配置失败:', err)
            // 返回默认值兜底
            return {
                pushCron: '0 0 20 * * *',
                showTableName: true,
                autoRecallCode: false,
                renderScale: 1.0,
                autoCancelCheckEnabled: false,     
                autoCancelCheckInterval: 60
            }
        }
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
        fs.writeFileSync(userFile, YAML.stringify(data), 'utf8')
        logger.info('[配置管理] 配置已保存')
    }
}
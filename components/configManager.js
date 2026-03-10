/*
 * @Author: Temmie0125 1179755948@qq.com
 * @Date: 2026-03-09 21:54:50
 * @LastEditors: Temmie0125 1179755948@qq.com
 * @LastEditTime: 2026-03-10 11:54:36
 * @FilePath: \实验与作业e:\bot\plugins\schedule\components\configManager.js
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
// components/ConfigManager.js
import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'

const PLUGIN_ROOT = path.join(process.cwd(), 'plugins/schedule')
const DEFAULT_CONFIG_PATH = path.join(PLUGIN_ROOT, 'config/default_config')
const CONFIG_PATH = path.join(PLUGIN_ROOT, 'config/config')
const CONFIG_FILE = 'schedule.yaml'

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
                pushCron: '0 20 * * *',
                showTableName: true,      // 新增，默认显示课表名称
                autoRecallCode: false     // 新增，默认不自动撤回
              }
        }
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
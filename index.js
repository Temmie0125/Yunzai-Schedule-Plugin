/*
 * @Author: Temmie0125 1179755948@qq.com
 * @Date: 2025-12-26 16:40:17
 * @LastEditors: Temmie0125 1179755948@qq.com
 * @LastEditTime: 2025-12-26 17:13:40
 * @FilePath: \实验与作业e:\bot\plugins\schedule\index.js
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
import fs from 'node:fs'
import Yaml from 'yaml'
import path from 'node:path'

// 输出插件加载开始信息
logger.info('课程表插件载入中...')

// 创建必要的目录
fs.mkdirSync('plugins/schedule/data', { recursive: true })
fs.mkdirSync('plugins/schedule/config', { recursive: true })

// 默认配置
const defaultConfig = {
  enable: true,
  remind: {
    enable: false,
    advance: 10,          // 提前提醒时间（分钟）
    remindGroups: false,   // 是否在群聊提醒
    remindPrivate: false  // 是否私聊提醒
  },
  query: {
    maxShow: 5,           // 最多显示多少条课程
    showWeek: true        // 显示周数
  },
  api: {
    timeout: 10000,       // API请求超时时间（毫秒）
    retry: 2              // 重试次数
  }
}

/**
 * 检查并更新配置文件
 * 只添加缺失的新配置，不修改现有配置
 */
function updateConfig() {
  const configPath = 'config/schedule_config.yaml'
  let config = {}

  // 读取现有配置
  if (fs.existsSync(configPath)) {
    try {
      config = Yaml.parse(fs.readFileSync(configPath, 'utf8'))
    } catch (e) {
      logger.error('配置文件读取失败，将使用默认配置')
      config = JSON.parse(JSON.stringify(defaultConfig)) // 深拷贝默认配置
      fs.writeFileSync(configPath, Yaml.stringify(config)) // 立即写入修复后的配置
      logger.info('已创建新的配置文件')
    }
  } else {
    // 配置文件不存在时，使用默认配置并立即创建
    config = JSON.parse(JSON.stringify(defaultConfig)) // 深拷贝默认配置
    fs.writeFileSync(configPath, Yaml.stringify(config))
    logger.info('已创建初始配置文件')
    return // 直接返回，无需后续检查
  }

  // 递归检查并添加缺失的配置项
  let hasNewConfig = false
  const updateMissingConfig = (target, source) => {
    Object.entries(source).forEach(([key, value]) => {
      if (typeof value === 'object' && !Array.isArray(value)) {
        // 确保目标对象存在
        if (!target[key] || typeof target[key] !== 'object') {
          target[key] = {}
          hasNewConfig = true
          logger.info(`添加新配置组: ${key}`)
        }
        // 递归检查嵌套对象
        updateMissingConfig(target[key], value)
      } else if (!(key in target)) {
        // 添加缺失的配置项
        target[key] = value
        hasNewConfig = true
        logger.info(`添加新配置项: ${key}`)
      }
    })
  }

  // 检查并添加缺失的配置
  updateMissingConfig(config, defaultConfig)

  // 只有在发现新配置时才更新文件
  if (hasNewConfig) {
    try {
      fs.writeFileSync(configPath, Yaml.stringify(config))
      logger.info('配置文件已更新')
    } catch (e) {
      logger.error('配置文件更新失败:', e)
    }
  }
}

// 更新配置
updateConfig()
// 获取所有.js插件文件
const files = fs.readdirSync('./plugins/schedule/apps').filter(file => file.endsWith('.js'))

// 动态导入所有插件
const loadPlugins = async () => {
  const importPromises = files.map(file => import(`./apps/${file}`))
  const results = await Promise.allSettled(importPromises)

  // 处理导入结果
  const apps = {}
  results.forEach((result, index) => {
    const name = files[index].replace('.js', '')

    if (result.status === 'fulfilled') {
      apps[name] = result.value[Object.keys(result.value)[0]]
    } else {
      logger.error(`载入插件错误：${logger.red(name)}`)
      logger.error(result.reason)
    }
  })

  return apps
}
// 导出插件对象
export const apps = await loadPlugins()

logger.mark('课程表插件载入成功')
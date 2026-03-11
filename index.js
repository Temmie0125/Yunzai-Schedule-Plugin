/*
 * @Author: Temmie0125 1179755948@qq.com
 * @Date: 2026-03-09 01:39:22
 * @LastEditors: Temmie0125 1179755948@qq.com
 * @LastEditTime: 2026-03-12 01:34:17
 * @FilePath: \实验与作业e:\bot\Yunzai\plugins\schedule\index.js
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
import fs from 'node:fs'
// 不再需要导入 yaml 和 updateConfig 逻辑
// 可以导入 package.json 获取版本（可选）
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pkg = require('./package.json')  // 确保有 package.json 文件

// 输出插件加载开始信息（美化）
logger.mark('┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓')
logger.mark('┃          📅 课程表插件 载入中           ┃')
logger.mark('┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫')
logger.mark(`┃  版本: v${pkg.version.padEnd(28)}┃`)
logger.mark(`┃  作者: Temmie                          ┃`)
logger.mark(`┃  项目: https://github.com/Temmie0125/  ┃`)
logger.mark(`┃        Yunzai-Schedule-Plugin          ┃`)
logger.mark('┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛')

// 创建必要的数据目录（配置目录由 ConfigManager 自动创建）
fs.mkdirSync('plugins/schedule/data', { recursive: true })
// 如果担心其他模块依赖 config 目录，也可以保留创建，但非必需
// fs.mkdirSync('plugins/schedule/config', { recursive: true })

// 获取所有 .js 插件文件
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

logger.mark('✅ 课程表插件载入成功')
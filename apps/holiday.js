// apps/holiday.js
import { checkHolidayUpdate } from '../services/holidayUpdater.js'

export class HolidayUpdate extends plugin {
  constructor() {
    super({
      name: '[Schedule] 节假日数据更新',
      dsc: '手动检查并更新节假日数据',
      event: 'message',
      priority: 1000,
      rule: [
        {
          reg: '^#(强制)?更新节假日(数据)?$',
          fnc: 'update'
        }
      ]
    })
  }

  async update() {
    if (!this.e.isMaster) {
      await this.reply('只有主人才可以更新节假日数据哦~')
      return false
    }
    const force = this.e.msg.includes('强制')
    await this.reply(force ? '正在强制更新节假日数据...' : '正在检查节假日数据更新...')
    try {
      const result = await checkHolidayUpdate(force)
      if (result.skipped) {
        await this.reply('✅ 今日已检查过节假日数据，无需重复更新。\n如有需要可使用 #强制更新节假日数据')
        return true
      }
      if (result.updated.length === 0) {
        await this.reply(`⚠️ 未更新任何数据：${result.failed.length ? `获取失败（${result.failed.join('、')} 年），请稍后重试` : '官方尚未发布相关年份的数据'}。`)
        return true
      }
      let msg = `✅ 节假日数据更新完成！\n📅 已更新：${result.updated.join('、')} 年`
      if (result.failed.length) {
        msg += `\n⚠️ 获取失败：${result.failed.join('、')} 年（明日将自动重试）`
      }
      await this.reply(msg)
      return true
    } catch (err) {
      logger.error(`[节假日数据] 手动更新失败: ${err}`)
      await this.reply(`❌ 节假日数据更新失败：${err.message}\n请检查网络后重试`)
      return false
    }
  }
}

export default HolidayUpdate

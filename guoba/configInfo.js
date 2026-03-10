/*
 * @Author: Temmie0125 1179755948@qq.com
 * @Date: 2026-03-09 21:59:31
 * @LastEditors: Temmie0125 1179755948@qq.com
 * @LastEditTime: 2026-03-10 12:02:10
 * @FilePath: \实验与作业e:\bot\plugins\schedule\guoba\configInfo.js
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
import { schemas } from "./schemas/index.js"
import { ConfigManager } from "../components/ConfigManager.js"

export default {
    schemas,
    getConfigData() {
        return ConfigManager.getConfig()
    },
    setConfigData(data, { Result }) {
        ConfigManager.setConfig(data)
        return Result.ok({}, "配置已保存，如果更改推送时间需要重启 Bot 生效")
    }
}
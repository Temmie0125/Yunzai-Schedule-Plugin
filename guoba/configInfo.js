import { schemas } from "./schemas/index.js"
import { ConfigManager } from "../components/ConfigManager.js"

export default {
    schemas,
    getConfigData() {
        return ConfigManager.getConfig()
    },
    setConfigData(data, { Result }) {
        ConfigManager.setConfig(data)
        return Result.ok({}, "配置已保存")
    }
}
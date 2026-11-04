import { DataManager } from '../components/DataManager.js'
import { ConfigManager } from '../components/ConfigManager.js'
import { generateHelpImage } from '../components/Renderer.js'
import { SchedulePlugin } from '../components/GroupAccess.js'
import { applyAllScheduleHelpInfo } from '../utils/privacyUtils.js'
export class ScheduleHelp extends SchedulePlugin {
    constructor() {
        super({
            name: "[Schedule] 课程表帮助",
            dsc: "课表帮助服务",
            event: "message",
            priority: 1000,
            rule: [
                {
                    reg: "^#(课(程)?表帮助|schedule(\\s)?help|cls(\\s)?help)$",
                    fnc: "showHelp"
                }
            ]
        })
    }
    async showHelp(e) {
        const helpData = await DataManager.getHelpData()
        // 「所有人课表」的权限说明按 Guoba 里配置的 allSchedulePermission 实时生成，
        // 并补一条课表可见范围的轻提示（help.json 被自定义过也能补上，不会重复）
        applyAllScheduleHelpInfo(helpData, ConfigManager.getConfig())
        const img = await generateHelpImage(helpData, { e: e })
        if (img) {
            await e.reply(segment.image(img))
        } else {
            // 降级为文本帮助
            await e.reply(DataManager.getDefaultHelpText())
        }
        return true
    }
}
export default ScheduleHelp

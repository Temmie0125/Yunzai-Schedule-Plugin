import { DataManager } from '../components/DataManager.js'
import { generateHelpImage } from '../components/Renderer.js'
export class ScheduleHelp extends plugin {
    constructor() {
        super({
            name: "课程表帮助",
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
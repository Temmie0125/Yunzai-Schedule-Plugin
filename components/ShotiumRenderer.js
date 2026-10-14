// components/ShotiumRenderer.js
import fs from 'node:fs'
import path from 'node:path'

// 渲染产物临时目录（与宿主 Renderer.dealTpl 的 ./temp/html 约定保持一致）
const TEMP_DIR = path.join(process.cwd(), 'temp', 'html', 'schedule')

// 宿主渲染器仅在进程启动时加载一次，探测结果直接缓存，无需重复查找
let hostShotium = null
let probeFinished = false
let saveSequence = 0

/**
 * 探测宿主（TRSS-Yunzai）的共享 Shotium 渲染器。
 * 宿主渲染器加载器为全局单例，重复 import 不会重建引擎；
 * 未安装或加载失败时 getRenderer 会回退返回加载器本身，因此必须校验 id。
 * @returns {Promise<object|null>} 宿主 Shotium 渲染器实例，不可用时返回 null
 */
export async function getHostShotium() {
    if (probeFinished) return hostShotium
    probeFinished = true
    try {
        const loader = await import('../../../lib/renderer/loader.js')
        const renderer = loader.default?.getRenderer?.('shotium')
        if (renderer && renderer.id === 'shotium' && typeof renderer.render === 'function') {
            hostShotium = renderer
        }
    } catch (err) {
        // 非 TRSS-Yunzai 宿主（如 Miao / Le-niao）没有该加载器，静默视为不可用
        logger.debug(`[Schedule] 宿主渲染器加载器不可用: ${err?.message || err}`)
    }
    if (hostShotium) {
        logger.info('[Schedule] 已接入宿主 Shotium 渲染器（共享引擎，无独立浏览器实例）')
    } else {
        logger.warn('[Schedule] 宿主 Shotium 渲染器不可用（需 TRSS-Yunzai 且 renderers/shotium 加载成功），相关模式将回退 Puppeteer')
    }
    return hostShotium
}

/**
 * 使用宿主共享 Shotium 引擎渲染已生成的 HTML。
 * 通过 Proxy 仅替换宿主的 dealTpl（注入插件预渲染好的 HTML），
 * 引擎、连接、渲染计数与内存释放策略全部归属宿主，插件侧不维护任何浏览器实例。
 * 注意：Shotium 引擎不执行 <script>，本插件的模板均为服务端渲染好的静态 HTML，不受影响。
 * @param {string} templateName 模板名（用于日志与临时文件命名）
 * @param {string} html 已由 art-template 渲染完成的最终 HTML
 * @param {object} [options] { timeout } 页面加载超时（ms）
 * @returns {Promise<Buffer|null>} 渲染失败返回 null，由调用方决定回退策略
 */
export async function renderWithShotium(templateName, html, options = {}) {
    const host = await getHostShotium()
    if (!host) return null
    // 并发时每个请求使用独立文件避免相互覆盖，渲染结束后清理
    const saveId = `${templateName}_${Date.now()}_${++saveSequence}`
    const savePath = path.join(TEMP_DIR, `${saveId}.html`)
    try {
        fs.mkdirSync(TEMP_DIR, { recursive: true })
        fs.writeFileSync(savePath, html)
    } catch (err) {
        logger.error(`[Schedule] Shotium 临时 HTML 写入失败: ${savePath}`, err)
        return null
    }
    const receiver = new Proxy(host, {
        get: (target, key) => {
            // 宿主 screenshot 内部会调用 this.dealTpl 产出最终 HTML 文件，
            // 这里直接返回已写好的文件，跳过宿主的二次模板渲染与模板缓存
            if (key === 'dealTpl') return () => savePath
            const value = Reflect.get(target, key, target)
            return typeof value === 'function' ? value.bind(target) : value
        },
        // 渲染计数等状态写回宿主实例
        set: (target, key, value) => Reflect.set(target, key, value, target),
    })
    try {
        const result = await host.render.call(receiver, `schedule/${templateName}`, {
            tplFile: savePath,
            saveId,
            imgType: 'png',
            pageGotoParams: { timeout: Number(options.timeout) > 0 ? Number(options.timeout) : 30000 }
        })
        if (!result) return null
        return Buffer.isBuffer(result) ? result : Buffer.from(result)
    } catch (err) {
        logger.error(`[Schedule] Shotium 渲染模板 ${templateName} 失败:`, err)
        return null
    } finally {
        fs.promises.unlink(savePath).catch(() => {})
    }
}

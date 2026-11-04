// components/GroupAccess.js
// 全局群黑白名单：命中的群聊本插件**整体静默**（不回复任何内容）
//
// 设计要点（针对旧实现“群里一发消息就回‘本群在黑名单内’导致其他功能全挂”的问题）：
// 1. 静默：被拦下的命令返回 false，宿主会继续把消息交给其他插件，本插件不产生任何输出；
//    绝不在被拦群里回复提示语，也不会吞掉其他插件的消息。
// 2. 全功能覆盖：所有 app 的插件类改为继承 SchedulePlugin，构造函数里给每条 rule
//    套一层闸门（同名 fnc 只包一次，rule.fnc 不改写，日志里仍是原方法名）；
//    上下文回调（waitingForXxx / confirmXxx）走 getContext 闸门；
//    生日祝福这类不定时主动推送走 filterAccessibleGroupIds 过滤。
// 3. 私聊不受影响：黑白名单只针对群聊。
// 4. 白名单优先：白名单为空表示不限制；白名单非空时只有白名单内的群可用（与生日黑白名单口径一致）。
import { ConfigManager } from './ConfigManager.js'

/** 配置读取缓存时间（毫秒）：isGroupBlocked 在每条消息的每条规则上都会调用，不能每次都读盘+解析 YAML */
const CACHE_TTL_MS = 3000
let cachedConfig = null
let cachedAt = 0

/**
 * 把配置中的群号列表规范化为去重后的字符串数组
 * 官方 Bot 的群 ID 是 "botUin:OpenID" 复合 ID，必须按字符串处理（Number 会得到 NaN）
 * @param {*} list
 * @returns {string[]}
 */
export function normalizeGroupIdList(list) {
    if (!Array.isArray(list)) return []
    const result = []
    for (const item of list) {
        const gid = String(item ?? '').trim()
        if (gid && !result.includes(gid)) result.push(gid)
    }
    return result
}

/** 清除黑白名单缓存（配置变更时调用） */
export function invalidateGroupAccessCache() {
    cachedConfig = null
    cachedAt = 0
}

/**
 * 读取黑白名单（带短 TTL 缓存）
 * @returns {{ whitelist: string[], blacklist: string[] }}
 */
export function getGroupAccessConfig() {
    const now = Date.now()
    if (cachedConfig && now - cachedAt < CACHE_TTL_MS) return cachedConfig
    let whitelist = []
    let blacklist = []
    try {
        const config = ConfigManager.getConfig()
        whitelist = normalizeGroupIdList(config.groupWhitelist)
        blacklist = normalizeGroupIdList(config.groupBlacklist)
    } catch (err) {
        // 配置读取异常时放行：宁可多回复，也不能让所有群聊突然失效
        logger.error(`[群黑白名单] 读取配置失败，本次按不限制处理: ${err}`)
        whitelist = []
        blacklist = []
    }
    cachedConfig = { whitelist, blacklist }
    cachedAt = now
    return cachedConfig
}

/**
 * 判断某个群是否应被本插件静默忽略
 * - 没有群号（私聊）→ 放行
 * - 黑名单命中 → 忽略
 * - 白名单非空且未命中 → 忽略
 * @param {string|number} groupId
 * @returns {boolean}
 */
export function isGroupBlocked(groupId) {
    if (groupId === undefined || groupId === null || groupId === '') return false
    const gid = String(groupId).trim()
    if (!gid) return false
    const { whitelist, blacklist } = getGroupAccessConfig()
    if (blacklist.includes(gid)) return true
    return whitelist.length > 0 && !whitelist.includes(gid)
}

/**
 * 过滤一组群号，返回允许本插件工作的群号（用于生日祝福等主动推送场景）
 * @param {Array<string|number>} groupIds
 * @returns {string[]}
 */
export function filterAccessibleGroupIds(groupIds) {
    return (Array.isArray(groupIds) ? groupIds : []).filter(gid => !isGroupBlocked(gid))
}

/**
 * 给插件实例的每条 rule 套上黑白名单闸门
 * - 包装方法挂在实例上，遮蔽原型上的同名方法：rule.fnc 无需改写，日志中仍是原方法名
 * - 被拦下的群返回 false（宿主会继续把消息交给其他插件），不产生任何回复
 * @param {object} instance 插件实例
 */
function installGroupGate(instance) {
    if (!instance || instance.__groupGateInstalled) return
    if (!Array.isArray(instance.rule)) return
    instance.__groupGateInstalled = true
    const wrappedNames = new Set()
    for (const rule of instance.rule) {
        const name = rule?.fnc
        if (typeof name !== 'string') continue
        if (wrappedNames.has(name)) continue
        const original = instance[name]
        if (typeof original !== 'function') continue
        wrappedNames.add(name)
        instance[name] = async function groupGatedFnc(...args) {
            const e = this.e || args[0]
            if (isGroupBlocked(e?.group_id)) return false
            return original.apply(this, args)
        }
    }
}

/**
 * 本插件所有 app 的基类：在构造时统一安装群黑白名单闸门
 * 用法：class XxxPlugin extends SchedulePlugin { ... }
 */
export class SchedulePlugin extends plugin {
    constructor(options) {
        super(options)
        installGroupGate(this)
    }

    /**
     * 上下文回调（waitingForXxx / confirmXxx）同样受黑白名单约束：
     * 被拦下的群里不再处理上一条命令遗留的“半截上下文”
     */
    getContext(type, isGroup) {
        if (isGroupBlocked(this.e?.group_id)) {
            return typeof type === 'string' ? null : {}
        }
        return super.getContext(type, isGroup)
    }
}

// 配置变更时立即让缓存失效（index.js 的配置监听会广播 config-changed）；
// 3s TTL 作为兜底，保证 Guoba 直接改文件时也能很快生效
try {
    globalThis.scheduleEvents?.on?.(() => invalidateGroupAccessCache())
} catch { /* 宿主没有事件总线时忽略 */ }

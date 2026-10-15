// services/urlImporter.js
// 课表文件直链导入：从公网 URL 拉取课表文件（JSON/ICS/WakeUp备份）并分发到对应解析器
//
// 安全设计（该功能会 fetch 用户提供的任意公网链接，必须防御 SSRF / 内网探测 / 恶意文件注入）：
// 1. 协议白名单：仅允许 http/https，禁止 file:/data:/ftp: 等协议与 URL 内嵌账号信息（user:pass@）
// 2. 端口白名单：仅允许 80/443，防止借非标准端口探测内网服务
// 3. 内网地址拦截：域名解析出的所有 IP 必须为公网地址（回环/私网/链路本地/云元数据 169.254.169.254/ULA/
//    组播/IPv4-mapped 等全部拒绝），且在校验后通过自定义 lookup 将"校验通过的地址"直接用于建立连接，
//    避免解析校验与连接之间的 DNS rebinding TOCTOU 窗口
// 4. 重定向防护：手动跟随（默认≤3跳），逐跳重新校验协议/端口/账号信息，禁止 https→http 降级
// 5. 大小限制：流式接收并逐块计数，超过上限（默认2MB）立即断开，防止超大文件打爆内存；
//    Content-Length 预检提前拒绝
// 6. 超时限制：请求总时长（默认20秒）与传输空闲超时双重保护
// 7. 内容校验：拒绝网页（HTML）响应；格式仅限 JSON/ICS/WakeUp备份，内容先于解析被嗅探，
//    JSON 解析失败即终止，不会把任意数据交给后续业务
import dns from 'node:dns'
import net from 'node:net'
import http from 'node:http'
import https from 'node:https'
import zlib from 'node:zlib'
import path from 'node:path'
import { ConfigManager } from '../components/ConfigManager.js'
import {
    importScheduleFromJsonData,
    importScheduleFromIcsData,
    importScheduleFromWakeupData
} from './scheduleImporter.js'

const MAX_BYTES = 2 * 1024 * 1024   // 与文件导入一致：2MB 上限
const TIMEOUT_MS = 20 * 1000        // 单次请求总超时
const IDLE_TIMEOUT_MS = 10 * 1000   // 传输空闲超时
const MAX_REDIRECTS = 3
const USER_AGENT = 'Yunzai-Schedule-Plugin/1.0 (schedule file import)'

/**
 * 判断 IPv4 是否为非公网地址（私有/保留/特殊用途一律视为不安全）
 */
function isPrivateIPv4(ip) {
    const parts = ip.split('.').map(Number)
    if (parts.length !== 4 || parts.some(p => !Number.isInteger(p) || p < 0 || p > 255)) return true
    if (parts[0] === 0) return true                                            // 0.0.0.0/8 本网络
    if (parts[0] === 10) return true                                           // 10.0.0.0/8 私网
    if (parts[0] === 127) return true                                          // 127.0.0.0/8 回环
    if (parts[0] === 169 && parts[1] === 254) return true                      // 169.254.0.0/16 链路本地（含云元数据）
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true      // 172.16.0.0/12 私网
    if (parts[0] === 192 && parts[1] === 168) return true                      // 192.168.0.0/16 私网
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true     // 100.64.0.0/10 运营商级NAT
    if (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) return true  // 198.18.0.0/15 基准测试
    return parts[0] >= 224                                                     // 组播/保留/广播
}

/**
 * 判断 IPv6 是否为非公网地址
 */
function isPrivateIPv6(ip) {
    const lower = ip.toLowerCase().replace(/[[]]/g, '')
    if (lower === '::' || lower === '::1') return true                // 未指定/回环
    if (lower.startsWith('fe8') || lower.startsWith('fe9') ||
        lower.startsWith('fea') || lower.startsWith('feb')) return true // fe80::/10 链路本地
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true // fc00::/7 ULA 私网
    if (lower.startsWith('ff')) return true                           // ff00::/8 组播
    if (lower.startsWith('64:ff9b')) return true                      // NAT64 段（内嵌IPv4不可靠，整段拒绝）
    // IPv4-mapped：::ffff:192.168.1.1 或 ::ffff:c0a8:101，取内嵌 IPv4 递归校验
    if (lower.includes('::ffff:')) {
        const embedded = lower.split('::ffff:')[1]
        if (embedded.includes('.')) return isPrivateIPv4(embedded)
        const groups = embedded.split(':')
        if (groups.length >= 2) {
            const first = parseInt(groups[0], 16)
            const second = parseInt(groups[1], 16)
            if (Number.isInteger(first) && Number.isInteger(second)) {
                return isPrivateIPv4(`${first >> 8}.${first & 255}.${second >> 8}.${second & 255}`)
            }
        }
        return true
    }
    return false
}

/**
 * 判断地址是否为非公网地址（v4/v6 统一入口，解析失败按不安全处理）
 */
export function isPrivateAddress(address) {
    const ip = String(address || '').replace(/^\[|\]$/g, '')
    if (!ip) return true
    const family = net.isIP(ip)
    if (family === 4) return isPrivateIPv4(ip)
    if (family === 6) return isPrivateIPv6(ip)
    return true
}

/**
 * URL 安全校验（协议/端口/账号信息/长度/主机名），不包含 DNS 解析
 * @returns {{ ok: boolean, url?: URL, message?: string }}
 */
export function validateSafeUrl(rawUrl) {
    let url
    try {
        url = new URL(String(rawUrl || '').trim())
    } catch {
        return { ok: false, message: '链接格式不正确，请提供完整的 http(s):// 文件直链' }
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return { ok: false, message: `仅支持 http/https 链接，不支持 ${url.protocol.replace(/:$/, '')} 协议` }
    }
    if (url.username || url.password) {
        return { ok: false, message: '链接中不允许携带账号信息（user:pass@）' }
    }
    const port = url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80)
    if (!Number.isInteger(port) || (port !== 80 && port !== 443)) {
        return { ok: false, message: '仅支持 80/443 端口的链接' }
    }
    if (url.href.length > 2048) {
        return { ok: false, message: '链接过长（超过2048字符）' }
    }
    const hostname = url.hostname.toLowerCase()
    if (!hostname) {
        return { ok: false, message: '链接缺少主机名' }
    }
    if (hostname === 'localhost' || hostname.endsWith('.localhost') ||
        /\.(local|lan|internal|home|corp|home\.arpa)$/.test(hostname)) {
        return { ok: false, message: '不允许访问内网/本地地址' }
    }
    // IP 字面量主机直接校验公网性（URL 对象的 IPv6 hostname 带方括号，需先去掉）；
    // 域名交给连接前的 DNS 校验
    const bareHost = hostname.replace(/^\[|\]$/g, '')
    if (net.isIP(bareHost) && isPrivateAddress(bareHost)) {
        return { ok: false, message: '不允许访问内网/保留IP地址' }
    }
    return { ok: true, url }
}

/**
 * 自定义 lookup：DNS 解析出的所有地址必须全部为公网，校验通过后原样交给连接层，
 * 保证"实际连接的 IP"就是"校验过的 IP"（防 DNS rebinding）
 */
function safeLookup(hostname, options, callback) {
    dns.lookup(hostname, { ...options, all: true, verbatim: true }, (err, addresses) => {
        if (err) return callback(err)
        if (!Array.isArray(addresses) || addresses.length === 0) {
            return callback(new Error('链接域名无法解析，请检查链接是否有效'))
        }
        for (const { address } of addresses) {
            if (isPrivateAddress(address)) {
                logger.warn(`[直链导入] 拒绝访问非公网地址: ${hostname} -> ${address}`)
                return callback(new Error('链接指向内网/非公网地址，已拒绝访问'))
            }
        }
        if (options && options.all) return callback(null, addresses)
        callback(null, addresses[0].address, addresses[0].family)
    })
}

/**
 * 发起单次 HTTP(S) 请求（GET），流式接收并限制大小
 * @returns {Promise<{ statusCode: number, headers: object, buffer: Buffer, req: object }>}
 */
function requestOnce(targetUrl, maxBytes) {
    return new Promise((resolve, reject) => {
        const isHttps = targetUrl.protocol === 'https:'
        const mod = isHttps ? https : http
        const port = targetUrl.port ? Number(targetUrl.port) : (isHttps ? 443 : 80)
        const req = mod.request({
            hostname: targetUrl.hostname,
            port,
            path: `${targetUrl.pathname}${targetUrl.search}`,
            method: 'GET',
            lookup: safeLookup,
            headers: {
                // 不主动要求压缩；若服务端强制返回压缩内容，下载后按 content-encoding 解压
                'Accept-Encoding': 'identity',
                'User-Agent': USER_AGENT,
                Accept: '*/*'
            }
        }, res => {
            const lengthHeader = parseInt(res.headers['content-length'], 10)
            if (Number.isInteger(lengthHeader) && lengthHeader > maxBytes) {
                res.destroy()
                return reject(new Error(`文件过大（${(lengthHeader / 1024 / 1024).toFixed(2)}MB），请确保文件小于 2MB`))
            }
            const chunks = []
            let received = 0
            let settled = false
            const fail = err => {
                if (settled) return
                settled = true
                clearTimeout(hardTimer)
                clearTimeout(idleTimer)
                res.destroy()
                reject(err)
            }
            const idleTimer = setTimeout(() => fail(new Error('下载超时，请稍后重试')), IDLE_TIMEOUT_MS)
            res.on('data', chunk => {
                received += chunk.length
                if (received > maxBytes) {
                    return fail(new Error(`文件过大（超过2MB），请压缩后再试`))
                }
                chunks.push(chunk)
            })
            res.on('end', () => {
                if (settled) return
                settled = true
                clearTimeout(hardTimer)
                clearTimeout(idleTimer)
                resolve({ statusCode: res.statusCode, headers: res.headers, buffer: Buffer.concat(chunks) })
            })
            res.on('error', err => {
                clearTimeout(idleTimer)
                fail(err)
            })
        })
        // 硬性总时长上限：不依赖活动判定，防止恶意服务器缓慢滴水使请求无限挂起
        const hardTimer = setTimeout(() => req.destroy(new Error('请求超时，请稍后重试')), TIMEOUT_MS)
        req.on('close', () => clearTimeout(hardTimer))
        req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('请求超时，请稍后重试')))
        req.on('error', reject)
        req.end()
    })
}

/**
 * 安全获取公网文件：URL 校验 → 请求（自动跟随受控重定向）→ 响应体解压
 * @param {string} rawUrl
 * @param {{ maxBytes?: number }} [options]
 * @returns {Promise<{ buffer: Buffer, contentType: string, finalUrl: string }>}
 */
export async function fetchPublicFile(rawUrl, { maxBytes = MAX_BYTES } = {}) {
    let current = validateSafeUrl(rawUrl)
    if (!current.ok) throw new Error(current.message)
    current = current.url

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const res = await requestOnce(current, maxBytes)
        // 重定向：逐跳重新校验，禁止 https→http 降级
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
            const location = res.headers.location
            if (!location) throw new Error(`链接返回了无目标的重定向（${res.statusCode}）`)
            let next
            try {
                next = new URL(location, current)
            } catch {
                throw new Error('链接重定向地址无效')
            }
            const nextCheck = validateSafeUrl(next.href)
            if (!nextCheck.ok) throw new Error(`重定向目标不安全：${nextCheck.message}`)
            if (current.protocol === 'https:' && nextCheck.url.protocol === 'http:') {
                throw new Error('链接从 https 降级到 http，已拒绝；请提供 https 直链')
            }
            current = nextCheck.url
            continue
        }
        if (res.statusCode !== 200) {
            throw new Error(`链接返回状态码 ${res.statusCode}，请确认是可直接下载的文件直链（而非网页分享页）`)
        }
        let buffer = res.buffer
        const encoding = String(res.headers['content-encoding'] || '').toLowerCase().trim()
        if (buffer.length && ['gzip', 'deflate', 'br'].includes(encoding)) {
            try {
                buffer = await new Promise((resolve, reject) => {
                    const fn = encoding === 'br' ? zlib.brotliDecompress : encoding === 'gzip' ? zlib.gunzip : zlib.inflate
                    fn(buffer, { maxOutputLength: maxBytes }, (err, out) => err ? reject(err) : resolve(out))
                })
            } catch {
                throw new Error('文件内容解压失败，请直接上传未压缩的文件')
            }
        }
        return {
            buffer,
            contentType: String(res.headers['content-type'] || ''),
            finalUrl: current.href
        }
    }
    throw new Error(`重定向次数过多（超过${MAX_REDIRECTS}次）`)
}

/**
 * 从 URL 路径中提取小写扩展名（文件名可能被 URL 编码，需先解码）
 */
function getUrlExt(url) {
    try {
        const pathname = decodeURIComponent(url.pathname)
        return path.extname(pathname).toLowerCase()
    } catch {
        return path.extname(url.pathname).toLowerCase()
    }
}

/**
 * 去除 UTF-8 BOM
 */
function stripBom(text) {
    return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text
}

/**
 * 统计可解析为 JSON 的行数（WakeUp 备份为 JSON Lines 格式）
 */
export function countJsonLines(text) {
    let count = 0
    for (const line of text.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
            JSON.parse(trimmed)
            count++
        } catch { /* 非JSON行 */ }
    }
    return count
}

/**
 * 直链文件格式嗅探：扩展名优先，未知/无扩展名时按内容判断
 * @param {string} text 下载到的文本内容（已去BOM、已trim）
 * @param {string} ext URL 路径小写扩展名（可能为空）
 * @returns {'ics'|'json'|'wakeup'|null}
 */
export function detectUrlScheduleFormat(text, ext) {
    if (ext === '.ics') return 'ics'
    if (ext === '.json') return 'json'
    if (ext === '.wakeup_schedule') return 'wakeup'
    if (/^\s*BEGIN:VCALENDAR/i.test(text)) return 'ics'
    try {
        JSON.parse(text)
        return 'json'
    } catch { /* 尝试其他格式 */ }
    if (countJsonLines(text) >= 5) return 'wakeup'
    return null
}

/**
 * 从直链导入课表：下载 → 嗅探格式（扩展名优先，内容兜底）→ 分发到对应解析器
 * @param {string|number} userId
 * @param {string} rawUrl
 * @param {object} event
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function importScheduleFromUrl(userId, rawUrl, event) {
    try {
        const config = ConfigManager.getConfig()
        if (config.urlImportEnabled === false) {
            return { success: false, message: 'URL直链导入功能未开启，请联系管理员在配置中开启（urlImportEnabled）' }
        }
        const check = validateSafeUrl(rawUrl)
        if (!check.ok) {
            return { success: false, message: `❌ ${check.message}` }
        }
        let file
        try {
            file = await fetchPublicFile(check.url.href)
        } catch (err) {
            logger.warn(`[直链导入] 下载失败: ${rawUrl}`, err)
            return {
                success: false,
                message: `❌ 直链获取失败：${err.message}\n请确认链接可直接在浏览器打开并下载到课表文件，` +
                    `可发送 #导入课表直链教程 查看直链获取教程`
            }
        }
        let text = stripBom(file.buffer.toString('utf8'))
        // 网页响应拦截：用户贴的往往是分享页而非文件直链
        if (/^\s*<(?:!doctype\s+html|html)[\s>]/i.test(text)) {
            return {
                success: false,
                message: '❌ 该链接返回的是网页而不是文件。请复制文件的「下载直链」' +
                    '（可发送 #导入课表直链教程 查看教程）'
            }
        }
        text = text.trim()
        if (!text) {
            return { success: false, message: '❌ 直链内容为空，请检查链接是否有效' }
        }
        // 格式路由：扩展名优先，未知/无扩展名时按内容嗅探
        const ext = getUrlExt(check.url)
        const format = detectUrlScheduleFormat(text, ext)
        let result
        if (format === 'ics') {
            result = await importScheduleFromIcsData(userId, text, event)
        } else if (format === 'json') {
            result = await importJsonText(userId, text, event)
        } else if (format === 'wakeup') {
            result = await importScheduleFromWakeupData(userId, text, event)
        } else {
            return {
                success: false,
                message: '❌ 无法识别直链文件内容，支持：本插件原生/拾光课表JSON、ICS日历、WakeUp备份文件(.wakeup_schedule)'
            }
        }
        if (result?.success) {
            logger.mark(`[直链导入] 用户 ${userId} 通过直链导入成功: ${check.url.hostname}`)
        }
        return result
    } catch (err) {
        logger.error(`[直链导入] 导入异常: ${err}`)
        return { success: false, message: `导入失败：${err.message || '请稍后重试'}` }
    }
}

/**
 * JSON 文本导入（解析失败给出友好提示）
 */
async function importJsonText(userId, text, event) {
    let jsonData
    try {
        jsonData = JSON.parse(text)
    } catch {
        return { success: false, message: '直链内容不是合法的 JSON 格式，请检查后重试~' }
    }
    return importScheduleFromJsonData(userId, jsonData, event)
}

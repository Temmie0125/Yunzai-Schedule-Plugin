// services/importInputRouter.js
// 统一导入入口（#导入课表）的输入识别：把用户在命令后（或等待上下文中）发送的内容，
// 判定为「文件直链 / 分享口令(分享码) / JSON 文本 / 无法识别」，命令入口与等待上下文共用同一套判定，
// 避免两处逻辑漂移。
// 本模块为纯函数、不依赖宿主全局（logger/segment 等），可直接单测：test/test-import-merge.js

/** WakeUp 分享口令长度阈值：>= 该长度按 WakeUp 口令处理，否则按星链分享码处理 */
export const WAKEUP_CODE_MIN_LENGTH = 20;
/** 分享码字符集：字母、数字、短横线、下划线 */
const CODE_CHARSET = '[0-9a-zA-Z\\-_]';

/**
 * 从任意文本中提取第一个 http/https 直链
 * 结尾常见的中文标点与包裹符号会被裁掉，避免把「https://a/b.json，」整段当成 URL
 * @param {string} text
 * @returns {string|null}
 */
export function extractUrl(text) {
    const match = String(text ?? '').match(/https?:\/\/[^\s，。；、）】》"'<>]+/i);
    if (!match) return null;
    // 去掉可能粘在末尾的英文标点
    return match[0].replace(/[),.;\]}'"]+$/, '');
}

/**
 * 提取分享口令/分享码
 * 支持三种常见形态：
 *   1. WakeUp 分享文案中的「口令」
 *   2. 星链分享文案中的「输入：XXXXX」
 *   3. 直接发送的纯口令/分享码
 * @param {string} text
 * @returns {{ value: string, variant: 'wakeup'|'starlink' }|null}
 */
export function extractShareCode(text) {
    const raw = String(text ?? '').trim();
    if (!raw) return null;
    const byLength = (value) => ({
        value,
        variant: value.length >= WAKEUP_CODE_MIN_LENGTH ? 'wakeup' : 'starlink'
    });
    // 1. 「口令」形态（WakeUp 分享文案）
    const quoted = raw.match(new RegExp(`「(${CODE_CHARSET}+?)」`, 'u'));
    if (quoted) return byLength(quoted[1]);
    // 2. 星链「输入：XXXXX / 输入:XXXXX」
    const starlink = raw.match(new RegExp(`输入[：:]\\s*(${CODE_CHARSET}+)`));
    if (starlink) return { value: starlink[1], variant: 'starlink' };
    // 3. 纯口令/分享码（整条消息就是口令本身）
    const bare = raw.match(new RegExp(`^${CODE_CHARSET}{5,200}$`));
    if (bare) return byLength(raw);
    return null;
}

/**
 * 识别导入输入的类型
 * @param {string} raw 用户在 #导入课表 后发送的内容
 * @returns {{ type: 'url'|'code'|'json'|'empty'|'unknown', value?: string, variant?: 'wakeup'|'starlink' }}
 */
export function classifyImportInput(raw) {
    const text = String(raw ?? '').trim();
    if (!text) return { type: 'empty' };
    // 1. 文件直链优先：直链里可能带 query，先于口令形态判定
    const url = extractUrl(text);
    if (url) return { type: 'url', value: url };
    // 2. JSON 文本（对象或数组）
    if (/^[[{]/.test(text)) return { type: 'json', value: text };
    // 3. 分享口令/分享码
    const code = extractShareCode(text);
    if (code) return { type: 'code', value: code.value, variant: code.variant };
    return { type: 'unknown', value: text };
}

/**
 * 供提示文案使用的输入类型说明
 * @param {'url'|'code'|'json'|'empty'|'unknown'} type
 * @returns {string}
 */
export function describeImportInputType(type) {
    switch (type) {
        case 'url': return '文件直链';
        case 'code': return '分享口令';
        case 'json': return 'JSON 文本';
        case 'empty': return '空内容';
        default: return '无法识别的内容';
    }
}

// utils/colorUtils.js
// 颜色混合工具（纯函数）：把状态色按比例向白色/黑色靠拢，
// 用于派生「淡色实色边框」与「同色系深浅双色的进度环」，避免在模板里硬编码第二套配色。
// 全部为纯函数，便于单测（见 test/test-card-render.js）。

/**
 * 规范化 #RGB / #RRGGBB 颜色为 #RRGGBB（大写）；非法输入返回 null
 * @param {string} input
 * @returns {string|null}
 */
export function normalizeHexColor(input) {
    const match = String(input ?? '').trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!match) return null;
    let hex = match[1];
    if (hex.length === 3) hex = hex.split('').map(ch => ch + ch).join('');
    return `#${hex.toUpperCase()}`;
}

/**
 * 按比例把颜色混合到目标色上（ratio=0 返回原色，ratio=1 返回目标色）
 * @param {string} color 源色（#RGB / #RRGGBB）
 * @param {string} target 目标色
 * @param {number} ratio 0~1 的混合比例（越界自动夹取）
 * @returns {string} #RRGGBB；参数非法时原样返回 color
 */
export function mixHexColor(color, target, ratio) {
    const source = normalizeHexColor(color);
    const dest = normalizeHexColor(target);
    if (!source || !dest) return color;
    const t = Math.min(1, Math.max(0, Number(ratio) || 0));
    const toRgb = (hex) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    const [sr, sg, sb] = toRgb(source);
    const [dr, dg, db] = toRgb(dest);
    const mix = (s, d) => Math.round(s * (1 - t) + d * t);
    return `#${[mix(sr, dr), mix(sg, dg), mix(sb, db)]
        .map(v => v.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase()}`;
}

/**
 * 取淡色调（向白色靠拢）
 * @param {string} color
 * @param {number} ratio 0~1，越大越淡
 * @returns {string}
 */
export function lightenHexColor(color, ratio) {
    return mixHexColor(color, '#FFFFFF', ratio);
}

/**
 * 取深色调（向黑色靠拢）
 * @param {string} color
 * @param {number} ratio 0~1，越大越深
 * @returns {string}
 */
export function darkenHexColor(color, ratio) {
    return mixHexColor(color, '#000000', ratio);
}

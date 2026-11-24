// 临时测试：头像缓存时间片（方案 C）——配置项 avatarCacheMinutes 与 getAvatarUrl 行为
// 运行方式（从 Yunzai 根目录）：node plugins/schedule/test/test-avatar-cache.js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let fail = 0;
function check(label, cond, extra = '') {
    if (!cond) fail++;
    console.log(`[${cond ? 'PASS' : 'FAIL'}] ${label}${extra ? `  ${extra}` : ''}`);
}

// ---------- 宿主替身 ----------
global.logger = Object.assign(Object.create(console), {
    mark: () => { }, info: () => { }, warn: () => { }, error: () => { },
    debug: () => { }, green: (s) => s, blue: (s) => s, yellow: (s) => s, red: (s) => s
});
global.plugin = class { constructor(cfg = {}) { this.rule = cfg.rule || []; } setContext() { } finish() { } getContext() { return null; } async reply() { } };
global.Bot = { uin: 10000, version: { toString: () => 'v3' }, on() { }, off() { }, em: { on() { }, off() { } } };

const pluginRoot = path.resolve(import.meta.dirname, '..');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-avatar-'));
fs.mkdirSync(path.join(sandbox, 'plugins/schedule/config/config'), { recursive: true });
fs.writeFileSync(path.join(sandbox, 'plugins/schedule/config/config/schedule.yaml'),
    'avatarCacheMinutes: 60\n', 'utf8');

const originCwd = process.cwd();
process.chdir(sandbox);

try {
    const {
        normalizeAvatarCacheMinutes, buildAvatarCacheKey, getAvatarUrl
    } = await import('../components/common.js');
    const { ConfigManager } = await import('../components/ConfigManager.js');

    // ===== 1. 配置归一化 =====
    check('默认值 60', normalizeAvatarCacheMinutes(60) === 60);
    check('0 合法（每次都刷新）', normalizeAvatarCacheMinutes(0) === 0);
    check('负数回落 60', normalizeAvatarCacheMinutes(-5) === 60);
    check('非数字回落 60', normalizeAvatarCacheMinutes('abc') === 60 && normalizeAvatarCacheMinutes(undefined) === 60);
    check('字符串数字可解析', normalizeAvatarCacheMinutes('30') === 30);
    check('小数向下取整', normalizeAvatarCacheMinutes(3.9) === 3);
    check('超上限收敛到 7 天', normalizeAvatarCacheMinutes(999999) === 10080);

    // ===== 2. 时间片键 =====
    const t0 = Date.UTC(2026, 10, 24, 10, 0, 0);        // 2026-11-24 10:00:00 UTC
    const t0Plus30m = t0 + 30 * 60 * 1000;
    const t0Plus61m = t0 + 61 * 60 * 1000;
    check('同一小时片内键相同', buildAvatarCacheKey(60, t0) === buildAvatarCacheKey(60, t0Plus30m));
    check('跨小时片键不同', buildAvatarCacheKey(60, t0) !== buildAvatarCacheKey(60, t0Plus61m));
    check('0 分钟时任意时刻键都不同', buildAvatarCacheKey(0, t0) !== buildAvatarCacheKey(0, t0 + 1));
    check('时间片键是纯数字字符串', /^\d+$/.test(buildAvatarCacheKey(60, t0)));

    // ===== 3. getAvatarUrl（真实 QQ 号 → qlogo）=====
    const url1 = getAvatarUrl('178269080');
    const url2 = getAvatarUrl('178269080');
    check('qlogo URL 带用户号与尺寸', url1.includes('nk=178269080') && url1.includes('s=640'), url1);
    check('qlogo URL 带缓存时间片参数', /[?&]t=\d+/.test(url1));
    check('同一时间片内两次生成一致', url1 === url2);

    // ===== 4. 官方Bot场景：适配器返回的 URL 原样使用（不追加参数，避免破坏签名）=====
    const stubUrl = 'https://qqapp.example.com/avatar?openid=abc';
    global.Bot.getAvatarUrl = (selfId, userId, size) => `${stubUrl}&size=${size}`;
    const botUrl = getAvatarUrl('12345:OPENID_XYZ');
    check('官方Bot走适配器', botUrl === `${stubUrl}&size=640`, botUrl);
    check('官方Bot的 URL 不追加 t 参数', !/[?&]t=/.test(botUrl));
    delete global.Bot.getAvatarUrl;

    // ===== 5. 配置默认值与写入 =====
    check('配置默认 avatarCacheMinutes = 60', ConfigManager.getConfig().avatarCacheMinutes === 60);
    ConfigManager.setConfig({ ...ConfigManager.getConfig(), avatarCacheMinutes: 0 });
    check('可以配置为 0（每次都刷新）', ConfigManager.getConfig().avatarCacheMinutes === 0);
    ConfigManager.setConfig({ ...ConfigManager.getConfig(), avatarCacheMinutes: 120 });
    check('可以配置为 120', ConfigManager.getConfig().avatarCacheMinutes === 120);

    // ===== 6. 源码级：渲染层按配置决定是否禁用浏览器缓存 =====
    const rendererSrc = fs.readFileSync(path.join(pluginRoot, 'components/Renderer.js'), 'utf8');
    check('渲染层调用了 setCacheEnabled(false)', /page\.setCacheEnabled\(false\)/.test(rendererSrc));
    check('是否禁用缓存受 avatarCacheMinutes<=0 控制',
        /avatarCacheMinutes/.test(rendererSrc) && /<=\s*0/.test(rendererSrc));

    // ===== 7. Guoba 字段与默认配置 =====
    const schemaSrc = fs.readFileSync(path.join(pluginRoot, 'guoba/schemas/index.js'), 'utf8');
    check('Guoba schema 含头像缓存时长字段',
        /field:\s*"avatarCacheMinutes"/.test(schemaSrc) && /头像缓存时长/.test(schemaSrc));
    const defaultYaml = fs.readFileSync(path.join(pluginRoot, 'config/default_config/schedule.yaml'), 'utf8');
    check('默认配置含 avatarCacheMinutes', /^avatarCacheMinutes:\s*60/m.test(defaultYaml));
    check('默认配置注释解释了 0 的含义', /0\s*.*每次/.test(defaultYaml));
} finally {
    process.chdir(originCwd);
    try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { }
}

console.log(fail === 0 ? '\n全部用例通过 ✅' : `\n${fail} 个用例失败 ❌`);
process.exit(fail === 0 ? 0 : 1);

// 临时测试：Shotium 渲染器集成（探测宿主共享引擎 + 真实模板渲染 + 临时文件清理）
// 注意：插件代码基于 process.cwd()（Yunzai 根目录）定位目录，因此本测试需从 Yunzai 根目录运行
// 运行方式：node plugins/schedule/test/test-shotium-render.js
global.logger = (() => { // 插件与宿主渲染器依赖 Yunzai 全局 logger（含 green/red 着色），此处用 console 模拟
    const shim = {};
    for (const key of ['log', 'info', 'warn', 'error', 'debug', 'mark', 'trace']) shim[key] = (...args) => console[key === 'mark' || key === 'trace' ? 'log' : key](...args);
    shim.green = text => text;
    shim.red = text => text;
    return shim;
})();
import fs from 'node:fs';
import path from 'node:path';
import { getHostShotium, renderWithShotium } from '../components/ShotiumRenderer.js';
import { generateUserInfoImage } from '../components/Renderer.js';
import { ConfigManager } from '../components/ConfigManager.js';

if (!fs.existsSync(path.join(process.cwd(), 'plugins/schedule/package.json'))) {
    console.error('请从 Yunzai 根目录运行本测试：node plugins/schedule/test/test-shotium-render.js');
    process.exit(1);
}
let fail = 0;
function check(label, cond) {
    if (!cond) fail++;
    console.log(`[${cond ? 'PASS' : 'FAIL'}] ${label}`);
}

// 1. 探测宿主 Shotium 渲染器（本机为 TRSS-Yunzai 且 renderers/shotium 已加载，应可用）
const host = await getHostShotium();
check('探测到宿主 Shotium 渲染器', !!host && host.id === 'shotium');
check('探测结果已缓存（二次调用返回同一实例）', (await getHostShotium()) === host);

if (host) {
    // 2. 直接渲染简单 HTML，验证引擎出图
    const buf = await renderWithShotium('smoke-test',
        '<html><head><meta charset="utf-8"></head><body style="margin:0">' +
        '<div id="container" style="width:800px;padding:20px;background:#fff;font-family:sans-serif">' +
        '<h1>Shotium 冒烟测试</h1><p>课程表插件渲染器集成验证</p></div></body></html>',
        { timeout: 30000 });
    check('简单 HTML 渲染出 PNG', !!buf && buf.length > 0 && buf[0] === 0x89 && buf[1] === 0x50);

    // 3. 临时 HTML 渲染后应被清理（清理为异步操作，稍等片刻再检查）
    await new Promise(resolve => setTimeout(resolve, 300));
    const tempDir = path.join(process.cwd(), 'temp', 'html', 'schedule');
    const leftover = fs.existsSync(tempDir)
        ? fs.readdirSync(tempDir).filter(f => f.startsWith('smoke-test_'))
        : [];
    check('临时 HTML 渲染后已清理', leftover.length === 0);
}

// 4. 走完整路由：把配置指向 auto，用真实模板渲染（渲染失败会回退 Puppeteer，这里校验日志可区分）
const realGetConfig = ConfigManager.getConfig.bind(ConfigManager);
ConfigManager.getConfig = () => ({
    ...realGetConfig(),
    renderer: 'auto', renderScale: 1.0, renderTimeOut: 30000, maxRenderRetry: 1, font: '像素'
});
const image = await generateUserInfoImage(10000, {
    nickname: '冒烟测试用户',
    signature: 'Shotium 渲染器集成测试',
    tableName: '测试课表',
    semesterStart: '2026-03-02',
    currentWeek: 5,
    totalCourses: 12,
    thisWeekCourses: 10,
    updateTime: Date.now()
});
check('完整路由（auto → 真实模板）渲染出图', !!image && image.length > 0 && image[0] === 0x89 && image[1] === 0x50);
console.log(`[INFO] 渲染结果大小: ${image ? (image.length / 1024).toFixed(2) + 'KB' : 'null'}（若上方日志出现"已接入宿主 Shotium"则本次由 Shotium 引擎产出）`);

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);

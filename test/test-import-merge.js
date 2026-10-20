// 临时测试：统一导入入口（#导入课表）的输入识别逻辑
// 覆盖 classifyImportInput / extractUrl / extractShareCode 三种输入的判定与边界
// 运行方式（从 Yunzai 根目录）：node plugins/schedule/test/test-import-merge.js
global.logger = console; // 插件代码依赖 Yunzai 全局 logger，此处用 console 代替
import { classifyImportInput, extractUrl, extractShareCode, WAKEUP_CODE_MIN_LENGTH } from '../services/importInputRouter.js';

let fail = 0;
function check(label, cond) {
    if (!cond) fail++;
    console.log(`[${cond ? 'PASS' : 'FAIL'}] ${label}`);
}

// ========== 1. 文件直链 ==========
const urlCases = [
    ['https://d9.tfdl.net/public/2026-10-15/uuid/schedule.json', 'https直链'],
    ['http://example.com/a.ics', 'http直链'],
    ['https://example.com:443/a.wakeup_schedule', '带端口直链'],
    ['帮我导入 https://example.com/a.json 谢谢', '夹在中文文案中的直链'],
    ['https://example.com/a.json，', '直链尾部带中文逗号'],
    ['（https://example.com/a.json）', '直链被中文括号包裹'],
];
for (const [input, label] of urlCases) {
    const r = classifyImportInput(input);
    check(`直链识别：${label}`, r.type === 'url' && r.value.startsWith('http'));
}
check('直链提取不吞中文标点', extractUrl('https://example.com/a.json，') === 'https://example.com/a.json');
check('无直链时 extractUrl 返回 null', extractUrl('没有链接的文本') === null);

// ========== 2. 分享口令 / 星链分享码 ==========
const longCode = 'ABCDEFGHIJKLMNOPQRSTUVWX12345678'; // 32位 → WakeUp
const shortCode = 'A1B2C';                            // 5位 → 星链
const codeCases = [
    [`「${longCode}」`, 'wakeup', '「口令」形态（32位）'],
    [`分享口令：「${longCode}」`, 'wakeup', '中文文案中的「口令」'],
    [`输入：${shortCode}`, 'starlink', '星链「输入：XXXXX」'],
    [`输入:${shortCode}`, 'starlink', '星链「输入:XXXXX」半角冒号'],
    [`【星链课表】邀请你查看课表 输入：${shortCode}`, 'starlink', '星链完整分享文案'],
    [longCode, 'wakeup', '裸口令（32位）'],
    [shortCode, 'starlink', '裸分享码（5位）'],
    ['a-b_c123', 'starlink', '裸分享码（含横线/下划线）'],
];
for (const [input, variant, label] of codeCases) {
    const r = classifyImportInput(input);
    check(`口令识别：${label}`, r.type === 'code' && r.variant === variant && r.value.length > 0);
}
check(`口令长度阈值判定（${WAKEUP_CODE_MIN_LENGTH}位）`,
    classifyImportInput('A'.repeat(WAKEUP_CODE_MIN_LENGTH)).variant === 'wakeup'
    && classifyImportInput('A'.repeat(WAKEUP_CODE_MIN_LENGTH - 1)).variant === 'starlink');
check('口令提取去除「」包裹', extractShareCode(`「${longCode}」`).value === longCode);
check('非口令文本返回 null', extractShareCode('今天天气不错') === null);

// ========== 3. JSON 文本 ==========
const jsonObject = '{"courses":[{"name":"高等数学","day":1,"weeks":[1,2]}]}';
const jsonArray = '[{"name":"高等数学"}]';
check('JSON对象识别', classifyImportInput(jsonObject).type === 'json');
check('JSON数组识别', classifyImportInput(jsonArray).type === 'json');
check('JSON文本原样透传', classifyImportInput(`  ${jsonObject}  `).value === jsonObject);

// ========== 4. 非法/边界输入 ==========
check('空串识别为 empty', classifyImportInput('').type === 'empty');
check('undefined 识别为 empty', classifyImportInput(undefined).type === 'empty');
check('纯空白识别为 empty', classifyImportInput('   ').type === 'empty');
check('中文乱文本识别为 unknown', classifyImportInput('这是啥呀看不懂').type === 'unknown');
check('短字母串（<5位）识别为 unknown', classifyImportInput('abc').type === 'unknown');
check('带空格的英文句子识别为 unknown', classifyImportInput('import my schedule please').type === 'unknown');

// ========== 5. 判定优先级 ==========
// 含「」但同时也是 URL 的内容，应按直链处理（直链优先，避免把口令判定套在链接上）
check('直链优先于口令形态', classifyImportInput('https://example.com/「abc」.json').type === 'url');
// 星链分享文案里用户名恰好是短码时，优先取「输入：」后的分享码
check('星链文案优先取「输入：」后的码',
    extractShareCode(`用户ABC12 输入：ZZZ99`).value === 'ZZZ99');

console.log(fail === 0 ? '\n全部用例通过 ✅' : `\n${fail} 个用例失败 ❌`);
process.exit(fail === 0 ? 0 : 1);

// 临时测试：课表直链导入安全逻辑（URL 校验 / 内网 IP 拦截 / 格式嗅探 / 端到端 SSRF 拒绝）
// 注意：本测试不发起任何外网请求，涉及的端到端用例均应在校验层被直接拒绝
// 运行方式：node plugins/schedule/test/test-url-import.js
global.logger = console; // 插件代码依赖 Yunzai 全局 logger，此处用 console 代替
import { validateSafeUrl, isPrivateAddress, detectUrlScheduleFormat, importScheduleFromUrl } from '../services/urlImporter.js';
import { ConfigManager } from '../components/ConfigManager.js';

let fail = 0;
function check(label, cond) {
    if (!cond) fail++;
    console.log(`[${cond ? 'PASS' : 'FAIL'}] ${label}`);
}

// ========== 1. URL 安全校验 ==========
const okUrls = [
    ['https://d9.tfdl.net/public/2026-10-15/uuid/示例文件.json', 'tmpfile直链 https'],
    ['http://example.com/schedule.json', 'http 80端口'],
    ['https://93.184.216.34/file.ics', '公网IP字面量'],
    ['https://example.com:443/a.json', '显式443端口'],
];
for (const [url, label] of okUrls) {
    check(`URL校验通过：${label}`, validateSafeUrl(url).ok === true);
}
const badUrls = [
    ['ftp://example.com/a.json', '非http协议'],
    ['file:///etc/passwd', 'file协议'],
    ['data:text/json,{"a":1}', 'data协议'],
    ['https://user:pass@example.com/a.json', 'URL内嵌账号信息'],
    ['https://example.com:8080/a.json', '非80/443端口'],
    ['http://localhost/a.json', 'localhost'],
    ['http://db.local/a.json', '.local内网域名'],
    ['http://svc.internal/a.json', '.internal内网域名'],
    ['http://127.0.0.1:5700/a.json', '回环IP'],
    ['http://10.0.0.1/a.json', '10段私网IP'],
    ['http://172.16.1.1/a.json', '172.16段私网IP'],
    ['http://192.168.1.1/a.json', '192.168段私网IP'],
    ['http://169.254.169.254/latest/meta-data/', '云元数据地址'],
    ['http://[::1]/a.json', 'IPv6回环'],
    ['http://[fd00::1]/a.json', 'IPv6 ULA'],
    ['http://[::ffff:192.168.1.1]/a.json', 'IPv4-mapped私网'],
    ['not a url', '非法字符串'],
    ['', '空串'],
];
for (const [url, label] of badUrls) {
    check(`URL校验拒绝：${label}`, validateSafeUrl(url).ok === false);
}

// ========== 2. 内网 IP 判定 ==========
const privateIps = [
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.1',
    '169.254.169.254', '0.0.0.0', '100.64.0.1', '198.18.0.1', '224.0.0.1',
    '255.255.255.255', '::1', '::', 'fe80::1', 'fc00::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:c0a8:101'
];
for (const ip of privateIps) {
    check(`私网IP判定：${ip}`, isPrivateAddress(ip) === true);
}
const publicIps = [
    '93.184.216.34', '8.8.8.8', '1.1.1.1', '202.96.128.86',
    '2606:4700::1111', '240e:56:4000:8000::a'
];
for (const ip of publicIps) {
    check(`公网IP判定：${ip}`, isPrivateAddress(ip) === false);
}
check('IP判定：空值按不安全处理', isPrivateAddress('') === true && isPrivateAddress(null) === true);

// ========== 3. 格式嗅探 ==========
const nativeJson = JSON.stringify({
    tableName: '测试课表', semesterStart: '2026-09-07',
    courses: [{ name: '数学', teacher: '', location: '', day: 1, startTime: '08:00', endTime: '08:45', weeks: [1] }]
});
check('嗅探：.json扩展名优先', detectUrlScheduleFormat('not json', '.json') === 'json');
check('嗅探：.ics扩展名优先', detectUrlScheduleFormat('not ics', '.ics') === 'ics');
check('嗅探：.wakeup_schedule扩展名', detectUrlScheduleFormat('garbage', '.wakeup_schedule') === 'wakeup');
check('嗅探：无扩展名VCALENDAR内容', detectUrlScheduleFormat('BEGIN:VCALENDAR\r\nVERSION:2.0', '') === 'ics');
check('嗅探：无扩展名JSON内容', detectUrlScheduleFormat(nativeJson, '') === 'json');
const wakeupJsonl = Array.from({ length: 5 }, (_, i) => JSON.stringify({ node: i })).join('\n');
check('嗅探：无扩展名WakeUp JSONL（≥5行）', detectUrlScheduleFormat(wakeupJsonl, '') === 'wakeup');
check('嗅探：纯文本返回null', detectUrlScheduleFormat('hello world', '') === null);
check('嗅探：HTML返回null', detectUrlScheduleFormat('<!DOCTYPE html><html></html>', '') === null);

// ========== 4. 端到端：内网/非法目标在校验层直接拒绝（不发出任何请求） ==========
{
    const e = { user_id: 10000 };
    const targets = [
        'http://127.0.0.1:5700/plugins/schedule/data/10000.json',
        'http://169.254.169.254/latest/meta-data/',
        'ftp://example.com/a.json',
        'https://example.com:8080/a.json'
    ];
    for (const target of targets) {
        const result = await importScheduleFromUrl(e.user_id, target, e);
        check(`端到端拒绝：${target}`, result?.success === false);
    }
    // 配置开关关闭时直接拒绝
    const config = ConfigManager.getConfig();
    config.urlImportEnabled = false;
    const disabled = await importScheduleFromUrl(10000, 'https://example.com/a.json', { user_id: 10000 });
    check('端到端拒绝：urlImportEnabled=false', disabled?.success === false);
    config.urlImportEnabled = true;
}

console.log(fail === 0 ? '\n全部通过 ✔' : `\n存在 ${fail} 个失败用例 ✘`);
process.exit(fail === 0 ? 0 : 1);

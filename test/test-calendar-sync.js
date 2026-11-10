// 临时测试：日历接入服务层（ICS 订阅 / CalDAV）——地址校验、凭据加密、拉取、解析、合并、同步、导出
// 命令层（#日历绑定/#日历同步/...）另见 test/test-calendar-commands.js
// 运行方式（从 Yunzai 根目录）：node plugins/schedule/test/test-calendar-sync.js
// 隔离措施：process.cwd() 指向临时沙箱；日历服务器用本地 http mock，不访问外网
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

let fail = 0;
function check(label, cond) {
    if (!cond) fail++;
    console.log(`[${cond ? 'PASS' : 'FAIL'}] ${label}`);
}

// ---------- 宿主替身 ----------
global.logger = Object.assign(Object.create(console), {
    mark: () => { }, info: () => { }, warn: () => { }, error: () => { },
    debug: () => { }, green: (s) => s, blue: (s) => s, yellow: (s) => s, red: (s) => s
});
global.plugin = class {
    constructor(cfg = {}) { this.name = cfg.name; this.rule = cfg.rule || []; }
    setContext() { } finish() { } getContext() { return null; }
    async reply() { }
};
global.Bot = { uin: 10000, version: { toString: () => 'v3' }, on: () => { }, off: () => { }, em: { on: () => { }, off: () => { } } };

// ---------- 沙箱 ----------
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-calendar-'));
fs.mkdirSync(path.join(sandbox, 'plugins/schedule/data'), { recursive: true });
fs.mkdirSync(path.join(sandbox, 'plugins/schedule/config/config'), { recursive: true });
const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
// 固定一个“未来且同步窗口内”的日期：当前 +20 天
const future = new Date(now.getTime() + 20 * 86400000);
const futureCompactIcs = `${future.getFullYear()}${pad(future.getMonth() + 1)}${pad(future.getDate())}T100000`;
fs.writeFileSync(path.join(sandbox, 'plugins/schedule/config/config/schedule.yaml'),
    `calendarAllowPrivateHost: true\ncalendarSyncDaysBefore: 7\ncalendarSyncDaysAfter: 60\ncalendarMaxEvents: 150\n`, 'utf8');

// ---------- 本地日历 mock 服务器 ----------
const EVENT_FEED = (summary, startCompact, endCompact, extra = '') => [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//mock//CN',
    'BEGIN:VEVENT',
    `UID:${summary}-uid-1@mock`,
    'DTSTAMP:20260101T000000Z',
    `DTSTART:${startCompact}`,
    `DTEND:${endCompact}`,
    `SUMMARY:${summary}`,
    'LOCATION:第一学科楼',
    extra,
    'END:VEVENT',
    'END:VCALENDAR'
].filter(Boolean).join('\r\n');

let feedBody = [
    EVENT_FEED('志愿者活动', futureCompactIcs, `${futureCompactIcs.slice(0, 9)}120000`),
    // 每周重复 3 次（浮点时间，避免依赖主机时区）
    `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:weekly-uid@mock\r\nDTSTAMP:20260101T000000Z\r\nDTSTART:${futureCompactIcs}\r\nDTEND:${futureCompactIcs.slice(0, 9)}110000\r\nSUMMARY:每周例会\r\nRRULE:FREQ=WEEKLY;COUNT=3\r\nEND:VEVENT\r\nEND:VCALENDAR`,
    // 全天事件
    `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:allday-uid@mock\r\nDTSTAMP:20260101T000000Z\r\nDTSTART;VALUE=DATE:${futureCompactIcs.slice(0, 8)}\r\nDTEND;VALUE=DATE:${futureCompactIcs.slice(0, 8)}\r\nSUMMARY:运动会\r\nEND:VEVENT\r\nEND:VCALENDAR`
].join('\r\n');

const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/feed.ics') {
        res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8' });
        res.end(feedBody);
        return;
    }
    if (url.pathname === '/auth.ics') {
        const auth = req.headers.authorization || '';
        const ok = auth === `Basic ${Buffer.from('user:pass').toString('base64')}`;
        res.writeHead(ok ? 200 : 401, { 'Content-Type': 'text/calendar; charset=utf-8' });
        res.end(ok ? feedBody : 'unauthorized');
        return;
    }
    if (url.pathname === '/plain.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body>not a calendar</body></html>');
        return;
    }
    if (url.pathname === '/caldav') {
        if (req.method !== 'REPORT') {
            res.writeHead(405); res.end('need REPORT'); return;
        }
        // CalDAV 多状态响应：calendar-data 里放 VEVENT，顺便测试 XML 实体反转义
        const event = EVENT_FEED('答辩', futureCompactIcs, `${futureCompactIcs.slice(0, 9)}140000`)
            .replace(/\r\n/g, '&#13;\n');
        const xml = '<?xml version="1.0" encoding="utf-8"?>' +
            '<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/">' +
            '<d:response><d:href>/caldav/a.ics</d:href><d:propstat><d:prop><cal:calendar-data>' +
            event +
            '</cal:calendar-data></d:prop></d:propstat></d:response></d:multistatus>';
        res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' });
        res.end(xml);
        return;
    }
    res.writeHead(404); res.end('not found');
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const originCwd = process.cwd();
process.chdir(sandbox);

try {
    const {
        normalizeProvider, validateCalendarUrl, isPrivateHostname,
        encryptSecret, decryptSecret,
        fetchCalendarIcs, parseCalendarEvents, eventsToActivities,
        mergeCalendarActivities, buildScheduleIcs, syncUserCalendar, getSyncWindow
    } = await import('../services/calendarSync.js');
    const { DataManager } = await import('../components/DataManager.js');

    const UID = '50001';

    // ===== 1. 地址校验 =====
    check('接入方式规范化（非法值回落 ics）', normalizeProvider('xxx') === 'ics' && normalizeProvider('CalDAV') === 'caldav');
    check('拒绝非 http(s) 地址', validateCalendarUrl('ftp://a.com/x.ics').ok === false);
    check('拒绝地址内嵌账号密码', validateCalendarUrl('https://u:p@a.com/x.ics').ok === false);
    check('默认拒绝内网/本机地址', validateCalendarUrl(`${base}/feed.ics`).ok === false);
    check('允许配置后放行内网地址', validateCalendarUrl(`${base}/feed.ics`, { allowPrivateHost: true }).ok === true);
    check('内网判断：localhost/127/192.168/::1', ['localhost', '127.0.0.1', '192.168.1.5', '::1', '10.1.2.3'].every(isPrivateHostname));
    check('内网判断：公网域名放行', !isPrivateHostname('caldav.example.com'));

    // ===== 2. 凭据加密 =====
    const secret = encryptSecret('my-pass-喵');
    check('凭据加密后不含明文', secret && !secret.includes('my-pass'));
    check('凭据可正确解密', decryptSecret(secret) === 'my-pass-喵');
    check('空凭据加密为空串', encryptSecret('') === '');
    check('损坏的凭据解密返回空串', decryptSecret('not-a-valid-payload') === '');

    // ===== 3. 拉取 ICS（ics 方式）=====
    const ics = await fetchCalendarIcs({ provider: 'ics', url: `${base}/feed.ics`, allowPrivateHost: true });
    check('ICS 直链拉取成功', ics.includes('BEGIN:VCALENDAR'));
    let authError = '';
    try {
        await fetchCalendarIcs({ provider: 'ics', url: `${base}/auth.ics`, allowPrivateHost: true });
    } catch (err) { authError = err.message; }
    check('未提供凭据时认证失败给出明确提示', authError.includes('认证失败'));
    const okIcs = await fetchCalendarIcs({ provider: 'ics', url: `${base}/auth.ics`, username: 'user', password: 'pass', allowPrivateHost: true });
    check('带 Basic 认证拉取成功', okIcs.includes('志愿者活动'));
    let htmlError = '';
    try {
        await fetchCalendarIcs({ provider: 'ics', url: `${base}/plain.html`, allowPrivateHost: true });
    } catch (err) { htmlError = err.message; }
    check('非 ICS 内容被拒绝', htmlError.includes('没有返回 ICS'));

    // ===== 4. CalDAV（REPORT 207）=====
    const caldavIcs = await fetchCalendarIcs({ provider: 'caldav', url: `${base}/caldav`, allowPrivateHost: true });
    check('CalDAV REPORT 响应解析出 VEVENT', caldavIcs.includes('BEGIN:VEVENT') && caldavIcs.includes('答辩'));
    check('CalDAV 合并结果只有一个 VCALENDAR', (caldavIcs.match(/BEGIN:VCALENDAR/g) || []).length === 1);

    // ===== 5. 解析 + 转活动 =====
    const events = parseCalendarEvents(ics, { maxEvents: 50 });
    const names = events.map(e => e.summary);
    check('解析出普通事件', names.includes('志愿者活动'));
    check('重复事件按 RRULE 展开（每周例会 ×3）', events.filter(e => e.summary === '每周例会').length === 3);
    check('全天事件被解析', events.some(e => e.allDay));
    const activities = eventsToActivities(events);
    check('事件转活动：带 source=calendar', activities.every(a => a.source === 'calendar'));
    check('事件转活动：带 externalUid', activities.every(a => typeof a.externalUid === 'string' && a.externalUid));
    check('事件转活动：时间为 HH:MM', activities.every(a => /^\d{2}:\d{2}$/.test(a.startTime) && /^\d{2}:\d{2}$/.test(a.endTime)));
    check('事件转活动：名称/地点被保留', activities.some(a => a.name === '志愿者活动' && a.location === '第一学科楼'));
    check('全天事件占满当天（00:00-23:59）', activities.some(a => a.name === '运动会' && a.startTime === '00:00' && a.endTime === '23:59'));
    const again = eventsToActivities(parseCalendarEvents(ics, { maxEvents: 50 }));
    check('同一份日历生成的 activity id 稳定', JSON.stringify(again.map(a => a.id)) === JSON.stringify(activities.map(a => a.id)));
    check('事件数量受 maxEvents 限制', parseCalendarEvents(ics, { maxEvents: 1 }).length === 1);

    // ===== 6. 合并规则 =====
    const localActs = [{ id: 'local-1', name: '本地会议', date: todayStr, startTime: '12:00', endTime: '13:00', source: 'local' }];
    const outside = [{ id: 'cal-old', name: '很久以后', date: '2099-01-01', startTime: '09:00', endTime: '10:00', source: 'calendar' }];
    const merged = mergeCalendarActivities([...localActs, ...outside], activities);
    check('合并：本地活动保留', merged.some(a => a.id === 'local-1'));
    check('合并：窗口外的日历活动保留', merged.some(a => a.id === 'cal-old'));
    check('合并：窗口内的日历活动来自本次拉取', merged.some(a => a.name === '志愿者活动'));

    // ===== 7. 同步窗口读取配置 =====
    const windowInfo = getSyncWindow();
    check('同步窗口按配置计算（向后 60 天）',
        Math.round((windowInfo.until - Date.now()) / 86400000) >= 59);
    check('maxEvents 默认 150', windowInfo.maxEvents === 150);

    // ===== 8. 端到端同步：绑定 → 同步 → 落库 =====
    DataManager.saveActivities(UID, [{
        id: 'local-keep', name: '本地会议', location: '', date: todayStr,
        startTime: '12:00', endTime: '13:00', createdAt: new Date().toISOString()
    }]);
    DataManager.setCalendarBinding(UID, { provider: 'ics', url: `${base}/feed.ics`, enabled: true });
    const first = await syncUserCalendar(UID);
    check('同步成功', first.ok === true && first.count > 0);
    const afterFirst = DataManager.getActivities(UID);
    check('同步后日历事件以活动形式落库', afterFirst.some(a => a.name === '志愿者活动' && a.source === 'calendar'));
    check('同步不会丢掉本地活动', afterFirst.some(a => a.name === '本地会议' && a.source === 'local'));
    check('绑定记录上次同步结果', DataManager.getCalendarBinding(UID)?.lastResult === 'ok');

    // 远端删除 → 再次同步后本地对应活动消失，本地活动仍在
    feedBody = EVENT_FEED('只剩这一个', futureCompactIcs, `${futureCompactIcs.slice(0, 9)}110000`);
    const second = await syncUserCalendar(UID);
    const afterSecond = DataManager.getActivities(UID);
    check('远端删除的事件在同步后消失', !afterSecond.some(a => a.name === '志愿者活动'));
    check('同步后保留新事件', afterSecond.some(a => a.name === '只剩这一个'));
    check('本地活动始终保留', afterSecond.some(a => a.name === '本地会议'));
    check('第二次同步成功', second.ok === true);

    // 失败时记录错误状态
    DataManager.setCalendarBinding(UID, { url: `${base}/plain.html` });
    const failed = await syncUserCalendar(UID);
    check('拉取失败时同步返回失败', failed.ok === false && failed.message.includes('失败'));
    check('失败状态写入绑定', DataManager.getCalendarBinding(UID)?.lastResult === 'error');

    // ===== 9. ICS 导出（往返校验）=====
    const outIcs = buildScheduleIcs({
        nickname: '喵喵',
        activities: [{ id: 'act-x', name: '志愿者', location: '第一学科楼', date: todayStr, startTime: '10:00', endTime: '16:00' }],
        courses: [{ name: '高等数学', teacher: '张老师', location: '教107', day: 1, startTime: '08:00', endTime: '09:40', weeks: [1, 2] }],
        semesterStart: todayStr
    });
    check('导出 ICS 结构完整', outIcs.includes('BEGIN:VCALENDAR') && outIcs.includes('END:VCALENDAR'));
    check('导出包含活动与课程', outIcs.includes('SUMMARY:志愿者') && outIcs.includes('SUMMARY:高等数学'));
    const roundtrip = parseCalendarEvents(outIcs, { since: new Date(Date.now() - 86400000 * 400), until: new Date(Date.now() + 86400000 * 400) });
    check('导出的 ICS 能被自己解析回来', roundtrip.some(e => e.summary === '志愿者') && roundtrip.some(e => e.summary === '高等数学'));
} finally {
    await new Promise(resolve => server.close(resolve));
    process.chdir(originCwd);
    try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { }
}

console.log(fail === 0 ? '\n全部用例通过 ✅' : `\n${fail} 个用例失败 ❌`);
process.exit(fail === 0 ? 0 : 1);

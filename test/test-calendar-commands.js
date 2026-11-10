// 临时测试：日历接入的命令层（#日历绑定 / #日历同步 / #日历状态 / #日历解绑 / #日历导出 / 帮助）
// 服务层（拉取/解析/合并）见 test/test-calendar-sync.js
// 运行方式（从 Yunzai 根目录）：node plugins/schedule/test/test-calendar-commands.js
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
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-calendar-cmd-'));
fs.mkdirSync(path.join(sandbox, 'plugins/schedule/data'), { recursive: true });
fs.mkdirSync(path.join(sandbox, 'plugins/schedule/config/config'), { recursive: true });
const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const future = new Date(now.getTime() + 15 * 86400000);
const futureCompact = `${future.getFullYear()}${pad(future.getMonth() + 1)}${pad(future.getDate())}T100000`;
fs.writeFileSync(path.join(sandbox, 'plugins/schedule/config/config/schedule.yaml'),
    'calendarAllowPrivateHost: true\ncalendarSyncEnabled: true\ncalendarSyncInterval: 60\n', 'utf8');

// ---------- 本地日历 mock ----------
const FEED = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//mock//CN',
    'BEGIN:VEVENT',
    'UID:cmd-event-1@mock',
    'DTSTAMP:20260101T000000Z',
    `DTSTART:${futureCompact}`,
    `DTEND:${futureCompact.slice(0, 9)}120000`,
    'SUMMARY:志愿者活动',
    'LOCATION:第一学科楼',
    'END:VEVENT',
    'END:VCALENDAR'
].join('\r\n');

const server = http.createServer((req, res) => {
    if (req.url.startsWith('/feed.ics')) {
        res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8' });
        res.end(FEED);
        return;
    }
    res.writeHead(404); res.end('not found');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const originCwd = process.cwd();
process.chdir(sandbox);

try {
    const { DataManager } = await import('../components/DataManager.js');
    const { ScheduleCalendar } = await import('../apps/calendar.js');

    const UID = '50002';
    const plugin = new ScheduleCalendar();
    let replies = [];
    const ctx = (msg, extra = {}) => {
        replies = [];
        plugin.reply = async (text) => { replies.push(String(text)); };
        plugin.e = { user_id: UID, self_id: 10000, msg, is_group: false, ...extra };
        return replies;
    };
    const last = () => replies[replies.length - 1] || '';

    // ===== 1. 帮助 / 无参数 =====
    ctx('#日历帮助');
    await plugin.calendarHelp();
    check('帮助命令可用', last().includes('日历接入用法'));

    ctx('#日历绑定');
    await plugin.bindCalendar();
    check('无参数时给出用法', last().includes('#日历绑定 caldav') && last().includes('#日历绑定 ics'));

    // ===== 2. 未绑定时各命令的提示 =====
    ctx('#日历同步');
    await plugin.syncCalendar();
    check('未绑定时同步给出提示', last().includes('还没有绑定日历'));
    ctx('#日历状态');
    await plugin.calendarStatus();
    check('未绑定时状态给出提示', last().includes('还没有绑定日历'));
    ctx('#日历解绑');
    await plugin.unbindCalendar();
    check('未绑定时解绑给出提示', last().includes('还没有绑定日历'));

    // ===== 3. 参数与安全检查 =====
    ctx('#日历绑定 ics');
    await plugin.bindCalendar();
    check('缺地址时给出提示', last().includes('格式不对'));
    ctx(`#日历绑定 ics ftp://example.com/a.ics`);
    await plugin.bindCalendar();
    check('非 http(s) 地址被拒绝', last().includes('仅支持 http/https'));
    ctx(`#日历绑定 caldav ${base}/feed.ics admin secret`, { is_group: '123456' });
    await plugin.bindCalendar();
    check('群里携带密码的绑定被拒绝', last().includes('私聊'));
    ctx('#日历绑定 caldav');
    await plugin.bindCalendar();
    check('CalDAV 缺参时给出用法', last().includes('#日历绑定 caldav'));

    // ===== 4. 绑定 ICS（私聊，无需密码）=====
    ctx(`#日历绑定 ics ${base}/feed.ics`);
    await plugin.bindCalendar();
    check('私聊绑定 ICS 成功', last().includes('绑定成功'));
    check('绑定写入 binding 且标记为 ok', DataManager.getCalendarBinding(UID)?.lastResult === 'ok');
    check('绑定后立即同步到了事件', DataManager.getActivities(UID).some(a => a.name === '志愿者活动'));
    check('绑定回复里给出提示', last().includes('#日历同步'));

    // ===== 5. 状态 / 手动同步 =====
    ctx('#日历状态');
    await plugin.calendarStatus();
    check('状态展示方式与地址', last().includes('ICS 订阅') && last().includes('127.0.0.1'));
    check('状态展示事件统计', last().includes('日历 1 条') || last().includes('日历'));

    ctx('#日历同步');
    await plugin.syncCalendar();
    check('手动同步成功', last().includes('同步完成'));

    // ===== 6. 导出（stub sendFile）=====
    let sentFile = null;
    ctx('#日历导出', {
        friend: {
            sendFile: async (filePath) => {
                sentFile = { filePath, content: fs.readFileSync(filePath, 'utf8') };
            }
        }
    });
    await plugin.exportCalendar();
    check('导出命令发送了 .ics 文件', !!sentFile && sentFile.content.includes('BEGIN:VCALENDAR'));
    check('导出的 ICS 含活动', sentFile.content.includes('SUMMARY:志愿者活动'));

    // ===== 7. 解绑：清掉日历活动，保留本地活动 =====
    DataManager.saveActivities(UID, [
        { id: 'loc', name: '本地会议', date: todayStr, startTime: '08:00', endTime: '09:00' },
        { id: 'cal', name: '来自日历', date: todayStr, startTime: '10:00', endTime: '11:00', source: 'calendar', externalUid: 'x' }
    ]);
    ctx('#日历解绑');
    await plugin.unbindCalendar();
    check('解绑成功', last().includes('已解绑'));
    check('解绑后绑定记录被删除', DataManager.getCalendarBinding(UID) === null);
    check('解绑清除日历来源活动', !DataManager.getActivities(UID).some(a => a.name === '来自日历'));
    check('解绑保留本地活动', DataManager.getActivities(UID).some(a => a.name === '本地会议'));

    // ===== 8. 定时同步开关（CalendarScheduler）=====
    const { syncAllCalendars } = await import('../components/CalendarScheduler.js');
    DataManager.setCalendarBinding(UID, { provider: 'ics', url: `${base}/feed.ics`, enabled: true });
    const round = await syncAllCalendars();
    check('定时同步能批量处理已绑定用户', round.total >= 1 && round.ok >= 1);
    check('批量同步后活动落库', DataManager.getActivities(UID).some(a => a.name === '志愿者活动'));
} finally {
    await new Promise(resolve => server.close(resolve));
    process.chdir(originCwd);
    try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { }
}

console.log(fail === 0 ? '\n全部用例通过 ✅' : `\n${fail} 个用例失败 ❌`);
process.exit(fail === 0 ? 0 : 1);

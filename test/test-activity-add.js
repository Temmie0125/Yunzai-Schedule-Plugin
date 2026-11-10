// 临时测试：#clsadd 添加活动（一行式 / 轮询式）与 #取消添加 撤销
// 运行方式（从 Yunzai 根目录）：node plugins/schedule/test/test-activity-add.js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let fail = 0;
function check(label, cond) {
    if (!cond) fail++;
    console.log(`[${cond ? 'PASS' : 'FAIL'}] ${label}`);
}

// ---------- 宿主替身 ----------
global.logger = Object.assign(Object.create(console), {
    mark: console.log, info: console.log, warn: console.warn, error: console.error,
    debug: () => { }, green: (s) => s, blue: (s) => s, yellow: (s) => s, red: (s) => s
});
global.plugin = class {
    constructor(cfg = {}) { this.name = cfg.name; this.rule = cfg.rule || []; this.contexts = []; }
    setContext(type) { this.contexts.push(type); }
    finish() { }
    getContext() { return null; }
    async reply() { }
};
global.Bot = { uin: 10000, version: { toString: () => 'v3' }, on: () => { }, off: () => { }, em: { on: () => { }, off: () => { } } };

// ---------- 沙箱 ----------
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-activity-add-'));
const dataDir = path.join(sandbox, 'plugins/schedule/data');
const configDir = path.join(sandbox, 'plugins/schedule/config/config');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(configDir, { recursive: true });
const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const todayCompact = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
const future = new Date(now.getTime() + 30 * 86400000);
const futureCompact = `${future.getFullYear()}${pad(future.getMonth() + 1)}${pad(future.getDate())}`;
const futureStr = `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}`;
const semesterStartDate = new Date(now.getTime() - 7 * 86400000);
const semesterStart = `${semesterStartDate.getFullYear()}-${pad(semesterStartDate.getMonth() + 1)}-${pad(semesterStartDate.getDate())}`;
const weekday = now.getDay() === 0 ? 7 : now.getDay();
fs.writeFileSync(path.join(configDir, 'schedule.yaml'), `defaultSemesterStart: "${semesterStart}"\n`, 'utf8');

const originCwd = process.cwd();
process.chdir(sandbox);

try {
    const { DataManager } = await import('../components/DataManager.js');
    const { ScheduleActivity } = await import('../apps/activity.js');

    // 预置一份课表：今天第 2 周有一门 10:00-11:40 的课，用来验证重叠提示
    DataManager.saveSchedule('20001', {
        tableName: '课表', semesterStart,
        courses: [{ name: '高等数学', teacher: '张老师', location: '教107', day: weekday, startTime: '10:00', endTime: '11:40', weeks: [1, 2, 3, 4] }]
    }, '喵喵', '');

    const plugin = new ScheduleActivity();
    let replies = [];
    function feed(msg) {
        replies = [];
        plugin.reply = async (text) => { replies.push(String(text)); };
        plugin.e = { user_id: '20001', self_id: 10000, msg, group_id: '99999' };
        return replies;
    }
    const lastReply = () => replies[replies.length - 1] || '';
    const acts = () => DataManager.getActivities('20001');

    // ===== 1. 一行式添加 =====
    feed(`#clsadd ${futureCompact} 1000-1600 志愿者 第一学科楼`);
    await plugin.addActivity();
    check('一行式添加成功', lastReply().includes('已添加活动'));
    check('日期/时间/名称/地点正确落库', (() => {
        const list = acts();
        const item = list[list.length - 1];
        return item.date === futureStr && item.startTime === '10:00' && item.endTime === '16:00'
            && item.name === '志愿者' && item.location === '第一学科楼';
    })());
    check('回复里带撤销指引', lastReply().includes('#取消添加'));

    // ===== 2. 紧凑时间与多词地点 =====
    feed(`#clsadd ${futureCompact} 930-1130 期中考试 第一教学楼 A101`);
    await plugin.addActivity();
    const exam = acts().find(a => a.name === '期中考试');
    check('紧凑时间 930-1130 归一化为 09:30-11:30', exam?.startTime === '09:30' && exam?.endTime === '11:30');
    check('地点支持带空格的多词', exam?.location === '第一教学楼 A101');

    // ===== 3. 各种非法输入 =====
    feed(`#clsadd ${futureCompact} 1000-1600`);
    await plugin.addActivity();
    check('参数不足时给出用法', lastReply().includes('#clsadd'));
    feed('#clsadd 20261301 1000-1600 坏日期');
    await plugin.addActivity();
    check('非法日期被拒绝', lastReply().includes('看不懂日期'));
    feed(`#clsadd ${futureCompact} 1600-1000 倒置`);
    await plugin.addActivity();
    check('结束早于开始被拒绝', lastReply().includes('看不懂时间段'));
    feed(`#clsadd ${futureCompact} 1000-1600 ${'喵'.repeat(31)}`);
    await plugin.addActivity();
    check('名称超长被拒绝', lastReply().includes('名称太长'));
    check('非法输入都没有落库', acts().length === 2);

    // ===== 4. 重复添加 =====
    feed(`#clsadd ${futureCompact} 1000-1600 志愿者 第一学科楼`);
    await plugin.addActivity();
    check('重复活动提示已添加过', lastReply().includes('已经添加过'));
    check('重复活动不会重复入库', acts().filter(a => a.name === '志愿者').length === 1);

    // ===== 5. 与当天课程时间重叠时给出提示 =====
    feed(`#clsadd ${todayCompact} 1030-1200 突发会议`);
    await plugin.addActivity();
    check('重叠时提示与已有安排冲突', lastReply().includes('重叠') && lastReply().includes('高等数学'));

    // ===== 6. 轮询添加（日期→时间→名称→地点→确认）=====
    feed('#clsadd');
    await plugin.addActivity();
    check('不带参数进入轮询', lastReply().includes('请发送活动') && plugin.contexts.includes('clsadd_date'));

    feed(futureCompact);
    await plugin.clsadd_date();
    check('轮询①日期通过', lastReply().includes('时间段') && plugin.contexts.includes('clsadd_time'));

    feed('1400-1530');
    await plugin.clsadd_time();
    check('轮询②时间段通过', lastReply().includes('活动名称') && plugin.contexts.includes('clsadd_name'));

    feed('社团招新');
    await plugin.clsadd_name();
    check('轮询③名称通过', lastReply().includes('地点') && plugin.contexts.includes('clsadd_location'));

    feed('无');
    await plugin.clsadd_location();
    check('轮询④地点为「无」时留空并进入确认', lastReply().includes('请确认') && plugin.contexts.includes('clsadd_confirm'));

    feed('确认');
    await plugin.clsadd_confirm();
    check('轮询⑤确认后保存成功', lastReply().includes('已添加活动'));
    const club = acts().find(a => a.name === '社团招新');
    check('轮询添加的字段正确', club?.date === futureStr && club?.startTime === '14:00'
        && club?.endTime === '15:30' && club?.location === '');

    // ===== 7. 轮询流程中发「取消」=====
    feed('#clsadd');
    await plugin.addActivity();
    feed(futureCompact);
    await plugin.clsadd_date();
    feed('取消');
    await plugin.clsadd_time();
    check('轮询中发送「取消」中断流程', lastReply().includes('已取消添加活动'));
    const before = acts().length;
    feed('10:00-11:00');
    await plugin.clsadd_time();
    check('中断后旧会话不再生效', acts().length === before && lastReply().includes('超时'));

    // ===== 8. #取消添加 撤销最近添加 =====
    const countBeforeUndo = acts().length;
    feed(`#取消添加 ${futureCompact}`);
    await plugin.cancelAdd();
    check('#取消添加 撤销成功', lastReply().includes('已撤销活动'));
    check('撤销后条数 -1', acts().length === countBeforeUndo - 1);
    feed('#取消添加 20200101');
    await plugin.cancelAdd();
    check('撤销指定日期无记录时给出提示', lastReply().includes('没有添加过活动'));

    // ===== 9. #活动列表 =====
    feed('#活动列表');
    await plugin.listActivities();
    check('活动列表能列出即将到来的活动', lastReply().includes('活动') && lastReply().includes('志愿者'));
    feed(`#活动列表 ${todayCompact}`);
    await plugin.listActivities();
    check('活动列表可按日期过滤', lastReply().includes('突发会议') && !lastReply().includes('志愿者'));
} finally {
    process.chdir(originCwd);
    try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { }
}

console.log(fail === 0 ? '\n全部用例通过 ✅' : `\n${fail} 个用例失败 ❌`);
process.exit(fail === 0 ? 0 : 1);

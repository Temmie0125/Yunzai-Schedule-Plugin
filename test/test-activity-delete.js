// 临时测试：#clsdel 删除课程/活动（第几节 / 时间段 / 教室 / 课程名 / 单日 / 区间）
// 运行方式（从 Yunzai 根目录）：node plugins/schedule/test/test-activity-delete.js
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
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-activity-del-'));
fs.mkdirSync(path.join(sandbox, 'plugins/schedule/data'), { recursive: true });
fs.mkdirSync(path.join(sandbox, 'plugins/schedule/config/config'), { recursive: true });
const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const todayCompact = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
const weekAgo = new Date(now.getTime() - 7 * 86400000);
const semesterStart = `${weekAgo.getFullYear()}-${pad(weekAgo.getMonth() + 1)}-${pad(weekAgo.getDate())}`;
const weekday = now.getDay() === 0 ? 7 : now.getDay();
const otherWeekday = weekday === 1 ? 2 : 1;
fs.writeFileSync(path.join(sandbox, 'plugins/schedule/config/config/schedule.yaml'),
    `defaultSemesterStart: "${semesterStart}"\n`, 'utf8');

const UID = '30001';
const originCwd = process.cwd();
process.chdir(sandbox);

try {
    const { DataManager } = await import('../components/DataManager.js');
    const { ScheduleActivity } = await import('../apps/activity.js');

    const COURSES = () => ([
        { name: '高等数学', teacher: '张老师', location: '教107', day: weekday, startTime: '10:00', endTime: '11:40', weeks: [1, 2, 3, 4] },
        { name: '大学英语', teacher: '李老师', location: '教205', day: weekday, startTime: '14:00', endTime: '15:40', weeks: [1, 2, 3, 4] },
        { name: '只在今天的课', teacher: '', location: '教301', day: weekday, startTime: '19:00', endTime: '20:00', weeks: [2] },
        { name: '别的日子的课', teacher: '', location: '教401', day: otherWeekday, startTime: '08:00', endTime: '09:00', weeks: [1, 2, 3] }
    ]);
    const ACTIVITY = () => ({
        id: 'act-fixed-1', name: '志愿者', location: '教107', date: todayStr,
        startTime: '14:00', endTime: '15:00', createdAt: new Date().toISOString()
    });
    function seed() {
        DataManager.saveSchedule(UID, { tableName: '课表', semesterStart, courses: COURSES() }, '喵喵', '');
        DataManager.saveActivities(UID, [ACTIVITY()]);
    }
    const courses = () => DataManager.loadSchedule(UID)?.courses || [];
    const acts = () => DataManager.getActivities(UID);
    const findCourse = (name) => courses().find(c => c.name === name);

    const plugin = new ScheduleActivity();
    let replies = [];
    async function run(msg, fn, arg) {
        replies = [];
        plugin.reply = async (text) => { replies.push(String(text)); };
        plugin.e = { user_id: UID, self_id: 10000, msg, group_id: '99999' };
        await plugin[fn || 'deleteEntries'](arg);
        return replies[replies.length - 1] || '';
    }
    const allText = () => replies.join('\n');

    // ===== 1. 按「第几节」删除 =====
    seed();
    await run(`#clsdel 今天 第2节`);
    check('第2节预览只列出该条目', allText().includes('大学英语') && !allText().includes('高等数学'));
    check('预览要求二次确认', allText().includes('确认'));
    await run('确认', 'clsdel_confirm');
    check('第2节删除成功', allText().includes('删除完成'));
    check('被删课程仅少掉本次周次', JSON.stringify(findCourse('大学英语')?.weeks) === JSON.stringify([1, 3, 4]));
    check('其它课程不受影响', JSON.stringify(findCourse('高等数学')?.weeks) === JSON.stringify([1, 2, 3, 4]));
    check('活动不受影响', acts().length === 1);

    // ===== 2. 按「指定教室」删除（同时命中课程与活动）=====
    seed();
    await run(`#clsdel 今天 地点:教107`);
    check('按教室匹配到课程与活动', allText().includes('高等数学') && allText().includes('志愿者'));
    await run('确认', 'clsdel_confirm');
    check('活动被整条删除', acts().length === 0);
    check('教室命中的课程只少本次周次', JSON.stringify(findCourse('高等数学')?.weeks) === JSON.stringify([1, 3, 4]));

    // ===== 3. 按「指定课程名」删除 =====
    seed();
    await run(`#clsdel 今天 课程:高等数学`);
    check('按课程名只匹配该课程', allText().includes('高等数学') && !allText().includes('大学英语'));
    await run('取消', 'clsdel_confirm');
    check('取消后什么都没删', JSON.stringify(findCourse('高等数学')?.weeks) === JSON.stringify([1, 2, 3, 4]) && acts().length === 1);

    // ===== 4. 按「指定时间段」删除 =====
    seed();
    await run(`#clsdel 今天 1400-1440`);
    check('时间段只匹配重叠条目', allText().includes('大学英语') && allText().includes('志愿者') && !allText().includes('高等数学'));
    await run('确认', 'clsdel_confirm');
    check('时间段删除活动成功', acts().length === 0);
    check('时间段删除课程成功', JSON.stringify(findCourse('大学英语')?.weeks) === JSON.stringify([1, 3, 4]));

    // ===== 5. 清空某门课的最后一周 → 课程整体消失 =====
    seed();
    await run(`#clsdel 今天 课程:只在今天的课`);
    await run('确认', 'clsdel_confirm');
    check('周次被删空的课程整体移除', !findCourse('只在今天的课'));

    // ===== 6. 删除单日全部条目 =====
    seed();
    await run(`#clsdel ${todayCompact}`);
    check('不带条件时预览今天全部条目', allText().includes('高等数学') && allText().includes('志愿者'));
    await run('确认', 'clsdel_confirm');
    check('单日删除后活动清空', acts().length === 0);
    check('单日删除后当天课程都少本次周次',
        courses().filter(c => Number(c.day) === weekday).every(c => !c.weeks.includes(2)));
    check('其它日子的课程不受影响（仍保留第 2 周）',
        courses().filter(c => Number(c.day) === otherWeekday).every(c => c.weeks.includes(2)));

    // ===== 7. 区间删除（本周 + 下周）=====
    seed();
    const nextWeek = new Date(now.getTime() + 7 * 86400000);
    const nextWeekCompact = `${nextWeek.getFullYear()}${pad(nextWeek.getMonth() + 1)}${pad(nextWeek.getDate())}`;
    await run(`#clsdel ${todayCompact} ${nextWeekCompact} 课程:高等数学`);
    check('区间预览标注日期范围', allText().includes(todayStr) && allText().includes('~'));
    await run('确认', 'clsdel_confirm');
    check('区间删除同时去掉第 2、3 周', JSON.stringify(findCourse('高等数学')?.weeks) === JSON.stringify([1, 4]));

    // ===== 8. 无匹配 / 非法参数 =====
    seed();
    await run(`#clsdel 今天 课程:不存在的课`);
    check('无匹配时给出提示与用法', allText().includes('没有找到匹配的条目') && allText().includes('#clsdel'));
    await run(`#clsdel 今天 第9节`);
    check('超出当天条目数时无匹配', allText().includes('没有找到匹配的条目'));
    await run(`#clsdel ${todayCompact} 2020-01-01 课程:高等数学`);
    check('区间跨度过长被拒绝', allText().includes('太长'));

    // ===== 9. 只删活动、不误伤课程 =====
    seed();
    await run(`#clsdel 今天 活动:志愿者`);
    check('按名称也可匹配活动', allText().includes('志愿者'));
    await run('确认', 'clsdel_confirm');
    check('活动删除后课程完好', acts().length === 0
        && COURSES().every(c => JSON.stringify(findCourse(c.name)?.weeks) === JSON.stringify(c.weeks)));
} finally {
    process.chdir(originCwd);
    try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { }
}

console.log(fail === 0 ? '\n全部用例通过 ✅' : `\n${fail} 个用例失败 ❌`);
process.exit(fail === 0 ? 0 : 1);

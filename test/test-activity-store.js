// 临时测试：活动（会议/活动/考试等）数据层与渲染标记
// 覆盖：时间/日期解析、活动存储与规范化、按日期并入课程、导出保留、
//       群课表/所有人课表包含「只有活动」的用户、圆点空心圈后缀、清除课表一并清除
// 运行方式（从 Yunzai 根目录）：node plugins/schedule/test/test-activity-store.js
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
    constructor(cfg = {}) { this.name = cfg.name; this.rule = cfg.rule || []; }
    setContext() { } finish() { } getContext() { return null; }
    async reply() { }
};
global.Bot = {
    uin: 10000,
    version: { toString: () => 'v3' },
    on: () => { }, off: () => { },
    em: { on: () => { }, off: () => { } }
};

// ---------- 沙箱 ----------
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-activity-'));
const dataDir = path.join(sandbox, 'plugins/schedule/data');
const configDir = path.join(sandbox, 'plugins/schedule/config/config');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(configDir, { recursive: true });
fs.writeFileSync(path.join(configDir, 'schedule.yaml'), `defaultSemesterStart: "${new Date().getFullYear()}-01-01"\n`, 'utf8');

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const todayCompact = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
// 学期开始 = 上一周的周一，保证今天落在第 2 周
const semesterStartDate = new Date(now.getTime() - 7 * 86400000);
const semesterStart = `${semesterStartDate.getFullYear()}-${pad(semesterStartDate.getMonth() + 1)}-${pad(semesterStartDate.getDate())}`;
const weekday = now.getDay() === 0 ? 7 : now.getDay();

const originCwd = process.cwd();
process.chdir(sandbox);

try {
    const { DataManager } = await import('../components/DataManager.js');
    const { parseTimeRange, parseActivityDate, buildCourseDots, formatDate } = await import('../utils/timeUtils.js');

    // ===== 1. 时间段解析 =====
    const tr1 = parseTimeRange('1000-1600');
    check('时间段：1000-1600 → 10:00-16:00', tr1?.startTime === '10:00' && tr1?.endTime === '16:00');
    const tr2 = parseTimeRange('930-1130');
    check('时间段：930-1130 → 09:30-11:30', tr2?.startTime === '09:30' && tr2?.endTime === '11:30');
    const tr3 = parseTimeRange('10:00-12:00');
    check('时间段：HH:MM-HH:MM', tr3?.startTime === '10:00' && tr3?.endTime === '12:00');
    const tr4 = parseTimeRange('10:00~12:00');
    check('时间段：支持 ~ 分隔符', tr4?.startTime === '10:00' && tr4?.endTime === '12:00');
    check('时间段：结束早于开始判为非法', parseTimeRange('1600-1000') === null);
    check('时间段：结束等于开始判为非法', parseTimeRange('1000-1000') === null);
    check('时间段：非法小时判为非法', parseTimeRange('2500-2600') === null);
    check('时间段：乱码判为非法', parseTimeRange('志愿者') === null);

    // ===== 2. 日期解析 =====
    const ad1 = parseActivityDate(todayCompact);
    check('日期：20261112 紧凑写法', !!ad1 && formatDate(ad1) === todayStr);
    const ad2 = parseActivityDate(todayStr);
    check('日期：YYYY-MM-DD', !!ad2 && formatDate(ad2) === todayStr);
    const ad3 = parseActivityDate(`${pad(now.getMonth() + 1)}-${pad(now.getDate())}`, semesterStart);
    check('日期：MM-DD 按学期年补全', !!ad3 && formatDate(ad3) === todayStr);
    check('日期：不存在的日期判为非法', parseActivityDate('20261301') === null);

    // ===== 3. 活动存储与规范化 =====
    check('没有活动时返回空数组', DataManager.getActivities('10001').length === 0);
    const saved = DataManager.saveActivities('10001', [
        { name: '  志愿者  ', location: '第一学科楼', date: todayCompact, startTime: '1000', endTime: '1600' },
        { name: '考试', location: '', date: todayCompact, startTime: '09:00', endTime: '11:00' },
        { name: '', date: todayCompact, startTime: '09:00', endTime: '10:00' },            // 缺名称
        { name: '时间倒置', date: todayCompact, startTime: '16:00', endTime: '10:00' },     // 结束<开始
        { name: '日期非法', date: '2026-13-40', startTime: '10:00', endTime: '11:00' }
    ]);
    check('保存活动成功', saved === true);
    const acts = DataManager.getActivities('10001');
    check('非法活动被丢弃（只留 2 条）', acts.length === 2);
    check('名称去除首尾空格', acts.some(a => a.name === '志愿者'));
    check('活动按开始时间排序', acts[0].name === '考试' && acts[1].name === '志愿者');
    check('自动生成唯一 id', acts.every(a => typeof a.id === 'string' && a.id.startsWith('act-')));
    check('时间为补零格式', acts.every(a => /^\d{2}:\d{2}$/.test(a.startTime)));
    check('没有课表文件时自动建骨架（tableName=活动日程）',
        DataManager.loadSchedule('10001')?.tableName === '活动日程');
    check('骨架文件里 courses 为空数组', Array.isArray(DataManager.loadSchedule('10001')?.courses)
        && DataManager.loadSchedule('10001').courses.length === 0);

    // ===== 4. 按日期并入当天课程 =====
    const got = await DataManager.getCoursesForDate('10001', now);
    check('今日课程包含 2 条活动', got.courses?.length === 2 && got.courses.every(c => c.isActivity === true));
    check('活动带 activityId 便于删除', got.courses.every(c => typeof c.activityId === 'string'));

    // ===== 5. 只有活动的用户也要出现在群课表 / 所有人课表 =====
    check('所有人课表包含「只有活动」的用户',
        DataManager.getAllUserSchedules().some(u => u.userId === '10001'));
    const { GroupSchedulePlugin } = await import('../apps/group-schedule.js');
    const groupPlugin = new GroupSchedulePlugin();
    const memberData = await groupPlugin.getMemberScheduleData('10001', { card: '喵喵' }, weekday, '09:30');
    check('群课表能取到「只有活动」的成员', !!memberData);
    check('成员当前课程是活动', memberData?.currentCourse?.isActivity === true);
    check('状态按活动时间判定为「上课中」', memberData?.status === '上课中');
    check('圆点里活动带 -activity 后缀（渲染为空心圈）',
        memberData?.courseDots?.visible.every(v => v.endsWith('-activity')));

    // ===== 6. 全天事件：只标注，不算“占满全天”（不会把课程挤成分身中）=====
    const { formatCourses } = DataManager;
    DataManager.saveSchedule('10003', {
        tableName: '课表', semesterStart,
        courses: [{ name: '高等数学', teacher: '', location: '教107', day: weekday, startTime: '10:00', endTime: '11:40', weeks: [1, 2, 3, 4] }]
    });
    DataManager.saveActivities('10003', [
        { name: '运动会', location: '', date: todayStr, startTime: '00:00', endTime: '23:59', allDay: true },
        { name: '志愿者', location: '', date: todayStr, startTime: '15:00', endTime: '16:00' }
    ]);
    const allDaySaved = DataManager.getActivities('10003').find(a => a.name === '运动会');
    check('全天事件标记被持久化', allDaySaved?.allDay === true);
    check('普通活动不带 allDay 标记', DataManager.getActivities('10003').find(a => a.name === '志愿者')?.allDay === false);
    const allDayMember = await groupPlugin.getMemberScheduleData('10003', { card: '小明' }, weekday, '10:30');
    check('全天事件不会把状态挤成「分身中」', allDayMember?.status === '上课中');
    check('当前课程是真正的课程而非全天事件', allDayMember?.currentCourse?.name === '高等数学');
    check('全天事件单独标注出来（含名称）',
        allDayMember?.allDayActivitiesText?.includes('运动会'));
    check('全天事件不进入今日圆点', allDayMember?.courseDots?.total === 2);
    const allDayText = formatCourses([
        { name: '运动会', teacher: '', location: '', startTime: '00:00', endTime: '23:59', allDay: true }
    ], 2, weekday, '小明');
    check('文本降级里全天事件显示「全天」', allDayText.includes('🕐 全天') && !allDayText.includes('00:00 - 23:59'));

    // ===== 7. 圆点后缀：混排课程与活动 =====
    const mixed = [
        { name: '课1', startTime: '08:00', endTime: '09:00' },
        { name: '活动', startTime: '10:00', endTime: '11:00', isActivity: true },
        { name: '课2', startTime: '14:00', endTime: '15:00' }
    ];
    const dots = buildCourseDots(mixed, 10 * 60 + 30);
    check('混排：课程用实心状态、活动用 -activity 后缀',
        dots.visible[0] === 'finished' && dots.visible[1] === 'ongoing-activity' && dots.visible[2] === 'upcoming');
    check('省略窗口计数不受后缀影响（total 正确）', dots.total === 3);

    // ===== 7. 保存课表（调课/导入路径）不得冲掉活动 =====
    DataManager.saveSchedule('10001', {
        tableName: '课表', semesterStart,
        courses: [{ name: '高等数学', day: weekday, startTime: '08:00', endTime: '09:00', weeks: [1, 2, 3] }]
    });
    check('saveSchedule 保留已有活动', DataManager.getActivities('10001').length === 2);

    // ===== 8. 原生格式导出保留活动 =====
    const exported = DataManager.convertToNativeFormat(DataManager.loadSchedule('10001'));
    check('原生格式导出带 activities', Array.isArray(exported.activities) && exported.activities.length === 2);
    check('导出的活动字段完整',
        exported.activities.every(a => a.name && a.date && a.startTime && a.endTime));

    // ===== 9. #清除课表 一并清除活动 =====
    const removed = DataManager.removeUserSchedule('10001');
    check('清除课表成功', removed.success === true);
    check('活动随文件一起被清除', DataManager.getActivities('10001').length === 0);
    check('清除后不再出现在所有人课表',
        !DataManager.getAllUserSchedules().some(u => u.userId === '10001'));
} finally {
    process.chdir(originCwd);
    try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { }
}

console.log(fail === 0 ? '\n全部用例通过 ✅' : `\n${fail} 个用例失败 ❌`);
process.exit(fail === 0 ? 0 : 1);

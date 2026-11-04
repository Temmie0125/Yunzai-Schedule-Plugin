// 临时测试：#清除课表 必须真正删除课表数据文件，同时保留昵称/签名
// 复现的问题：旧实现只把 courses 清空、文件留着 → 群课表仍会把该用户当成“已设置课表的成员”，
//            渲染出一张「今日暂无课程」的空卡片；想彻底删除又会导致昵称/签名丢失。
// 运行方式（从 Yunzai 根目录）：node plugins/schedule/test/test-clear-schedule.js
// 隔离措施：把 process.cwd() 指向临时沙箱后再动态导入插件，绝不读写真实 data 目录
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
    mark: console.log,
    info: console.log,
    warn: console.warn,
    error: console.error,
    debug: () => { },
    green: (s) => s,
    blue: (s) => s,
    yellow: (s) => s,
    red: (s) => s
});
global.plugin = class {
    constructor(cfg = {}) {
        this.name = cfg.name;
        this.rule = cfg.rule || [];
    }
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
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-clear-'));
const dataDir = path.join(sandbox, 'plugins/schedule/data');
fs.mkdirSync(dataDir, { recursive: true });

const UID = '10001';
const scheduleFile = path.join(dataDir, `${UID}.json`);
const COURSE = {
    name: '高等数学', teacher: '张老师', location: '教107',
    day: 1, startTime: '08:00', endTime: '08:45', weeks: [1, 2, 3]
};

const originCwd = process.cwd();
process.chdir(sandbox);

try {
    const { DataManager } = await import('../components/DataManager.js');
    const { GroupSchedulePlugin } = await import('../apps/group-schedule.js');

    // ===== 1. 前置：用户已有课表 + 昵称 + 签名 =====
    DataManager.saveSchedule(UID, {
        tableName: '我的课表',
        semesterStart: '2026-03-02',
        courses: [{ ...COURSE }]
    }, '喵喵', '早八人');
    check('课前：课表文件存在', fs.existsSync(scheduleFile));
    check('课前：昵称/签名已写入课表文件',
        DataManager.loadSchedule(UID)?.nickname === '喵喵'
        && DataManager.loadSchedule(UID)?.signature === '早八人');
    check('课前：出现在“所有人课表”的用户列表中',
        DataManager.getAllUserSchedules().some(u => u.userId === UID));

    const groupPlugin = new GroupSchedulePlugin();
    const day = 1;
    const before = await groupPlugin.getMemberScheduleData(UID, { card: '喵喵' }, day, '07:30');
    check('课前：群课表能取到该成员的数据', !!before && before.nickname === '喵喵');

    // ===== 2. 执行 #清除课表 =====
    const result = DataManager.removeUserSchedule(UID);
    check('#清除课表 返回成功', result.success === true && result.exists === true);
    check('#清除课表 保留了昵称与签名', result.nickname === '喵喵' && result.signature === '早八人');
    check('#清除课表 删除了课表数据文件（不再残留空课表）', !fs.existsSync(scheduleFile));
    check('#清除课表 后 loadSchedule 为空', DataManager.loadSchedule(UID) === null);
    check('#清除课表 后不再出现在“所有人课表”列表中',
        !DataManager.getAllUserSchedules().some(u => u.userId === UID));
    const after = await groupPlugin.getMemberScheduleData(UID, { card: '喵喵' }, day, '07:30');
    check('#清除课表 后群课表不再出现该成员（不会留下“今日暂无课程”空卡片）', after === null);
    check('昵称/签名已转入用户资料保留',
        DataManager.getUserProfile(UID)?.nickname === '喵喵'
        && DataManager.getUserProfile(UID)?.signature === '早八人');

    // ===== 3. 清除后改昵称：不得重新生成空课表文件 =====
    await DataManager.saveUserNickname(UID, '新昵称');
    check('清除后设置昵称不会重建课表文件（避免空卡片复活）', !fs.existsSync(scheduleFile));
    check('清除后设置昵称写入了用户资料', DataManager.getUserProfile(UID)?.nickname === '新昵称');

    // ===== 4. 重新导入课表：昵称/签名应自动恢复 =====
    DataManager.saveSchedule(UID, {
        tableName: '新学期的课表',
        semesterStart: '2026-03-02',
        courses: [{ ...COURSE }]
    });
    const restored = DataManager.loadSchedule(UID);
    check('重新导入后昵称从用户资料恢复', restored?.nickname === '新昵称');
    check('重新导入后个性签名从用户资料恢复', restored?.signature === '早八人');

    // ===== 5. 历史遗留的空课表文件（旧版本 #清除课表 的产物）同样不显示 =====
    const legacyId = '10002';
    fs.writeFileSync(path.join(dataDir, `${legacyId}.json`), JSON.stringify({
        userId: legacyId, tableName: '旧课表', semesterStart: '2026-03-02',
        nickname: '老残留', courses: []
    }, null, 2), 'utf8');
    const legacy = await groupPlugin.getMemberScheduleData(legacyId, { card: '老残留' }, day, '07:30');
    check('历史遗留的空课表文件不会渲染成“今日暂无课程”卡片', legacy === null);

    // ===== 6. 未设置课表的人：清除应返回 exists=false =====
    const missing = DataManager.removeUserSchedule('10003');
    check('未设置课表时返回 exists=false 且不报错', missing.success === false && missing.exists === false);
} finally {
    process.chdir(originCwd);
    try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { }
}

console.log(fail === 0 ? '\n全部用例通过 ✅' : `\n${fail} 个用例失败 ❌`);
process.exit(fail === 0 ? 0 : 1);

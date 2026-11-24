// 临时测试：课表数据文件里的 userId 不会被写丢（回应润滢查到的「json 缺 userId」问题）
// 运行方式（从 Yunzai 根目录）：node plugins/schedule/test/test-user-id-persist.js
// 覆盖所有会重写 data/<用户>.json 的路径：昵称/签名/时间表/学期开始/对齐课表/调课/撤销/保存课表/清除课表
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let fail = 0;
function check(label, cond, extra = '') {
    if (!cond) fail++;
    console.log(`[${cond ? 'PASS' : 'FAIL'}] ${label}${extra ? `  ${extra}` : ''}`);
}

global.logger = Object.assign(Object.create(console), {
    mark: () => { }, info: () => { }, warn: () => { }, error: () => { },
    debug: () => { }, green: (s) => s, blue: (s) => s, yellow: (s) => s, red: (s) => s
});
global.plugin = class { constructor(cfg = {}) { this.rule = cfg.rule || []; } setContext() { } finish() { } getContext() { return null; } async reply() { } };
global.Bot = { uin: 10000, version: { toString: () => 'v3' }, on() { }, off() { }, em: { on() { }, off() { } } };

const UID = '3763253157';
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-uid-'));
fs.mkdirSync(path.join(sandbox, 'plugins/schedule/data'), { recursive: true });
fs.mkdirSync(path.join(sandbox, 'plugins/schedule/config/config'), { recursive: true });
fs.writeFileSync(path.join(sandbox, 'plugins/schedule/config/config/schedule.yaml'),
    'defaultSemesterStart: "2026-09-07"\n', 'utf8');

const fileOf = (id) => path.join(sandbox, 'plugins/schedule/data', `${id}.json`);
const SAMPLE = {
    userId: UID,
    tableName: 'ICS 课程表',
    semesterStart: '2026-09-07',
    updateTime: '2026-11-03T01:37:27.218Z',
    nickname: 'A.消息服务',
    signature: '',
    courses: [
        { name: '高等数学', teacher: '张老师', location: '教107', day: 1, startTime: '08:00', endTime: '09:40', weeks: [1, 2, 3, 4] }
    ],
    timeSlots: [{ number: 1, startTime: '08:00', endTime: '08:45' }]
};
const restoreSample = () => fs.writeFileSync(fileOf(UID), JSON.stringify(SAMPLE, null, 2), 'utf8');
const read = (id = UID) => JSON.parse(fs.readFileSync(fileOf(id), 'utf8'));

const originCwd = process.cwd();
process.chdir(sandbox);

try {
    const { DataManager } = await import('../components/DataManager.js');

    // ===== 1. 昵称 / 签名 / 时间表 =====
    restoreSample();
    await DataManager.saveUserNickname(UID, '新昵称');
    check('保存昵称后 userId 仍在', read().userId === UID);

    restoreSample();
    await DataManager.saveUserSignature(UID, '新签名');
    check('保存签名后 userId 仍在', read().userId === UID);

    restoreSample();
    DataManager.saveUserTimeSlots(UID, [{ number: 1, startTime: '08:10', endTime: '08:55' }]);
    check('保存时间表后 userId 仍在', read().userId === UID);

    // ===== 2. 学期开始 =====
    restoreSample();
    DataManager.updateSemesterStart(UID, '2026-08-31');
    check('修改学期开始（文件已存在）后 userId 仍在', read().userId === UID);

    const NEW_UID = '900002';
    DataManager.updateSemesterStart(NEW_UID, '2026-08-31');
    check('新建学期配置（文件不存在）也带 userId', read(NEW_UID).userId === NEW_UID,
        `keys=${Object.keys(read(NEW_UID)).join(',')}`);

    // ===== 3. 对齐课表 =====
    restoreSample();
    DataManager.realignSemesterToCalendar(UID, '2026-08-31');
    check('对齐课表后 userId 仍在', read().userId === UID);

    // ===== 4. 保存课表（导入路径）=====
    restoreSample();
    DataManager.saveSchedule(UID, { ...SAMPLE, courses: SAMPLE.courses });
    check('保存课表后 userId 仍在', read().userId === UID);

    // ===== 5. 调课 / 撤销调课 =====
    restoreSample();
    DataManager.rescheduleCourses(UID, new Date('2026-09-07T00:00:00'), new Date('2026-09-08T00:00:00'));
    check('调课后 userId 仍在', read().userId === UID);
    DataManager.undoReschedule(UID, new Date('2026-09-08T00:00:00'));
    check('撤销调课后 userId 仍在', read().userId === UID);

    // ===== 6. 按节次更新课程时间 =====
    restoreSample();
    DataManager.updateCourseTimesBySlots(UID, new Map([[1, { start: '08:15', end: '09:00' }]]));
    check('按节次更新时间后 userId 仍在', read().userId === UID);

    // ===== 7. 清除课表（删整个文件，不是删字段）=====
    restoreSample();
    const removed = DataManager.removeUserSchedule(UID);
    check('清除课表删除整个文件而非 userId 行',
        removed.success === true && !fs.existsSync(fileOf(UID)));
} finally {
    process.chdir(originCwd);
    try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { }
}

console.log(fail === 0 ? '\n全部用例通过 ✅' : `\n${fail} 个用例失败 ❌`);
process.exit(fail === 0 ? 0 : 1);

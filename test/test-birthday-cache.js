// 临时测试：生日推送任务必须读到「手动添加」后的最新数据（内存快照失效问题）
// 复现：#添加生日 走的是「每条消息新建实例」的数据并写入磁盘，而定时任务绑定的是创建 job 的旧实例，
//       旧实例的 birthdayData 只是构造时的快照 → 不重启就不会推送手动添加的生日。
// 运行方式（从 Yunzai 根目录）：node plugins/schedule/test/test-birthday-cache.js
// 隔离措施：把 process.cwd() 指向临时沙箱后再动态导入插件，绝不读写真实 data/birthdayData.json
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let fail = 0;
function check(label, cond) {
    if (!cond) fail++;
    console.log(`[${cond ? 'PASS' : 'FAIL'}] ${label}`);
}

// ---------- 宿主替身 ----------
// 插件里用到 logger.mark/info/warn/error/debug 以及 logger.green() 等着色方法，这里补齐
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
    constructor(cfg = {}) { this.rule = cfg.rule || []; }
    setContext() { } finish() { } getContext() { return null; }
    async reply() { }
};
// 群推送替身：记录实际发出的消息，用于验证「手动添加的生日会被推送」
const GROUP_ID = '123456789';
// 官方Bot复合群ID：沙盒虚拟适配器（真实故障场景，pickGroup 返回的对象没有 getMemberMap）
const SANDBOX_GID = 'QQBotSandbox:FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF';
// 官方Bot复合群ID：配置在黑名单里，用于验证复合ID按字符串匹配（Number 会得到 NaN 导致排除失效）
const BLOCKED_GID = '3889698912:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const sentMessages = [];
const blockedMessages = [];
global.Bot = new Proxy({
    uin: 10000,
    version: { toString: () => 'v3' },
    em: { on: () => { }, off: () => { } },
    fl: new Map(),
    gl: new Map(),
    gml: new Map(),
    on: () => { },
    off: () => { },
    getGroupList: () => [SANDBOX_GID, BLOCKED_GID, GROUP_ID],
    pickGroup: (gid) => {
        // 沙盒等虚拟适配器：群对象没有 getMemberMap，直接调用会抛错
        if (gid === SANDBOX_GID) {
            return { group_name: '沙盒测试群', sendMsg: async () => ({ message_id: 0 }) };
        }
        if (gid === BLOCKED_GID) {
            return {
                is_admin: false,
                is_owner: false,
                getMemberMap: async () => new Map([['10002', {}]]),
                sendMsg: async (msg) => { blockedMessages.push(msg); return { message_id: 2 }; }
            };
        }
        return {
            is_admin: true,
            is_owner: false,
            // 群成员包含老成员 10001 与手动添加的 10002
            getMemberMap: async () => new Map([['10001', {}], ['10002', {}]]),
            sendMsg: async (msg) => { sentMessages.push(msg); return { message_id: 1 }; }
        };
    },
    pickFriend: () => ({ sendMsg: async () => ({ message_id: 1 }) })
}, { get: (t, k) => (k in t ? t[k] : () => { }) });

// ---------- 沙箱：伪造 plugins/schedule/{data,config} ----------
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-birthday-'));
const dataDir = path.join(sandbox, 'plugins/schedule/data');
const configDir = path.join(sandbox, 'plugins/schedule/config/config');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(configDir, { recursive: true });
// 关闭自定义昵称同步（避免构造期写盘），并固定推送小时
fs.writeFileSync(path.join(configDir, 'schedule.yaml'), `birthdayPushHour: 0\nbirthdayCustomName: true\nbirthdayBlacklistGroups:\n  - "${BLOCKED_GID}"\n`, 'utf8');

// 预置一条「不是今天」的生日，让 checkBirthdays 在群推送前提前 return
const today = new Date();
const pad = (n) => String(n).padStart(2, '0');
const todayMMDD = `${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
const otherMMDD = todayMMDD === '01-01' ? '12-25' : '01-01';
const seed = {
    '10001': { name: '老成员', birthday: otherMMDD, birthdayType: 'solar', isSelfSet: true, nicknameModified: false }
};
fs.writeFileSync(path.join(dataDir, 'birthdayData.json'), JSON.stringify(seed, null, 2), 'utf8');

const originCwd = process.cwd();
process.chdir(sandbox);

try {
    // chdir 之后再导入：DataManager 的数据路径才会落在沙箱里
    const { DataManager } = await import('../components/DataManager.js');
    const { BirthdayReminder } = await import('../apps/birthday.js');

    // 模拟“进程启动时创建、并持有定时任务的旧实例”
    const stale = new BirthdayReminder();
    stale.sleep = async () => { }; // 跳过推送里的 2s/1s 延时
    check('构造时从磁盘加载到初始数据', Object.keys(stale.birthdayData).length === 1 && !!stale.birthdayData['10001']);

    // 模拟管理员 #添加生日：由「另一条消息新建的实例」写入磁盘（与 addBirthday 的落盘方式一致）
    DataManager.saveBirthdayData({
        ...seed,
        '10002': { name: '手动添加的人', birthday: todayMMDD, birthdayType: 'solar', isSelfSet: false, nicknameModified: false }
    });
    check('新记录已写入磁盘', !!DataManager.loadBirthdayData()['10002']);
    check('旧实例的内存快照里还没有这条记录（复现前提）', !stale.birthdayData['10002']);

    // 定时任务到点执行（走的是旧实例）
    await stale.checkBirthdays();

    check('checkBirthdays 会重新从磁盘加载数据', !!stale.birthdayData['10002']);
    check('重载后能识别出今天过生日的人', Object.values(stale.birthdayData)
        .some(d => d.birthday === todayMMDD));
    check('手动添加的生日在不重启的情况下被推送（群内收到 @10002 的祝福）',
        sentMessages.length === 1 && JSON.stringify(sentMessages[0]).includes('10002'));
    check('缺少 getMemberMap 的虚拟适配器群被跳过，未中断后续群推送', sentMessages.length === 1);
    check('复合群ID黑名单按字符串匹配生效（黑名单群未收到推送）',
        blockedMessages.length === 0);

    // 反向校验：删除后同样生效（重载而非追加）
    DataManager.saveBirthdayData(seed);
    await stale.checkBirthdays();
    check('磁盘上删除的记录在下次执行时同步消失', !stale.birthdayData['10002']);
} finally {
    process.chdir(originCwd);
    try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { }
}

console.log(fail === 0 ? '\n全部用例通过 ✅' : `\n${fail} 个用例失败 ❌`);
process.exit(fail === 0 ? 0 : 1);

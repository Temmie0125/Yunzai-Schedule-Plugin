// 临时测试：全局群黑白名单（黑名单/白名单外的群完全静默，且不影响其他插件）
// 复现的问题：旧实现命中黑名单后会回一句“本群在黑名单内”，既刷屏又让其他功能不可用。
// 运行方式（从 Yunzai 根目录）：node plugins/schedule/test/test-group-access.js
// 隔离措施：把 process.cwd() 指向临时沙箱后再动态导入插件，绝不读写真实 data/config
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
// getContext 返回哨兵对象，用来区分“被闸门拦下（返回空对象）”与“放行（返回真实上下文）”
global.plugin = class {
    constructor(cfg = {}) {
        this.name = cfg.name;
        this.rule = cfg.rule || [];
    }
    setContext() { } finish() { }
    getContext(type, isGroup) { return { __realContext: true, type, isGroup }; }
    async reply() { }
};
global.Bot = {
    uin: 10000,
    version: { toString: () => 'v3' },
    on: () => { }, off: () => { },
    em: { on: () => { }, off: () => { } }
};

// ---------- 沙箱 ----------
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-gate-'));
const configDir = path.join(sandbox, 'plugins/schedule/config/config');
const dataDir = path.join(sandbox, 'plugins/schedule/data');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });
const configFile = path.join(configDir, 'schedule.yaml');

const BLOCKED = '123456789';
const ALLOWED = '987654321';
const OTHER = '555555555';
const OFFICIAL_GID = 'bot123:OpenIDOPENIDOPENIDOPENIDOPENID';

function writeConfig(lines) {
    fs.writeFileSync(configFile, lines.join('\n') + '\n', 'utf8');
}

const originCwd = process.cwd();
process.chdir(sandbox);

try {
    const {
        isGroupBlocked, normalizeGroupIdList, filterAccessibleGroupIds,
        invalidateGroupAccessCache, SchedulePlugin
    } = await import('../components/GroupAccess.js');

    // ===== 1. 群号列表规范化 =====
    check('群号规范化为去重字符串数组',
        JSON.stringify(normalizeGroupIdList(['1', 2, ' 3 ', '1', null, ''])) === JSON.stringify(['1', '2', '3']));
    check('非数组输入返回空数组', normalizeGroupIdList(undefined).length === 0 && normalizeGroupIdList('123').length === 0);

    // ===== 2. 黑名单：命中即静默，其他群不受影响 =====
    writeConfig([`groupBlacklist:`, `  - "${BLOCKED}"`, 'groupWhitelist: []']);
    invalidateGroupAccessCache();
    check('黑名单群被拦截', isGroupBlocked(BLOCKED) === true);
    check('未列入黑名单的群正常放行', isGroupBlocked(OTHER) === false);
    check('私聊（没有群号）永远放行', isGroupBlocked(undefined) === false && isGroupBlocked('') === false);
    check('官方Bot复合群ID按字符串匹配', (() => {
        writeConfig([`groupBlacklist:`, `  - "${OFFICIAL_GID}"`, 'groupWhitelist: []']);
        invalidateGroupAccessCache();
        return isGroupBlocked(OFFICIAL_GID) === true;
    })());

    // ===== 3. 白名单：非空时名单外一律静默（白名单优先） =====
    writeConfig([`groupBlacklist:`, `  - "${BLOCKED}"`, 'groupWhitelist:', `  - "${ALLOWED}"`]);
    invalidateGroupAccessCache();
    check('白名单内的群放行', isGroupBlocked(ALLOWED) === false);
    check('白名单外（且不在黑名单）的群被静默', isGroupBlocked(OTHER) === true);
    check('同时命中白名单与黑名单时黑名单生效（白名单优先指放行判断）', isGroupBlocked(BLOCKED) === true);
    check('filterAccessibleGroupIds 过滤掉被静默的群',
        JSON.stringify(filterAccessibleGroupIds([ALLOWED, OTHER, BLOCKED])) === JSON.stringify([ALLOWED]));

    // ===== 4. 规则闸门：拦下时不执行原方法、不产生回复 =====
    let called = 0;
    class DummyPlugin extends SchedulePlugin {
        constructor() {
            super({
                name: 'Dummy', dsc: 'x', event: 'message', priority: 1000,
                rule: [{ reg: /^#dummy$/, fnc: 'run' }, { reg: /^#dummy2$/, fnc: 'run' }]
            });
        }
        async run() { called++; return true; }
    }
    const dummy = new DummyPlugin();
    check('闸门已安装', dummy.__groupGateInstalled === true);
    check('同名 fnc 的多条规则只包装一次', dummy.rule[0].fnc === 'run' && dummy.rule[1].fnc === 'run');
    check('闸门不改写 rule.fnc（日志里仍是原方法名）', dummy.rule.every(r => r.fnc === 'run'));

    const blockedRes = await dummy.run({ group_id: BLOCKED });
    check('黑名单群内命令静默返回 false（宿主会继续交给其他插件）', blockedRes === false);
    check('黑名单群内原方法完全没执行（无数据读写、无回复）', called === 0);
    check('白名单外的群同样静默', (await dummy.run({ group_id: OTHER })) === false && called === 0);

    const allowedRes = await dummy.run({ group_id: ALLOWED });
    check('允许的群内命令正常执行', allowedRes === true && called === 1);
    const privateRes = await dummy.run({ user_id: '10001' });
    check('私聊命令正常执行', privateRes === true && called === 2);

    // ===== 5. 上下文回调同样受闸门约束 =====
    dummy.e = { group_id: BLOCKED };
    const blockedCtx = dummy.getContext();
    check('黑名单群内不接管上下文（返回空对象）',
        blockedCtx && typeof blockedCtx === 'object' && !blockedCtx.__realContext);
    dummy.e = { group_id: ALLOWED };
    const allowedCtx = dummy.getContext();
    check('允许的群内正常返回上下文', allowedCtx?.__realContext === true);

    // ===== 6. 真实命令类：黑名单群内 #清除课表 不回复、不动数据 =====
    const { ScheduleManage } = await import('../apps/manage.js');
    const manage = new ScheduleManage();
    const replied = [];
    manage.reply = async (msg) => { replied.push(msg); };
    const clearRule = manage.rule.find(r => /清除课表/.test(r.reg));
    check('manage 的规则闸门已安装', manage.__groupGateInstalled === true && !!clearRule);
    manage.e = { group_id: BLOCKED, user_id: '10001', msg: '#清除课表' };
    const r1 = await manage[clearRule.fnc](manage.e);
    check('黑名单群内 #清除课表 完全静默（无任何回复）', r1 === false && replied.length === 0);
    manage.e = { group_id: ALLOWED, user_id: '10001', msg: '#清除课表' };
    await manage[clearRule.fnc](manage.e);
    check('允许的群内 #清除课表 正常回复', replied.length === 1);

    // ===== 7. 所有 app 的插件类都必须继承闸门基类（防止以后新增命令漏装） =====
    const appsDir = path.resolve(import.meta.dirname, '..', 'apps');
    const sourceFiles = fs.readdirSync(appsDir).filter(f => f.endsWith('.js'));
    const notGated = sourceFiles.filter(file => {
        const src = fs.readFileSync(path.join(appsDir, file), 'utf8');
        return !/extends\s+SchedulePlugin/.test(src);
    });
    check(`全部 ${sourceFiles.length} 个 app 都使用 SchedulePlugin 基类${notGated.length ? `（未接入: ${notGated.join(', ')}）` : ''}`,
        notGated.length === 0);
} finally {
    process.chdir(originCwd);
    try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { }
}

console.log(fail === 0 ? '\n全部用例通过 ✅' : `\n${fail} 个用例失败 ❌`);
process.exit(fail === 0 ? 0 : 1);

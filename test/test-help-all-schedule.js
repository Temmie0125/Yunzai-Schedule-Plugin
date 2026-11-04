// 临时测试：课表帮助里的「所有人课表」权限随配置变化 + 课表可见范围轻提示
// 背景：原来「所有人在上什么课」被摆在帮助页的「管理员命令」下，且权限说明是写死的；
//       现在权限来自 Guoba 配置（allSchedulePermission），改为在群互动分组展示，
//       同时在帮助页与导入成功回复里补一条“课表可能被他群用户看到，可找 Bot 主调整”的轻提示。
// 运行方式（从 Yunzai 根目录）：node plugins/schedule/test/test-help-all-schedule.js
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
    constructor(cfg = {}) { this.rule = cfg.rule || []; }
    setContext() { } finish() { } getContext() { return null; }
    async reply() { }
};
global.Bot = { uin: 10000, version: { toString: () => 'v3' }, on: () => { }, off: () => { }, em: { on: () => { }, off: () => { } } };

// ---------- 沙箱（导入端到端用例需要真实写盘） ----------
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-help-'));
fs.mkdirSync(path.join(sandbox, 'plugins/schedule/data'), { recursive: true });
fs.mkdirSync(path.join(sandbox, 'plugins/schedule/config/config'), { recursive: true });

const originCwd = process.cwd();
process.chdir(sandbox);

try {
    const {
        describeAllSchedulePermission, buildAllScheduleHelpDesc,
        applyAllScheduleHelpInfo, appendScheduleVisibilityTip,
        SCHEDULE_VISIBILITY_TIP, SCHEDULE_VISIBILITY_TIP_SHORT, SCHEDULE_VISIBILITY_TIP_TITLE
    } = await import('../utils/privacyUtils.js');

    // ===== 1. 权限档位文案 =====
    check('owner 档位文案', describeAllSchedulePermission('owner').includes('仅 Bot 主人'));
    check('ownerAdmin 档位文案（默认）', describeAllSchedulePermission('ownerAdmin').includes('群管理员'));
    check('everyone 档位文案', describeAllSchedulePermission('everyone').includes('所有人'));
    check('非法值回落到默认档位文案',
        describeAllSchedulePermission('???') === describeAllSchedulePermission('ownerAdmin'));
    check('帮助条目文案带上当前权限',
        buildAllScheduleHelpDesc('everyone').includes('所有人') && buildAllScheduleHelpDesc('everyone').includes('#全局课表'));

    // ===== 2. 旧版布局：条目在「管理员命令」下 → 挪到「群互动」并更新权限 =====
    const legacyHelp = () => ({
        title: '课程表帮助',
        groups: [
            {
                group: '群互动', list: [
                    { icon: 1, title: '群友在上什么课', desc: '查看群友上课状态' },
                    { icon: 2, title: '#翘课 取消翘课', desc: '开启/关闭翘课模式' }
                ]
            },
            {
                group: '管理员命令', list: [
                    { icon: 1, title: '#课表(强制)更新', desc: '更新插件(需要主人权限)' },
                    { icon: 2, title: '所有人在上什么课', desc: '查看所有上课状态(需要管理员权限)' }
                ]
            }
        ]
    });
    const help = applyAllScheduleHelpInfo(legacyHelp(), { allSchedulePermission: 'owner' });
    const groups = help.groups;
    const adminGroup = groups.find(g => g.group === '管理员命令');
    const interactGroup = groups.find(g => g.group === '群互动');
    check('「所有人课表」已从管理员命令分组移出',
        !adminGroup.list.some(i => /所有人在上什么课/.test(i.title)));
    check('「所有人课表」已并入群互动分组',
        interactGroup.list.some(i => /所有人在上什么课/.test(i.title)));
    check('权限说明按配置刷新为 owner',
        interactGroup.list.find(i => /所有人在上什么课/.test(i.title)).desc.includes('仅 Bot 主人'));
    check('新增了一条「课表可见范围」提示',
        interactGroup.list.some(i => i.title === SCHEDULE_VISIBILITY_TIP_TITLE));
    check('提示文案指引联系 Bot 主调整权限',
        interactGroup.list.find(i => i.title === SCHEDULE_VISIBILITY_TIP_TITLE).desc.includes('联系 Bot 主'));
    // 重点校验：提示的是「跨群可见」（其他群用户通过 #全局课表 看到），不是本群群课表
    check('帮助提示强调“其他群的用户”看到课表',
        SCHEDULE_VISIBILITY_TIP.includes('其他群') && SCHEDULE_VISIBILITY_TIP.includes('全局课表'));
    check('导入提示强调“其他群的用户”看到课表',
        SCHEDULE_VISIBILITY_TIP_SHORT.includes('其他群') && SCHEDULE_VISIBILITY_TIP_SHORT.includes('全局课表'));

    // ===== 3. 权限切换：同一份 helpData 再处理也不重复插入 =====
    const again = applyAllScheduleHelpInfo(help, { allSchedulePermission: 'everyone' });
    const countOf = (titleRe) => again.groups
        .flatMap(g => g.list)
        .filter(i => titleRe.test(String(i.title))).length;
    check('重复处理不会产生重复的「所有人课表」条目', countOf(/所有人在上什么课/) === 1);
    check('重复处理不会产生重复的「课表可见范围」条目', countOf(new RegExp(SCHEDULE_VISIBILITY_TIP_TITLE)) === 1);
    check('权限文案随配置变化',
        again.groups.flatMap(g => g.list).find(i => /所有人在上什么课/.test(i.title)).desc.includes('所有人'));

    // ===== 4. 自定义帮助数据：没有群互动分组 → 追加到最后一组 =====
    const custom = {
        groups: [{ group: '自定义分组', list: [{ icon: 1, title: '#导入课表', desc: 'x' }] }]
    };
    applyAllScheduleHelpInfo(custom, { allSchedulePermission: 'ownerAdmin' });
    check('缺少群互动分组时新条目追加到最后一组',
        custom.groups[0].list.some(i => i.title === SCHEDULE_VISIBILITY_TIP_TITLE)
        && custom.groups[0].list.some(i => /所有人在上什么课/.test(i.title)));
    check('图标序号顺延（不与已有条目冲突）',
        custom.groups[0].list.every((item, idx, arr) => arr.findIndex(o => o.icon === item.icon) === idx));

    // ===== 5. 导入回复的轻提示：只追加一次 =====
    const once = appendScheduleVisibilityTip('✅ 课表导入成功！');
    check('导入提示追加到回复末尾', once.startsWith('✅ 课表导入成功！') && once.includes(SCHEDULE_VISIBILITY_TIP_SHORT));
    check('重复调用不会重复追加', appendScheduleVisibilityTip(once) === once);
    check('空内容不追加', appendScheduleVisibilityTip('') === '' && appendScheduleVisibilityTip(null) === null);

    // ===== 6. 端到端：JSON 导入成功的回复里确实带上了提示 =====
    const { importScheduleFromJsonData } = await import('../services/scheduleImporter.js');
    const imported = await importScheduleFromJsonData('10001', {
        tableName: '测试课表',
        semesterStart: '2026-03-02',
        courses: [{ name: '高等数学', day: 1, startTime: '08:00', endTime: '08:45', weeks: [1] }]
    }, { sender: { nickname: '喵喵' } });
    check('JSON 导入成功', imported.success === true);
    check('JSON 导入回复包含可见范围轻提示', imported.message.includes(SCHEDULE_VISIBILITY_TIP_SHORT));
} finally {
    process.chdir(originCwd);
    try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { }
}

console.log(fail === 0 ? '\n全部用例通过 ✅' : `\n${fail} 个用例失败 ❌`);
process.exit(fail === 0 ? 0 : 1);

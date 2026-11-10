// 临时测试：课表帮助里的「所有人课表」权限随配置变化 + 课表可见范围注意条
// 背景：原来「所有人在上什么课」被摆在帮助页的「管理员命令」下，且权限说明是写死的；
//       现在权限来自 Guoba 配置（allSchedulePermission），改为在群互动分组展示；
//       课表可见范围提示不再混进命令列表，而是帮助页最底部单独一条醒目底色的注意条，
//       导入成功回复里也追加一行同样的短提示。
// 运行方式（从 Yunzai 根目录）：node plugins/schedule/test/test-help-all-schedule.js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import art from 'art-template';

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
    // 可见范围提示不再混进命令列表，而是帮助页底部单独一条注意条
    check('「课表可见范围」没有混进任何命令列表',
        !groups.some(g => g.list.some(i => String(i.title).includes(SCHEDULE_VISIBILITY_TIP_TITLE))));
    check('提示写到了 helpData.visibilityTip（供帮助页底部注意条渲染）',
        help.visibilityTip?.title === SCHEDULE_VISIBILITY_TIP_TITLE
        && help.visibilityTip?.desc === SCHEDULE_VISIBILITY_TIP);
    check('提示文案指引联系 Bot 主调整权限', help.visibilityTip.desc.includes('联系 Bot 主'));
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
    check('重复处理不会让注意条叠加（仍是单个对象）',
        !Array.isArray(again.visibilityTip) && again.visibilityTip.desc === SCHEDULE_VISIBILITY_TIP);
    check('权限文案随配置变化',
        again.groups.flatMap(g => g.list).find(i => /所有人在上什么课/.test(i.title)).desc.includes('所有人'));

    // ===== 4. 自定义帮助数据（没有群互动分组）同样能拿到注意条 =====
    const custom = {
        groups: [{ group: '自定义分组', list: [{ icon: 1, title: '#导入课表', desc: 'x' }] }]
    };
    applyAllScheduleHelpInfo(custom, { allSchedulePermission: 'ownerAdmin' });
    check('缺少群互动分组时「所有人课表」追加到最后一组',
        custom.groups[0].list.some(i => /所有人在上什么课/.test(i.title)));
    check('自定义帮助数据同样带上注意条', custom.visibilityTip?.desc === SCHEDULE_VISIBILITY_TIP);
    check('图标序号顺延（不与已有条目冲突）',
        custom.groups[0].list.every((item, idx, arr) => arr.findIndex(o => o.icon === item.icon) === idx));

    // ===== 4.5 模板：注意条渲染在最底部且有醒目底色，且不混入命令表格 =====
    const tplFile = path.join(import.meta.dirname, '..', 'resources', 'template', 'help-template.html');
    const tplSrc = fs.readFileSync(tplFile, 'utf8');
    const bodyOf = (html) => html.split('<body>')[1] || '';
    const renderHelp = (extra = {}) => art(tplFile, {
        ...help, ...extra, _fontInlineUrl: 'data:,', _fontFormat: 'opentype', updateTime: 'x'
    });
    check('模板里注意条由 visibilityTip 控制显示', /\{\{if visibilityTip\}\}/.test(tplSrc));
    check('注意条使用醒目底色 + 左侧强调条',
        /\.visibility-notice\s*\{[^}]*background:\s*#FFF6E0/i.test(tplSrc)
        && /\.visibility-notice\s*\{[^}]*border-left:\s*6px\s+solid/i.test(tplSrc));
    const noticeBody = bodyOf(renderHelp());
    check('渲染结果包含注意条', noticeBody.includes('visibility-notice'));
    check('注意条只渲染一条', noticeBody.split('visibility-notice').length - 1 === 1);
    check('注意条位于所有命令分组之后（页面最底部区域）',
        noticeBody.indexOf('visibility-notice') > noticeBody.lastIndexOf('help-table'));
    check('模板里注意条写在命令分组循环之外（不与命令条目混排）',
        /\{\{\/each\}\}\s*<\/div>\s*\{\{if visibilityTip\}\}/.test(tplSrc));
    check('没有 visibilityTip 时注意条不渲染', !bodyOf(renderHelp({ visibilityTip: null })).includes('visibility-notice'));

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

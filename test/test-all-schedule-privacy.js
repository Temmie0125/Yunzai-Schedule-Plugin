// 临时测试：所有人课表的权限三档、隐藏策略三档与脱敏标记（含模板/文本降级渲染）
// 运行方式（从 Yunzai 根目录）：node plugins/schedule/test/test-all-schedule-privacy.js
global.logger = Object.assign(Object.create(console), {
    mark: console.log, info: console.log, warn: console.warn, error: console.error,
    debug: () => { }, green: (s) => s, blue: (s) => s, yellow: (s) => s, red: (s) => s
});
import fs from 'node:fs';
import path from 'node:path';
import art from 'art-template';
import {
    canUseAllSchedule, shouldHideAllScheduleInfo, applyAllSchedulePrivacy,
    normalizeAllSchedulePermission, normalizeAllSchedulePrivacy
} from '../utils/privacyUtils.js';

let fail = 0;
function check(label, cond) {
    if (!cond) fail++;
    console.log(`[${cond ? 'PASS' : 'FAIL'}] ${label}`);
}

// ========== 1. 权限三档 ==========
const owner = { isMaster: true, isGroupManager: false };
const manager = { isMaster: false, isGroupManager: true };
const normal = { isMaster: false, isGroupManager: false };
check('权限 owner：主人可用', canUseAllSchedule('owner', owner) === true);
check('权限 owner：群管理员不可用', canUseAllSchedule('owner', manager) === false);
check('权限 owner：普通成员不可用', canUseAllSchedule('owner', normal) === false);
check('权限 ownerAdmin：主人可用', canUseAllSchedule('ownerAdmin', owner) === true);
check('权限 ownerAdmin：群管理员可用', canUseAllSchedule('ownerAdmin', manager) === true);
check('权限 ownerAdmin：普通成员不可用', canUseAllSchedule('ownerAdmin', normal) === false);
check('权限 everyone：所有人都可用（含普通成员）',
    canUseAllSchedule('everyone', normal) === true
    && canUseAllSchedule('everyone', manager) === true
    && canUseAllSchedule('everyone', owner) === true);
check('权限非法值回落默认 ownerAdmin',
    normalizeAllSchedulePermission('abc') === 'ownerAdmin'
    && normalizeAllSchedulePermission(undefined) === 'ownerAdmin'
    && canUseAllSchedule('abc', normal) === false
    && canUseAllSchedule('abc', manager) === true);

// ========== 2. 隐藏策略三档 ==========
check('隐藏 everyone：主人也脱敏', shouldHideAllScheduleInfo('everyone', owner) === true);
check('隐藏 everyone：普通成员脱敏', shouldHideAllScheduleInfo('everyone', normal) === true);
check('隐藏 nonMaster：主人不脱敏', shouldHideAllScheduleInfo('nonMaster', owner) === false);
check('隐藏 nonMaster：普通成员脱敏', shouldHideAllScheduleInfo('nonMaster', normal) === true);
check('隐藏 off：所有人都不脱敏',
    shouldHideAllScheduleInfo('off', owner) === false
    && shouldHideAllScheduleInfo('off', normal) === false);
check('隐藏策略非法值回落默认 nonMaster',
    normalizeAllSchedulePrivacy('nope') === 'nonMaster'
    && shouldHideAllScheduleInfo('nope', normal) === true
    && shouldHideAllScheduleInfo('nope', owner) === false);

// ========== 3. 脱敏标记 ==========
const members = [
    { userId: '10001', nickname: '本群成员' },
    { userId: '10002', nickname: '别的群的人' },
    { userId: 10003, nickname: '数字ID' }
];
const groupIds = new Set(['10001', '10003']);

const offResult = applyAllSchedulePrivacy(members, { hide: false, memberIds: groupIds });
check('不脱敏：所有标记为 false',
    offResult.every(m => m.blurAvatar === false && m.blurNickname === false && m.hideLocation === false));
check('不脱敏：不修改原数组', members[0].blurAvatar === undefined);

const onResult = applyAllSchedulePrivacy(members, { hide: true, memberIds: groupIds });
check('脱敏：头像一律模糊', onResult.every(m => m.blurAvatar === true));
check('脱敏：教室一律隐藏', onResult.every(m => m.hideLocation === true));
check('脱敏：本群成员昵称不模糊', onResult[0].blurNickname === false && onResult[2].blurNickname === false);
check('脱敏：非本群成员昵称模糊', onResult[1].blurNickname === true);
check('脱敏：返回浅拷贝，不污染入参', members[1].blurNickname === undefined);

// 拿不到成员列表（私聊 / 官方Bot缓存为空）→ 全部按非本群处理
for (const [label, ids] of [['null', null], ['空 Set', new Set()], ['undefined', undefined]]) {
    const r = applyAllSchedulePrivacy(members, { hide: true, memberIds: ids });
    check(`拿不到成员列表（${label}）：昵称全部模糊`, r.every(m => m.blurNickname === true));
}

// ========== 4. 模板渲染：模糊与教室占位 ==========
const tplFile = path.join(import.meta.dirname, '..', 'resources', 'template', 'schedule-template.html');
const tplSrc = fs.readFileSync(tplFile, 'utf8');
const baseMember = {
    userId: '10002', avatar: 'data:,', signature: '', skipStatus: false,
    hasSemesterStart: true, currentWeek: 5, nickname: '别的群的人', status: '上课中',
    remainingTime: '40分钟', currentCourse: { name: '高等数学', location: '107', startTime: '10:00', endTime: '11:40' },
    avatarBorderMode: 'off'
};
const renderCard = (extra = {}) => art(tplFile, {
    weekday: '四', currentTime: '10:30', updateTime: 'x', columns: 2, canvasWidth: 1080,
    totalMembers: 1, studyingCount: 1, skippingCount: 0,
    members: [{ ...baseMember, ...extra }], _fontInlineUrl: 'data:,', _fontFormat: 'opentype'
});

// 断言只看 <body>：类名同样出现在 <style> 中，不能直接把整页 HTML 当判断依据
const bodyOf = (html) => html.split('<body>')[1] || html;
const plain = renderCard();
check('未脱敏：头像/昵称无模糊类、教室行不带隐藏类',
    !bodyOf(plain).includes('avatar-blur') && !bodyOf(plain).includes('name-blur') && !bodyOf(plain).includes('loc-hidden'));

const masked = renderCard({ blurAvatar: true, blurNickname: true, hideLocation: true });
check('脱敏：头像带 avatar-blur', bodyOf(masked).includes('class="avatar-blur"'));
check('脱敏：昵称带 name-blur', bodyOf(masked).includes('name-blur'));
check('脱敏：教室行带 loc-hidden', bodyOf(masked).includes('loc-hidden'));
check('样式表定义了模糊与占位隐藏',
    /\.avatar-blur\s*\{[^}]*blur\(8px\)/.test(tplSrc)
    && /\.name-blur\s*\{[^}]*blur\(4px\)/.test(tplSrc)
    && /\.loc-hidden\s*\{[^}]*visibility:\s*hidden/.test(tplSrc));
// 教室只是“不可见”，DOM 仍在（保证卡片高度不变）
check('教室隐藏采用 visibility 占位而非移除节点',
    bodyOf(masked).includes('loc-hidden') && bodyOf(masked).includes('location-text'));

// ========== 5. 文本降级：文本无法模糊，改用 *** 并去掉地点行 ==========
// 注意：generateTextSchedule 返回的是「行数组」，需先拼成字符串再断言
const { generateTextSchedule } = await import('../components/Renderer.js');
const toText = (result) => (Array.isArray(result) ? result.join('\n') : String(result));
const maskedText = toText(generateTextSchedule([{ ...baseMember, blurNickname: true, hideLocation: true }], 5, 4));
check('文本降级：非本群昵称以 *** 代替', maskedText.includes('***') && !maskedText.includes('别的群的人'));
check('文本降级：隐藏教室时不输出地点行', !maskedText.includes('地点:'));
const plainText = toText(generateTextSchedule([baseMember], 5, 4));
check('文本降级：未脱敏时保留昵称与地点',
    plainText.includes('别的群的人') && plainText.includes('地点: 107'));

console.log(fail === 0 ? '\n全部用例通过 ✅' : `\n${fail} 个用例失败 ❌`);
process.exit(fail === 0 ? 0 : 1);

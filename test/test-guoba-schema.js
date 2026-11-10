// 临时测试：Guoba 配置项分组归属（全局群黑白名单应位于「课表模块设置」下）
// 运行方式（从 Yunzai 根目录）：node plugins/schedule/test/test-guoba-schema.js
// 说明：日历同步相关配置项只在含该功能的开发分支上存在，这里按「存在才校验」处理，
//       让同一份测试能在各分支通用
import fs from 'node:fs';
import path from 'node:path';

let fail = 0;
function check(label, cond) {
    if (!cond) fail++;
    console.log(`[${cond ? 'PASS' : 'FAIL'}] ${label}`);
}

const pluginRoot = path.resolve(import.meta.dirname, '..');
const { schemas } = await import('../guoba/schemas/index.js');

// ---------- 工具 ----------
const groupStarts = new Map();
schemas.forEach((item, index) => {
    if (item.component === 'SOFT_GROUP_BEGIN') groupStarts.set(item.label, index);
});
/** 字段所属分组：取它之前最近的 SOFT_GROUP_BEGIN */
function groupOf(field) {
    const index = schemas.findIndex(item => item.field === field);
    if (index === -1) return null;
    let owner = null;
    for (const [label, start] of groupStarts) {
        if (start < index && (owner === null || start > owner.start)) owner = { label, start };
    }
    return owner?.label || null;
}
const hasField = (field) => schemas.some(item => item.field === field);

// ===== 1. 分组结构 =====
check('至少有三个配置分组', groupStarts.size >= 3);
check('前三个分组顺序为 全局设置 → 课表模块设置 → 生日模块设置',
    [...groupStarts.keys()].slice(0, 3).join(',') === '全局设置,课表模块设置,生日模块设置');
check('每组的起始下标递增',
    [...groupStarts.values()].every((v, i, arr) => i === 0 || v > arr[i - 1]));
if (hasField('updateBranch')) {
    check('更新分支属于「全局设置」', groupOf('updateBranch') === '全局设置');
} else {
    check('当前分支没有 updateBranch 配置（跳过相关校验）', true);
}

// ===== 2. 全局群黑白名单归入「课表模块设置」 =====
check('白名单群字段存在于「课表模块设置」分组', groupOf('groupWhitelist') === '课表模块设置');
check('黑名单群字段存在于「课表模块设置」分组', groupOf('groupBlacklist') === '课表模块设置');
check('群黑白名单不再出现在生日分组下',
    groupOf('groupWhitelist') !== '生日模块设置' && groupOf('groupBlacklist') !== '生日模块设置');
check('群黑白名单排在生日模块之前',
    schemas.findIndex(item => item.field === 'groupWhitelist') < groupStarts.get('生日模块设置'));
check('群黑白名单排在课表模块起始之后',
    schemas.findIndex(item => item.field === 'groupWhitelist') > groupStarts.get('课表模块设置'));

// ===== 3. 日历同步（仅含该功能的分支）同样归入「课表模块设置」 =====
const calendarFields = ['calendarSyncEnabled', 'calendarSyncInterval', 'calendarSyncDaysBefore',
    'calendarSyncDaysAfter', 'calendarMaxEvents', 'calendarAllowPrivateHost'];
const existingCalendarFields = calendarFields.filter(hasField);
if (existingCalendarFields.length === 0) {
    check('当前分支没有日历同步配置（跳过相关校验）', true);
} else {
    for (const field of existingCalendarFields) {
        check(`日历同步配置 ${field} 位于「课表模块设置」`, groupOf(field) === '课表模块设置');
    }
}

// ===== 4. 生日自己的群名单仍留在生日分组 =====
check('生日白名单群仍在「生日模块设置」', groupOf('birthdayWhitelistGroups') === '生日模块设置');
check('生日黑名单群仍在「生日模块设置」', groupOf('birthdayBlacklistGroups') === '生日模块设置');

// ===== 5. 没有重复/残缺配置项 =====
const fields = schemas.filter(item => item.field).map(item => item.field);
check('配置项没有重复定义', new Set(fields).size === fields.length);
check('每个配置项都有 label 与 component',
    schemas.filter(item => item.field).every(item => typeof item.label === 'string' && !!item.component));
const notInGroup = fields.filter(field => groupOf(field) === null);
check('所有配置项都归属某个分组', notInGroup.length === 0);

// ===== 6. 默认配置与 schema 字段对得上 =====
const defaultYaml = fs.readFileSync(path.join(pluginRoot, 'config/default_config/schedule.yaml'), 'utf8');
const expectedDefaultKeys = ['groupWhitelist', 'groupBlacklist', ...existingCalendarFields];
if (hasField('updateBranch')) expectedDefaultKeys.push('updateBranch');
for (const field of expectedDefaultKeys) {
    check(`默认配置里有 ${field}`, new RegExp(`^${field}:`, 'm').test(defaultYaml));
}

console.log(fail === 0 ? '\n全部用例通过 ✅' : `\n${fail} 个用例失败 ❌`);
process.exit(fail === 0 ? 0 : 1);

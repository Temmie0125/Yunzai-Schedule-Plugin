// 临时测试：插件模块结构冒烟测试
// 1) 所有 apps/ 与 components/、services/、utils/ 模块可正常导入（无缺失依赖/语法错误）
// 2) 每个命令规则的 fnc 都能在插件类上找到对应方法（防止改命令时漏改 fnc 名称）
// 运行方式（从 Yunzai 根目录）：node plugins/schedule/test/test-module-smoke.js
global.logger = console; // 插件代码依赖 Yunzai 全局 logger，此处用 console 代替

// 极简宿主替身：真实 Yunzai 的 plugin 基类会把配置挂到 this 上，这里保留 rule 以便校验 fnc
const BasePlugin = class {
    constructor(cfg = {}) {
        this.name = cfg.name;
        this.dsc = cfg.dsc;
        this.event = cfg.event;
        this.priority = cfg.priority;
        this.rule = cfg.rule || [];
    }
    setContext() { }
    finish() { }
    getContext() { return null; }
    async reply() { }
};
global.plugin = BasePlugin;
// Bot 事件/适配器方法在部分插件构造函数中被调用，这里提供最小实现
global.Bot = {
    uin: 10000,
    version: { toString: () => 'v3' },
    on: () => { },
    off: () => { },
    em: { on: () => { }, off: () => { } }
};

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
let fail = 0;
function check(label, cond) {
    if (!cond) fail++;
    console.log(`[${cond ? 'PASS' : 'FAIL'}] ${label}`);
}

// ========== 1. 模块可导入性 ==========
const dirs = ['apps', 'components', 'services', 'utils'];
const imported = [];
for (const dir of dirs) {
    const dirPath = path.join(root, dir);
    for (const file of fs.readdirSync(dirPath).filter(f => f.endsWith('.js'))) {
        const target = pathToFileURL(path.join(dirPath, file)).href;
        try {
            const mod = await import(target);
            imported.push({ dir, file, mod });
            check(`模块可导入：${dir}/${file}`, true);
        } catch (err) {
            check(`模块可导入：${dir}/${file}（${err.message}）`, false);
        }
    }
}

// ========== 2. 规则的 fnc 必须存在 ==========
let ruleCount = 0;
for (const { dir, file, mod } of imported) {
    if (dir !== 'apps') continue;
    const classes = [
        ...Object.entries(mod).filter(([, v]) => typeof v === 'function' && v !== BasePlugin),
        ...(typeof mod.default === 'function' ? [['default', mod.default]] : [])
    ];
    for (const [exportName, Cls] of classes) {
        let instance;
        try {
            instance = new Cls();
        } catch (err) {
            check(`可实例化：${file} → ${exportName}（${err.message}）`, false);
            continue;
        }
        if (!Array.isArray(instance.rule) || instance.rule.length === 0) continue;
        const missing = instance.rule
            .filter(r => typeof r.fnc === 'string' && typeof instance[r.fnc] !== 'function')
            .map(r => r.fnc);
        ruleCount += instance.rule.length;
        check(`${file} → ${exportName} 的 ${instance.rule.length} 条规则 fnc 均存在${missing.length ? `（缺失: ${missing.join(', ')}）` : ''}`,
            missing.length === 0);
    }
}
check(`共校验 ${ruleCount} 条命令规则`, ruleCount > 0);

// ========== 3. 合并后的导入入口回归 ==========
const manageMod = imported.find(m => m.file === 'manage.js')?.mod;
const Manage = manageMod?.ScheduleManage || manageMod?.default;
if (Manage) {
    const inst = new Manage();
    const importRules = inst.rule.filter(r => /导入课表/.test(r.reg));
    check('统一导入入口规则存在', importRules.some(r => r.fnc === 'importSchedule'));
    check('直链教程规则仍独立存在', importRules.some(r => r.fnc === 'showUrlImportGuide'));
    check('旧命令不再作为导入入口（无规则把 #设置课表 交给导入逻辑）',
        !inst.rule.some(r => /设置课表|设置星链课表|星链设置课表/.test(r.reg)
            && ['importSchedule', 'handleDirectCode', 'handleStarlinkDirect'].includes(r.fnc)));
    check('旧命令迁移提示规则存在', inst.rule.some(r => r.fnc === 'replyImportCommandMoved'));
    check('迁移提示方法存在', typeof inst.replyImportCommandMoved === 'function');
    check('旧口令上下文方法已删除（waitingForCode/waitingForStarlinkCode）',
        typeof inst.waitingForCode !== 'function' && typeof inst.waitingForStarlinkCode !== 'function');
    check('统一等待上下文方法存在', typeof inst.waitingForScheduleImport === 'function');
    check('统一文件导入实现存在（供上下文与文件监听复用）', typeof inst.handleScheduleFileImport === 'function');
    // 迁移提示规则必须排在被动口令监听之前，否则旧命令消息会被被动监听直接导入
    const movedIdx = inst.rule.findIndex(r => r.fnc === 'replyImportCommandMoved');
    const directIdx = inst.rule.findIndex(r => r.fnc === 'handleDirectCode');
    check('迁移提示规则排在口令被动监听之前', movedIdx !== -1 && directIdx !== -1 && movedIdx < directIdx);
    const movedRule = inst.rule[movedIdx];
    check('迁移提示规则匹配 #设置课表', new RegExp(movedRule.reg).test('#设置课表'));
    check('迁移提示规则匹配 #设置课表 <口令>', new RegExp(movedRule.reg).test('#设置课表 「ABCDEFGHIJKLMNOPQRSTUVWX12345678」'));
    check('迁移提示规则匹配 #星链设置课表', new RegExp(movedRule.reg).test('#星链设置课表 ABCDE'));
    check('迁移提示规则匹配 #schedule set', new RegExp(movedRule.reg).test('#schedule set 1234567890'));
    check('迁移提示规则不吞 #设置学期开始', !new RegExp(movedRule.reg).test('#设置学期开始 2026-03-02'));
    check('迁移提示规则不吞 #课表设置昵称', !new RegExp(movedRule.reg).test('#课表设置昵称 小明'));
    // 命令正则自检：#导入课表 命中通用规则，#导入课表直链教程 不会被通用规则吞掉
    const generic = importRules.find(r => r.fnc === 'importSchedule');
    check('通用规则匹配 #导入课表', new RegExp(generic.reg).test('#导入课表'));
    check('通用规则匹配 #导入课表 <直链>', new RegExp(generic.reg).test('#导入课表 https://example.com/a.json'));
    check('通用规则不吞 #导入课表直链教程', !new RegExp(generic.reg).test('#导入课表直链教程'));
    // 多行 JSON 文本：规则需允许参数跨行，否则粘贴的课表 JSON 无法触发命令
    const multiLineJson = '#导入课表 {\n  "courses": [\n    { "name": "高等数学" }\n  ]\n}';
    check('通用规则匹配多行 JSON 文本', new RegExp(generic.reg).test(multiLineJson));
    const multiLineArg = multiLineJson.match(new RegExp(generic.reg))?.[1];
    check('多行 JSON 文本参数被完整捕获（未截断）',
        typeof multiLineArg === 'string' && multiLineArg.includes('"name": "高等数学"') && multiLineArg.trim().endsWith('}'));
    const guide = importRules.find(r => r.fnc === 'showUrlImportGuide');
    check('教程规则匹配 #导入课表直链教程', new RegExp(guide.reg).test('#导入课表直链教程'));
}

console.log(fail === 0 ? '\n全部用例通过 ✅' : `\n${fail} 个用例失败 ❌`);
process.exit(fail === 0 ? 0 : 1);

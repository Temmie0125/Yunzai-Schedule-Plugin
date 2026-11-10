// 临时测试：#课表更新 的「更新分支」配置（分支名校验 / 远端选择 / 命令生成 / 配置与锅巴字段）
// 运行方式（从 Yunzai 根目录）：node plugins/schedule/test/test-update-branch.js
// 说明：本测试不切换工作目录、不执行任何写操作（不改配置、不跑 git 写命令），
//       只验证纯函数 + 配置默认值 + 源码里的白名单/锅巴字段
import fs from 'node:fs';
import path from 'node:path';

let fail = 0;
function check(label, cond) {
    if (!cond) fail++;
    console.log(`[${cond ? 'PASS' : 'FAIL'}] ${label}`);
}

// ---------- 宿主替身（apps/update.js 用到全局 plugin / logger） ----------
global.logger = Object.assign(Object.create(console), {
    mark: () => { }, info: () => { }, warn: () => { }, error: () => { },
    debug: () => { }, green: (s) => s, blue: (s) => s, yellow: (s) => s, red: (s) => s
});
global.plugin = class {
    constructor(cfg = {}) { this.name = cfg.name; this.rule = cfg.rule || []; }
    setContext() { } finish() { } getContext() { return null; }
    async reply() { }
};
global.Bot = { uin: 10000, version: { toString: () => 'v3' }, on: () => { }, off: () => { }, em: { on: () => { }, off: () => { } } };

const pluginRoot = path.resolve(import.meta.dirname, '..');

const { normalizeBranchName, pickRemote, buildUpdateCommands } = await import('../utils/updateBranch.js');
const { ScheduleUpdate } = await import('../apps/update.js');
const { ConfigManager } = await import('../components/ConfigManager.js');

// ===== 1. 分支名校验（防 shell 注入）=====
check('普通分支名通过校验', normalizeBranchName('main') === 'main');
check('驼峰分支名通过校验', normalizeBranchName('EchoDev') === 'EchoDev');
check('带斜杠/点的分支名通过校验', normalizeBranchName('feature/foo-1.2') === 'feature/foo-1.2');
check('空值返回空串', normalizeBranchName('') === '' && normalizeBranchName(undefined) === '');
check('含空格的非法名被拒绝', normalizeBranchName('a b') === '');
check('注入类字符串被拒绝', normalizeBranchName('main; rm -rf /') === '' && normalizeBranchName('a&&b') === '');
check('反引号被拒绝', normalizeBranchName('`whoami`') === '');

// ===== 2. 远端选择（兼容只配了 github 的仓库）=====
check('只有 github 时选 github', pickRemote(['github']) === 'github');
check('同时存在时优先 origin', pickRemote(['github', 'origin']) === 'origin');
check('指定远端优先', pickRemote(['origin', 'github'], 'github') === 'github');
check('指定远端不存在时回退', pickRemote(['upstream'], 'origin') === 'upstream');
check('没有远端返回空串', pickRemote([]) === '' && pickRemote(null) === '');

// ===== 3. 命令生成 =====
const force = buildUpdateCommands({ repoPath: '/repo', remote: 'github', branch: 'MoistDev', isForce: true });
check('强制更新包含 fetch', force[0].includes('fetch --all --prune'));
check('强制更新会 checkout -B 到目标分支',
    force.some(cmd => cmd.includes('checkout -B MoistDev github/MoistDev')));
check('强制更新 reset 到指定远端分支',
    force.some(cmd => cmd.includes('reset --hard github/MoistDev')));
check('强制更新清理未跟踪文件', force.some(cmd => cmd.includes('clean -fd')));
check('强制更新不再硬编码 origin', force.every(cmd => !cmd.includes('origin/')));
const normal = buildUpdateCommands({ repoPath: '/repo', remote: 'github', branch: 'EchoDev', isForce: false });
check('普通更新先 fetch', normal[0].includes('fetch --all --prune'));
check('普通更新会切到目标分支', normal.some(cmd => cmd.includes('checkout EchoDev')));
check('普通更新用指定远端分支 pull',
    normal.some(cmd => cmd.includes('pull --no-rebase github EchoDev')));
check('普通更新不包含 reset --hard', normal.every(cmd => !cmd.includes('reset --hard')));
check('命令都带上仓库路径', [...force, ...normal].every(cmd => cmd.includes('-C "/repo"')));

// ===== 4. 配置默认值（只读，不写真实配置）=====
check('默认 updateBranch 为空（跟随当前分支）', ConfigManager.getConfig().updateBranch === '');

// ===== 5. 配置白名单 + 锅巴字段 + 默认配置（源码级检查）=====
const configSrc = fs.readFileSync(path.join(pluginRoot, 'components/ConfigManager.js'), 'utf8');
check('ConfigManager 默认值里有 updateBranch', /updateBranch:\s*""/.test(configSrc));
check('setConfig 的保存白名单包含 updateBranch',
    /const configToSave = \{[\s\S]*?updateBranch[\s\S]*?\};/.test(configSrc));
const updateSrc = fs.readFileSync(path.join(pluginRoot, 'apps/update.js'), 'utf8');
check('更新逻辑使用配置里的分支', /config\.updateBranch/.test(updateSrc));
check('更新逻辑使用自动识别的远端', /pickRemote\(await this\.listRemotes\(\)\)/.test(updateSrc));
check('apps/update.js 不再自行导出工具函数（避免被宿主当成插件类）',
    !/^export function/m.test(updateSrc));
const schemaSrc = fs.readFileSync(path.join(pluginRoot, 'guoba/schemas/index.js'), 'utf8');
check('Guoba schema 含「更新分支」字段',
    /field:\s*"updateBranch"/.test(schemaSrc) && /更新分支/.test(schemaSrc));
check('Guoba 里说明留空 = 跟随当前分支', /跟随当前分支/.test(schemaSrc));
const defaultYaml = fs.readFileSync(path.join(pluginRoot, 'config/default_config/schedule.yaml'), 'utf8');
check('默认配置里带 updateBranch', /^updateBranch:\s*""/m.test(defaultYaml));

// ===== 6. 命令入口的保护逻辑（不执行 git 写操作）=====
const inst = new ScheduleUpdate();
const replies = [];
inst.reply = async (text) => { replies.push(String(text)); };
inst.e = { isMaster: false, msg: '#课表更新' };
await inst.update();
check('非主人执行更新被拒绝', replies[replies.length - 1].includes('只有主人'));
const remotes = await inst.listRemotes();
check('能只读地读取 git 远端列表', Array.isArray(remotes));
check('远端列表非空时能选出可用远端', remotes.length === 0 || pickRemote(remotes) !== '');

console.log(fail === 0 ? '\n全部用例通过 ✅' : `\n${fail} 个用例失败 ❌`);
process.exit(fail === 0 ? 0 : 1);

//import { plugin } from '../../../lib/plugins/plugin.js'
import { Restart } from '../../other/restart.js'
import { exec } from 'child_process'
import fs from 'fs'
import path from 'path'
import common from '../../../lib/common/common.js'

const PLUGIN_PATH = path.join(process.cwd(), 'plugins/schedule')
let uping = false

export class ScheduleUpdate extends plugin {
    constructor() {
        super({
            name: '[Schedule] 课程表插件更新',
            dsc: '更新课程表插件',
            event: 'message',
            priority: 1000,
            rule: [
                {
                    reg: '^#(课表)(强制)?更新$',
                    fnc: 'update'
                }
            ]
        })
    }

    async update() {
        if (!this.e.isMaster) {
            await this.reply('只有主人才能执行更新操作')
            return false
        }

        if (uping) {
            await this.reply('已有更新任务正在进行中，请稍后...')
            return true
        }

        // 检查 git 是否安装
        const hasGit = await this.checkGit()
        if (!hasGit) {
            await this.reply('未检测到 git，请先安装 git')
            return false
        }

        // 检查插件目录是否为 git 仓库
        if (!fs.existsSync(path.join(PLUGIN_PATH, '.git'))) {
            await this.reply('插件目录不是 git 仓库，无法通过 git 更新，请手动更新')
            return false
        }


        const isForce = this.e.msg.includes('强制')

        uping = true
        try {
            await this.runUpdate(isForce)
        } catch (err) {
            logger.error(`课程表插件更新失败: ${err}`)
            await this.reply(`更新失败: ${err.message}`)
        } finally {
            uping = false
        }
        return true
    }

    async runUpdate(isForce) {
        await this.ensureGitignore();

        // 1. 保存旧版 package.json
        const oldPkg = await this.getPackageJsonContent();

        const branch = await this.getCurrentBranch();
        const repoPath = PLUGIN_PATH;

        let command;
        if (isForce) {
            command = [
                `git -C "${repoPath}" fetch --all --prune`,
                `git -C "${repoPath}" reset --hard origin/${branch}`,
                `git -C "${repoPath}" clean -fd`
            ].join(' && ');
            await this.reply('开始强制更新，将丢弃所有本地修改...');
        } else {
            command = `git -C "${repoPath}" pull --no-rebase`;
            await this.reply('开始更新课程表插件...');
        }

        const oldCommit = await this.getCommitId();
        const { error, stdout, stderr } = await this.execAsync(command);

        if (error) {
            logger.error(`git 命令执行失败: ${error}`);
            await this.handleGitError(error, stdout, stderr);
            return false;
        }

        if (/(Already up[ -]to[ -]date|已经是最新的)/.test(stdout)) {
            await this.reply('课程表插件已经是最新版本');
            return true;
        }

        // 2. 获取新版 package.json
        const newPkg = await this.getPackageJsonContent();
        const depsChanged = this.isDependenciesChanged(oldPkg, newPkg);

        // 3. 获取更新日志
        const logs = await this.getUpdateLogs(oldCommit);
        if (logs && logs.length > 0) {
            await this.reply(await common.makeForwardMsg(this.e, logs, '课程表插件更新日志'));
        } else {
            await this.reply('课程表插件更新完成');
        }

        // 4. 依赖变化处理
        if (depsChanged) {
            await this.reply(
                '⚠️ 检测到插件依赖项发生变化，' +
                '必须安装新依赖才能正常运行。是否立即自动运行 `pnpm install` ？(回复 y/n)'
            );
            this.setContext('waitForInstallDeps');
            // 保存后续重启所需的标志
            this.pluginUpdateContext = { shouldRestartAfterInstall: true };
            return true;
        }

        // 5. 无依赖变化，直接询问重启
        await this.reply('更新完成，是否现在重启 Yunzai 以应用更新？(回复 y/n)');
        this.setContext('waitRestart');
        return true;
    }

    // 处理用户确认安装依赖
    async waitForInstallDeps() {
        const reply = this.e.msg.trim().toLowerCase();
        this.finish('waitForInstallDeps');
        if (reply !== 'y' && reply !== 'yes' && reply !== '是') {
            await this.reply('已取消自动安装依赖。请稍后手动在插件目录运行 `pnpm install` 并重启 Bot。');
            return true;
        }

        await this.reply('正在安装依赖，可能需要几分钟，请稍候...');
        const installCmd = `cd "${PLUGIN_PATH}" && pnpm install`;
        const { error, stdout, stderr } = await this.execAsync(installCmd);
        if (error) {
            logger.error(`依赖安装失败: ${error}`);
            await this.reply(`依赖安装失败：${error.message}\n请手动进入插件目录运行 pnpm install 并重启 Bot。`);
            return true;
        }
        await this.reply('依赖安装成功！');

        // 安装完成后询问重启
        await this.reply('依赖已更新，是否现在重启 Yunzai 以应用更新？(回复 y/n)');
        this.setContext('waitRestart');
        return true;
    }

    // 读取 package.json 内容（返回对象）
    async getPackageJsonContent() {
        const pkgPath = path.join(PLUGIN_PATH, 'package.json');
        if (!fs.existsSync(pkgPath)) return { dependencies: {} };
        const content = await fs.promises.readFile(pkgPath, 'utf8');
        try {
            return JSON.parse(content);
        } catch {
            return { dependencies: {} };
        }
    }

    // 比较 dependencies 是否有变化
    isDependenciesChanged(oldPkg, newPkg) {
        const oldDeps = oldPkg.dependencies || {};
        const newDeps = newPkg.dependencies || {};
        const oldDevDeps = oldPkg.devDependencies || {};
        const newDevDeps = newPkg.devDependencies || {};

        // 合并所有依赖名
        const allKeys = new Set([...Object.keys(oldDeps), ...Object.keys(newDeps), ...Object.keys(oldDevDeps), ...Object.keys(newDevDeps)]);
        for (const key of allKeys) {
            const oldVer = oldDeps[key] || oldDevDeps[key];
            const newVer = newDeps[key] || newDevDeps[key];
            if (oldVer !== newVer) return true;
        }
        return false;
    }

    async waitRestart() {
        const msg = this.e.msg.trim().toLowerCase()
        this.finish('waitRestart')
        if (msg === 'y' || msg === 'yes' || msg === '是') {
            await this.reply('正在重启...')
            new Restart(this.e).restart()
        } else {
            await this.reply('已取消重启，请稍后手动重启')
        }
        return true
    }

    // 获取当前分支名
    async getCurrentBranch() {
        const cmd = `git -C "${PLUGIN_PATH}" symbolic-ref --short HEAD`
        const { stdout, error } = await this.execAsync(cmd)
        if (error) return 'main'  // 默认分支
        return stdout.trim()
    }

    // 获取当前 commit id
    async getCommitId() {
        const cmd = `git -C "${PLUGIN_PATH}" rev-parse --short HEAD`
        try {
            const { stdout } = await this.execAsync(cmd)
            return stdout.trim()
        } catch {
            return null
        }
    }

    // 获取从 oldCommit 到最新的提交日志
    async getUpdateLogs(oldCommit) {
        if (!oldCommit) return []
        const cmd = `git -C "${PLUGIN_PATH}" log --pretty=format:"%h %s" ${oldCommit}..HEAD`
        const { stdout } = await this.execAsync(cmd)
        if (!stdout) return []
        const lines = stdout.split('\n').filter(line => line.trim())
        // 过滤 merge 提交（可选）
        return lines.filter(line => !line.includes('Merge branch'))
    }

    // 异步执行命令
    execAsync(cmd) {
        return new Promise(resolve => {
            exec(cmd, { windowsHide: true, cwd: process.cwd() }, (error, stdout, stderr) => {
                resolve({ error, stdout, stderr })
            })
        })
    }

    // 检查 git 是否可用
    async checkGit() {
        const { error } = await this.execAsync('git --version')
        return !error
    }

    // 处理 git 错误
    async handleGitError(error, stdout, stderr) {
        let msg = '更新失败'
        if (error.message.includes('Timed out')) {
            msg += '：连接超时'
        } else if (error.message.includes('Failed to connect') || error.message.includes('unable to access')) {
            msg += '：网络连接失败'
        } else if (stdout.includes('CONFLICT') || error.message.includes('be overwritten by merge')) {
            msg += '：存在冲突，请先解决冲突或使用强制更新'
        } else {
            msg += `：${error.message}`
        }
        await this.reply(msg)
    }
    // 确保 .gitignore 包含必要的忽略规则
    async ensureGitignore() {
        const gitignorePath = path.join(PLUGIN_PATH, '.gitignore');
        let content = '';
        if (fs.existsSync(gitignorePath)) {
            content = fs.readFileSync(gitignorePath, 'utf8');
        }
        const rules = ['data/', 'config/'];   // 必须忽略的目录
        let needUpdate = false;
        for (const rule of rules) {
            // 检查每一条规则是否存在（简单包含判断）
            if (!content.includes(rule)) {
                content += (content.endsWith('\n') ? '' : '\n') + rule + '\n';
                needUpdate = true;
            }
        }
        if (needUpdate) {
            fs.writeFileSync(gitignorePath, content, 'utf8');
            logger.info('[课程表插件] 已更新 .gitignore，添加 data/ 和 config/ 忽略规则');
        }
    }
}
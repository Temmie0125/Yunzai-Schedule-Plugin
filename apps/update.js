import { plugin } from '../../../lib/plugins/plugin.js'
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
            name: '课程表插件更新',
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
        await this.ensureGitignore();   // <--- 新增
        const branch = await this.getCurrentBranch()
        const repoPath = PLUGIN_PATH

        let command
        if (isForce) {
            command = [
                `git -C "${repoPath}" fetch --all --prune`,
                `git -C "${repoPath}" reset --hard origin/${branch}`,
                `git -C "${repoPath}" clean -fd`
            ].join(' && ')
            await this.reply('开始强制更新，将丢弃所有本地修改...')
        } else {
            command = `git -C "${repoPath}" pull --no-rebase`
            await this.reply('开始更新课程表插件...')
        }

        const oldCommit = await this.getCommitId()
        const { error, stdout, stderr } = await this.execAsync(command)

        if (error) {
            logger.error(`git 命令执行失败: ${error}`)
            await this.handleGitError(error, stdout, stderr)
            return false
        }

        // 检查是否已是最新
        if (/(Already up[ -]to[ -]date|已经是最新的)/.test(stdout)) {
            await this.reply('课程表插件已经是最新版本')
            return true
        }

        // 获取更新日志
        const logs = await this.getUpdateLogs(oldCommit)
        if (logs && logs.length > 0) {
            await this.reply(await common.makeForwardMsg(this.e, logs, '课程表插件更新日志'))
        } else {
            await this.reply('课程表插件更新完成')
        }

        // 询问是否重启
        await this.reply('更新完成，是否现在重启 Yunzai 以应用更新？(回复 y/n)')
        this.setContext('waitRestart')
        return true
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
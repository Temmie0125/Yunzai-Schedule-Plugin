// utils/updateBranch.js
// 「#课表更新」的分支/远端处理纯函数（便于单测，也避免污染 apps/ 的导出——
// apps 下的模块导出必须只有插件类，否则宿主加载器会把导出的函数当成插件类实例化）

/**
 * 校验分支名（防止把任意字符串拼进 shell 命令）
 * @param {*} value
 * @returns {string} 合法分支名；非法或为空返回空串
 */
export function normalizeBranchName(value) {
    const name = String(value ?? '').trim()
    if (!name) return ''
    return /^[\w./-]+$/.test(name) ? name : ''
}

/**
 * 从远端列表里挑一个可用的远端：优先指定的，其次 origin，最后第一个
 * @param {string[]} remoteNames `git remote` 的输出
 * @param {string} [preferred] 指定远端名（可选）
 * @returns {string} 远端名；没有远端返回空串
 */
export function pickRemote(remoteNames, preferred = '') {
    const list = (Array.isArray(remoteNames) ? remoteNames : [])
        .map(name => String(name || '').trim())
        .filter(Boolean)
    const want = String(preferred || '').trim()
    if (want && list.includes(want)) return want
    if (list.includes('origin')) return 'origin'
    return list[0] || ''
}

/**
 * 生成更新用的 git 命令序列
 * - 强制：fetch → checkout -B（切到目标分支并丢弃本地提交/改动）→ reset --hard → clean -fd
 * - 普通：fetch → checkout（切到目标分支）→ pull 指定远端分支
 * @param {{ repoPath: string, remote: string, branch: string, isForce: boolean }} options
 * @returns {string[]}
 */
export function buildUpdateCommands({ repoPath, remote, branch, isForce }) {
    const base = `git -C "${repoPath}"`
    const target = `${remote}/${branch}`
    if (isForce) {
        return [
            `${base} fetch --all --prune`,
            `${base} checkout -B ${branch} ${target}`,
            `${base} reset --hard ${target}`,
            `${base} clean -fd`
        ]
    }
    return [
        `${base} fetch --all --prune`,
        `${base} checkout ${branch}`,
        `${base} pull --no-rebase ${remote} ${branch}`
    ]
}

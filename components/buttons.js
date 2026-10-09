// components/buttons.js
// 官方Bot（QQBot）快捷按钮构造：仅在官方平台消息上生成，其余平台返回空数组由调用方跳过拼接
//
// 适配器按钮规则（QQBot-Plugin 按钮写法.md）：
// - { text, input } 不带 send：点击后填入输入框但不发送，适合需要补全参数的命令（如日期、昵称）
// - { text, callback }：点击后触发对应命令文本，以 callback/指令事件回到插件，现有正则规则可直接匹配
// - permission: "admin" 仅管理员可操作；content/confirm_text/cancel_text 弹出二次确认
import { segment } from 'oicq'
import { isOfficialMsg, checkPermission } from './common.js'

/**
 * 生日模块快捷按钮
 * @param {object} e 事件对象
 * @param {object} [options]
 * @param {boolean} [options.withClear=false] 是否附带“清除生日”按钮（含确认弹窗）
 * @returns {Array} 按钮消息段数组（非官方平台为空数组）
 */
export function birthdayButtons(e, { withClear = false } = {}) {
    if (!isOfficialMsg(e)) return []
    const userRow = [
        { text: '设置生日', input: '#设置生日 ' },
        { text: '我的生日', callback: '#我的生日' },
        { text: '修改昵称', input: '#生日修改昵称 ' },
        { text: '生日帮助', callback: '#生日帮助' },
    ]
    const rows = [userRow]
    if (withClear) {
        rows.push([{
            text: '清除生日', callback: '#清除生日',
            content: '确认清除你的生日信息？', confirm_text: '确认', cancel_text: '取消',
        }])
    }
    // 管理员行：带参命令走输入框填入，管理员补全时再 @ 目标成员
    if (e.isGroup && checkPermission(e)) {
        rows.push([
            { text: '添加生日', input: '#添加生日 ', permission: 'admin' },
            { text: '修改生日', input: '#修改生日 ', permission: 'admin' },
            { text: '移除生日', input: '#移除生日 ', permission: 'admin' },
        ])
    }
    return [segment.button(...rows)]
}

/**
 * 课表模块快捷按钮（群课表/全部课表/我的课表等回复通用）
 * @param {object} e 事件对象
 * @returns {Array} 按钮消息段数组（非官方平台为空数组）
 */
export function scheduleButtons(e) {
    if (!isOfficialMsg(e)) return []
    const rows = [
        [
            { text: '今日课表', callback: '#今日课表' },
            { text: '本周课表', callback: '#本周课表' },
            { text: '我的课表', callback: '#我的课表' },
        ],
        [
            { text: '设置课表', input: '#设置课表 ' },
            { text: '翘课', callback: '#翘课' },
            { text: '取消翘课', callback: '#取消翘课' },
        ],
    ]
    return [segment.button(...rows)]
}

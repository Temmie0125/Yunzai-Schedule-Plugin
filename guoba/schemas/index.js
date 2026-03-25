/*
 * @Author: Temmie0125 1179755948@qq.com
 * @Date: 2026-03-09 22:00:29
 * @LastEditors: Temmie0125 1179755948@qq.com
 * @LastEditTime: 2026-03-25 17:58:41
 * @FilePath: \实验与作业e:\bot\plugins\schedule\guoba\schemas\index.js
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
export const schemas = [
    {
        field: "pushCron",
        label: "推送时间",
        component: "Input",
        required: true,
        placeholder: "例如：0 20 * * * 表示每天20:00",
        bottomHelpMessage: "自动推送明日课表的时间。请填写标准的cron表达式，支持Linux crontab格式。"
    },
    // 新增：是否显示课表名称
    {
        field: "showTableName",
        label: "群聊显示课表名称",
        component: "Switch",
        defaultValue: true,
        bottomHelpMessage: "关闭后，在群内设置课表以及查看个人信息将不显示课表名称，保护隐私"
    },
    // 新增：是否自动撤回口令
    {
        field: "autoRecallCode",
        label: "自动撤回课表口令",
        component: "Switch",
        defaultValue: false,
        bottomHelpMessage: "开启后，在群内且Bot有管理员权限时，将自动撤回用户发送的口令消息"
    },
    // 新增：渲染精度
    {
        field: "renderScale",
        label: "图片渲染精度",
        component: "InputNumber",
        required: true,
        componentProps: {
            min: 0.8,
            max: 2,
            step: 0.1,
            placeholder: '请输入渲染精度'
        },
        defaultValue: 1.0, 
        bottomHelpMessage: "控制生成图片的大小。更高的精度图片更清晰，但渲染时间更长。建议1.0即可。"
    },
    {
        field: "autoCancelCheckEnabled",
        label: "翘课自动检查",
        component: "Switch",
        defaultValue: false,
        bottomHelpMessage: "开启后，会按照下面的间隔定期清理过期的翘课状态"
    },
    {
        field: "autoCancelCheckInterval",
        label: "翘课检查间隔",
        component: "InputNumber",
        required: true,
        componentProps: {
            min: 5,
            max: 120,
            step: 1,
            placeholder: '请输入间隔（分钟）',
            addonAfter: '分钟'
        },
        defaultValue: 60, 
        bottomHelpMessage: "自动检查翘课的时间间隔（分钟）"
    }
]
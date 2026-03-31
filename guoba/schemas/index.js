// guoba/schemas/index.js
export const schemas = [
    {
        component: "Divider",
        label: "课表模块设置"
    },
    {
        field: "pushHour",                     // 改为 pushHour
        label: "推送时间（小时）",
        component: "InputNumber",
        required: true,
        componentProps: {
            min: 0,
            max: 23,
            step: 1,
            placeholder: '请输入0-23的小时数',
            addonAfter: '点'
        },
        defaultValue: 20,                      // 默认晚上8点
        bottomHelpMessage: "设置每天几点推送明日课表。例如：20 表示晚上8点推送。"
    },
    // 其他配置项保持不变
    {
        field: "showTableName",
        label: "群聊显示课表名称",
        component: "Switch",
        defaultValue: true,
        bottomHelpMessage: "关闭后，在群内设置课表以及查看个人信息将不显示课表名称，保护隐私"
    },
    {
        field: "autoRecallCode",
        label: "自动撤回课表口令",
        component: "Switch",
        defaultValue: false,
        bottomHelpMessage: "开启后，在群内且Bot有管理员权限时，将自动撤回用户发送的口令消息"
    },
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
    },
    // 分组
    {
        component: "Divider",
        label: "生日模块设置"
    },
    {
        field: "birthdayPushHour",
        label: "生日推送时间",
        component: "InputNumber",
        required: true,
        componentProps: {
            min: 0,
            max: 23,
            step: 1,
            placeholder: '请输入0-23的小时数',
            addonAfter: '点'
        },
        defaultValue: 0,                      // 默认0点
        bottomHelpMessage: "设置每天几点推送生日提醒。例如：0 表示每天0点推送。"
    },
    {
        field: "allowSelfModify",
        label: "允许成员修改生日",
        component: "Switch",
        defaultValue: true,
        bottomHelpMessage: "开启后，成员可以重新设置生日以进行修改"
    }
];
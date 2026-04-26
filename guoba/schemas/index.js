// guoba/schemas/index.js
export const schemas = [
    // 分组
    {
        component: "SOFT_GROUP_BEGIN",
        label: "全局设置"
    },
    {
        field: "botName",
        label: "Bot名称",
        component: "Input",
        placeholder: "请输入自定义名称",
        bottomHelpMessage: "请输入要在本插件显示的自定义Bot名称。留空默认使用Bot昵称"
    },
    {
        component: 'Divider',
        label: '图片渲染设置'
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
        bottomHelpMessage: "控制生成图片的质量。更高的精度图片更清晰，但渲染时间更长。建议1.0即可。"
    },
    {
        field: "font",
        label: "图片字体风格",
        helpMessage: "选择生成图片时使用的字体。需确保 resources/fonts/ 目录下存在对应的字体文件。",
        component: "RadioGroup",
        componentProps: {
            options: [
                { label: "像素（默认）", value: "像素" },
                { label: "圆体", value: "圆体" }
            ]
        },
        bottomHelpMessage: "选择生成图片时使用的字体。需确保 resources/fonts/ 目录下存在对应的字体文件。"
    },
    {
        component: 'Divider',
        label: '其他设置'
    },
    {
        field: "defaultSemesterStart",
        label: "默认学期开始日期",
        component: "Input",
        required: true,
        componentProps: {
            placeholder: "请输入日期，格式 YYYY-MM-DD"
        },
        defaultValue: "2024-02-26",
        rules: [
            { required: true, message: "请填写默认学期开始日期" }
        ],
        bottomHelpMessage: "当未提供学期开始日期时，将使用该日期计算当前周数。请确保日期为周一（插件会自动校正到所在周的周一）。"
    },
    {
        component: 'SOFT_GROUP_BEGIN',
        label: '课表模块设置'
    },
    {
        component: 'Divider',
        label: 'WakeUP反代设置'
    },
    {
        field: "proxyUrl",
        label: "课表反代服务器",
        component: "Input",
        placeholder: "请输入URL:PORT",
        bottomHelpMessage: "请输入用于获取课表数据的URL。端口号为19178。例如http://YOUR_SERVER_URL:19178"
    },
    {
        field: "apiToken",
        label: "API Token",
        component: "Input",
        placeholder: "请输入Token",
        bottomHelpMessage: "请输入用于访问课表服务的Token。可联系插件作者获取。"
    },
    {
        component: 'Divider',
        label: '自动任务设置'
    },
    {
        field: "pushHour",
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
    // 其他配置项保持不变
    {
        component: 'Divider',
        label: '群聊相关设置'
    },
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
    // 分组
    {
        component: "SOFT_GROUP_BEGIN",
        label: "生日模块设置"
    },
    {
        component: 'Divider',
        label: '基础设置'
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
        label: "允许自行修改生日",
        component: "Switch",
        defaultValue: true,
        bottomHelpMessage: "开启后，成员可以自行重新设置或清除生日以进行修改"
    },
    {
        component: 'Divider',
        label: '群单独设置'
    },
    {
        field: "birthdayWhitelistGroups",
        label: "生日推送白名单群",
        component: "GSelectGroup",
        componentProps: {
            placeholder: "选择需要推送生日提醒的群（留空则推送所有群）",
            mode: "multiple"   // 多选
        },
        defaultValue: [],
        bottomHelpMessage: "仅在这些群中发送生日祝福。留空则所有群都会尝试推送（但会被黑名单排除）。"
    },
    {
        field: "birthdayBlacklistGroups",
        label: "生日推送黑名单群",
        component: "GSelectGroup",
        componentProps: {
            placeholder: "选择不推送生日提醒的群",
            mode: "multiple"
        },
        defaultValue: [],
        bottomHelpMessage: "这些群将不会收到生日祝福。白名单优先：如果白名单非空，黑名单无效。"
    }
];
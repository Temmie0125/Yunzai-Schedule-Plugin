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
        helpMessage: "本插件中自定义的Bot名称",
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
        helpMessage: "越大的图像越清晰，但会略微影响性能。",
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
        field: "maxRenderRetry",
        label: "渲染重试次数",
        component: "InputNumber",
        helpMessage: "图像渲染超时或者失败时，允许的最大重试次数。",
        required: true,
        componentProps: {
            min: 0,
            max: 3,
            step: 1,
            placeholder: '请输入重试次数'
        },
        defaultValue: 1,
        bottomHelpMessage: "图像渲染超时或者失败时，允许的最大重试次数。"
    },
    {
        field: "renderRestartCount",
        label: "渲染重启阈值",
        component: "InputNumber",
        helpMessage: "累计渲染多少张图片之后自动重启Puppeteer, 避免可能出现的渲染越来越慢",
        required: true,
        componentProps: {
            min: 20,
            max: 200,
            step: 1,
            placeholder: '请输入重启阈值'
        },
        defaultValue: 100,
        bottomHelpMessage: "累计渲染多少张图片之后自动重启Puppeteer, 避免可能出现的渲染越来越慢。"
    },
    {
        field: "renderTimeOut",
        label: "渲染超时时间",
        component: "InputNumber",
        helpMessage: "对所有的图片生效，超时后重启puppeteer，单位ms",
        required: true,
        componentProps: {
            min: 5000,
            max: 30000,
            step: 100,
            placeholder: '请输入超时时间',
            addonAfter: 'ms'
        },
        defaultValue: 10000,
        bottomHelpMessage: "对所有的图片生效，超时后重启puppeteer，单位ms。"
    },
    {
        component: 'SOFT_GROUP_BEGIN',
        label: '课表模块设置'
    },
    {
        component: 'Divider',
        label: 'WakeUp服务设置'
    },
    {
        field: "wakeupServiceUrl",
        label: "WakeUp服务地址",
        component: "Input",
        placeholder: "请输入服务基础URL",
        bottomHelpMessage: "WakeUp课程表解析服务的基础URL。默认使用公共服务，也可以配置自己的服务地址。"
    },
    {
        field: "wakeupAuthToken",
        label: "鉴权Token",
        component: "Input",
        placeholder: "请输入Token（可选）",
        bottomHelpMessage: "WakeUp服务的鉴权Token。如果使用自己的服务并配置了鉴权，请填写此项。留空则不进行鉴权。"
    },
    {
        field: "defaultSemesterStart",
        label: "默认学期开始日期",
        component: "Input",
        required: true,
        componentProps: {
            placeholder: "请输入日期，格式 YYYY-MM-DD"
        },
        defaultValue: "2026-03-02",
        rules: [
            { required: true, message: "请填写默认学期开始日期" }
        ],
        bottomHelpMessage: "当未提供学期开始日期时，将使用该日期计算当前周数。请确保日期为周一（插件会自动校正到所在周的周一）。"
    },
    {
        field: "watchFiles",
        label: "监听所有文件",
        helpMessage: "监听所有文件以尝试跳过上下文直接导入课表。只处理支持的文件",
        component: "Switch",
        defaultValue: false,
        bottomHelpMessage: "开启后将监听所有聊天文件，并自动导入支持的课表格式"
    },
    {
        component: 'Divider',
        label: '自动任务设置'
    },
    {
        field: "pushHour",
        label: "推送时间",
        helpMessage: "只需要填写一个整数就行，每天对应时间会自动推送",
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
        field: "sortMode",
        label: "课表排序模式",
        helpMessage: "默认按QQ号升序，可改为按上课状态排序",
        component: "RadioGroup",
        componentProps: {
            options: [
                { label: "按QQ号(默认)", value: "userId" },
                { label: "按上课状态", value: "courseStatus" }
            ]
        },
        bottomHelpMessage: "使用#clstb命令时对成员的排序方法。"
    },
    {
        field: "showTableName",
        label: "显示课表名称",
        helpMessage: "针对群内设置课表、查看个人课表等功能，可以隐藏课表名称",
        component: "Switch",
        defaultValue: true,
        bottomHelpMessage: "关闭后，在群内设置课表以及查看个人信息将不显示课表名称，保护隐私"
    },
    {
        field: "autoRecallCode",
        label: "自动撤回口令",
        helpMessage: "仅针对口令类导入生效，对文件导入无效",
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
        label: "推送时间",
        component: "InputNumber",
        helpMessage: "设置每天几点推送生日提醒",
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
        label: "允许修改生日",
        helpMessage: "是否允许成员重新设置生日",
        component: "Switch",
        defaultValue: true,
        bottomHelpMessage: "开启后，成员可以自行重新设置或清除生日以进行修改"
    },
    {
        field: "showQQ",
        label: "展示QQ号",
        helpMessage: "是否在生日列表卡片中展示成员QQ号。",
        component: "Switch",
        defaultValue: true,
        bottomHelpMessage: "开启后，会在生日列表卡片的头像下方显示QQ号。"
    },
    {
        field: "birthdayCustomName",
        label: "允许自定义昵称",
        helpMessage: "是否允许成员使用自定义昵称来显示生日信息。",
        component: "Switch",
        defaultValue: true,
        bottomHelpMessage: "开启后，成员可使用 #生日修改昵称 自定义生日提醒的显示名称。关闭后，生日名称将强制同步为QQ昵称，所有已存储的自定义昵称也会被QQ昵称覆盖。"
    },
    {
        component: 'Divider',
        label: '群单独设置'
    },
    {
        field: "birthdayWhitelistGroups",
        label: "白名单群",
        helpMessage: "填写时仅对这些群生效",
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
        label: "黑名单群",
        helpMessage: "填写时跳过这些群聊。会被白名单覆盖。",
        component: "GSelectGroup",
        componentProps: {
            placeholder: "选择不推送生日提醒的群",
            mode: "multiple"
        },
        defaultValue: [],
        bottomHelpMessage: "这些群将不会收到生日祝福。白名单优先：如果白名单非空，黑名单无效。"
    }
];
export const schemas = [
    {
        field: "pushCron",
        label: "推送时间 (cron表达式)",
        component: "Input",
        required: true,
        placeholder: "例如：0 20 * * * 表示每天20:00",
        help: "请填写标准的cron表达式，支持Linux crontab格式"
    },
    {
        component: "Divider",
        label: "说明"
    },
    {
        component: "Alert",
        message: "修改后需要重启 Bot 才能生效",
        type: "warning"
    }
]
export const schemas = [
    {
        field: "pushCron",
        label: "推送时间",
        component: "Input",
        required: true,
        placeholder: "例如：0 20 * * * 表示每天20:00",
        bottomHelpMessage: "请填写标准的cron表达式，支持Linux crontab格式。修改后需要重启 Bot 才能生效"
    }
]
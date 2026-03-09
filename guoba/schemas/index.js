/*
 * @Author: Temmie0125 1179755948@qq.com
 * @Date: 2026-03-09 22:00:29
 * @LastEditors: Temmie0125 1179755948@qq.com
 * @LastEditTime: 2026-03-09 22:36:47
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
        bottomHelpMessage: "请填写标准的cron表达式，支持Linux crontab格式。修改后需要重启 Bot 才能生效"
    }
]
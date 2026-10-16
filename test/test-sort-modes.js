// 临时测试：群课表「按距上/下课时间」排序与多列配置
// 覆盖 computeBoundaryMinutes / timeDistanceGroup / compareByTimeDistance / 列数标准化与画布宽度推导
// 运行方式（从 Yunzai 根目录）：node plugins/schedule/test/test-sort-modes.js
global.logger = console; // 插件代码依赖 Yunzai 全局 logger，此处用 console 代替
import { computeBoundaryMinutes, timeDistanceGroup, compareByTimeDistance } from '../utils/timeUtils.js';
import {
    ConfigManager, MIN_SCHEDULE_COLUMNS, MAX_SCHEDULE_COLUMNS,
    SCHEDULE_CARD_WIDTH, SCHEDULE_GRID_GAP, SCHEDULE_SIDE_PADDING
} from '../components/ConfigManager.js';

let fail = 0;
function check(label, cond) {
    if (!cond) fail++;
    console.log(`[${cond ? 'PASS' : 'FAIL'}] ${label}`);
}
const hhmm = (h, m = 0) => h * 60 + m;
const idCompare = (a, b) => Number(a) - Number(b);

// ========== 1. 距上/下课分钟数 ==========
check('上课中：距本门课下课',
    computeBoundaryMinutes({
        status: '上课中', nowMinutes: hhmm(8, 30),
        ongoingCourses: [{ startTime: '08:00', endTime: '09:35' }], nextCourse: null, currentCourse: null
    }) === 65);
check('分身中：取最早下课的那门',
    computeBoundaryMinutes({
        status: '分身中', nowMinutes: hhmm(8, 30),
        ongoingCourses: [{ startTime: '08:00', endTime: '10:25' }, { startTime: '08:20', endTime: '09:35' }],
        nextCourse: null, currentCourse: null
    }) === 65);
check('翘课中：距当前课程下课',
    computeBoundaryMinutes({
        status: '翘课中', nowMinutes: hhmm(8, 0),
        ongoingCourses: [{ startTime: '08:00', endTime: '09:35' }], nextCourse: null, currentCourse: null
    }) === 95);
check('未开始：距下节课上课',
    computeBoundaryMinutes({
        status: '未开始', nowMinutes: hhmm(8, 25), ongoingCourses: null,
        nextCourse: { startTime: '08:30', endTime: '09:55' }, currentCourse: { startTime: '08:30', endTime: '09:55' }
    }) === 5);
check('已结束：距刚下课的时间',
    computeBoundaryMinutes({
        status: '已结束', nowMinutes: hhmm(8, 25), ongoingCourses: null,
        nextCourse: null, currentCourse: { startTime: '08:00', endTime: '08:20' }
    }) === 5);
check('无课程：无上下课事件返回 null',
    computeBoundaryMinutes({ status: '无课程', nowMinutes: hhmm(8, 25) }) === null);
check('学期结束：无上下课事件返回 null',
    computeBoundaryMinutes({ status: '学期结束', nowMinutes: hhmm(8, 25) }) === null);
check('时间无法解析时返回 null（不抛异常）',
    computeBoundaryMinutes({ status: '上课中', nowMinutes: hhmm(8, 25), ongoingCourses: [{ endTime: 'bad' }] }) === null);
check('未开始时课程（跨天残留）不产生负值',
    computeBoundaryMinutes({
        status: '未开始', nowMinutes: hhmm(8, 25), nextCourse: { startTime: '07:00', endTime: '07:45' }
    }) === 0);
// 兼容未补零时间（历史数据 "9:00"）
check('兼容未补零时间 9:00',
    computeBoundaryMinutes({
        status: '未开始', nowMinutes: hhmm(8, 50), nextCourse: { startTime: '9:00', endTime: '9:45' }
    }) === 10);

// ========== 2. 状态分组 ==========
const groupCases = [
    ['上课中', 0], ['分身中', 0], ['翘课中', 0],
    ['未开始', 1],
    ['已结束', 2], ['无课程', 2], ['学期未开始', 2], ['学期结束', 2], ['未知状态', 2],
];
for (const [status, expected] of groupCases) {
    check(`分组：${status} → ${expected}`, timeDistanceGroup(status) === expected);
}

// ========== 3. 排序结果 ==========
const members = [
    { userId: 5, status: '无课程', boundaryMinutes: null },
    { userId: 4, status: '已结束', boundaryMinutes: 10 },
    { userId: 3, status: '未开始', boundaryMinutes: 5 },
    { userId: 2, status: '上课中', boundaryMinutes: 40 },
    { userId: 1, status: '翘课中', boundaryMinutes: 3 },
];
const sorted = [...members].sort((a, b) => compareByTimeDistance(a, b, idCompare));
check('分组顺序：上课中组 → 未开始 → 其他',
    sorted.map(m => m.userId).join(',') === '1,2,3,4,5');
check('上课中组内按距下课升序', sorted[0].boundaryMinutes <= sorted[1].boundaryMinutes);
check('越接近上课越靠前：未开始的排在还有40分钟下课的人前面', sorted[2].status === '未开始' && sorted[2].boundaryMinutes < 40);

// 已结束组内按刚下课时间升序（刚下课的排前面）
const ended = [
    { userId: 11, status: '已结束', boundaryMinutes: 30 },
    { userId: 12, status: '已结束', boundaryMinutes: 2 },
    { userId: 13, status: '已结束', boundaryMinutes: 15 },
];
check('已结束组内刚下课者优先',
    [...ended].sort((a, b) => compareByTimeDistance(a, b, idCompare)).map(m => m.userId).join(',') === '12,13,11');

// 距离相同时按状态序（上课中 → 分身中 → 翘课中 → 未开始）再按用户ID
const tie = [
    { userId: 21, status: '未开始', boundaryMinutes: 10 },
    { userId: 22, status: '分身中', boundaryMinutes: 10 },
    { userId: 23, status: '上课中', boundaryMinutes: 10 },
    { userId: 24, status: '翘课中', boundaryMinutes: 10 },
];
check('距离相同按状态序再按用户ID',
    [...tie].sort((a, b) => compareByTimeDistance(a, b, idCompare)).map(m => m.userId).join(',') === '23,22,24,21');

// 缺少 boundaryMinutes（字段缺失）不抛异常，且排在同组末尾
const missing = [
    { userId: 31, status: '上课中', boundaryMinutes: 20 },
    { userId: 32, status: '上课中' },
];
check('boundaryMinutes 缺失时视为最远，排在同组末尾',
    [...missing].sort((a, b) => compareByTimeDistance(a, b, idCompare))[0].userId === 31);

// 其他组：状态优先级 已结束 → 无课程 → 学期未开始 → 学期结束
const others = [
    { userId: 41, status: '学期结束' },
    { userId: 42, status: '无课程' },
    { userId: 43, status: '学期未开始' },
    { userId: 44, status: '已结束', boundaryMinutes: 5 },
];
check('其他组按状态优先级',
    [...others].sort((a, b) => compareByTimeDistance(a, b, idCompare)).map(m => m.userId).join(',') === '44,42,43,41');

// ========== 4. 多列配置标准化 ==========
const columnCases = [
    [2, 2], [3, 3], [4, 4],
    [1, MIN_SCHEDULE_COLUMNS], [0, MIN_SCHEDULE_COLUMNS], [-5, MIN_SCHEDULE_COLUMNS],
    [5, MAX_SCHEDULE_COLUMNS], [99, MAX_SCHEDULE_COLUMNS],
    ['3', 3], ['4', 4], [3.7, 3],
    [undefined, MIN_SCHEDULE_COLUMNS], [null, MIN_SCHEDULE_COLUMNS], ['abc', MIN_SCHEDULE_COLUMNS], [NaN, MIN_SCHEDULE_COLUMNS],
];
for (const [input, expected] of columnCases) {
    const actual = ConfigManager.normalizeColumns(input);
    check(`列数标准化：${String(input)} → ${expected}`, actual === expected);
}

// ========== 5. 画布宽度：列数只加宽画布，卡片宽度保持不变 ==========
const canvasCases = [[2, 1080], [3, 1598], [4, 2116]];
for (const [input, expected] of canvasCases) {
    const actual = ConfigManager.resolveScheduleCanvasWidth(input);
    check(`画布宽度：${input} 列 → ${expected}px`, actual === expected);
}
// 任意列数下卡片都等于目标宽度（含非法值回落 2 列）
for (const input of [2, 3, 4, 1, 9, undefined, 'abc']) {
    const cols = ConfigManager.normalizeColumns(input);
    const canvas = ConfigManager.resolveScheduleCanvasWidth(input);
    const cardWidth = (canvas - SCHEDULE_SIDE_PADDING - (cols - 1) * SCHEDULE_GRID_GAP) / cols;
    check(`卡片宽度恒定（输入 ${String(input)} → ${cols} 列）: ${cardWidth}px`,
        Math.abs(cardWidth - SCHEDULE_CARD_WIDTH) < 0.01);
}
check('画布宽度随列数单调递增',
    ConfigManager.resolveScheduleCanvasWidth(2) < ConfigManager.resolveScheduleCanvasWidth(3)
    && ConfigManager.resolveScheduleCanvasWidth(3) < ConfigManager.resolveScheduleCanvasWidth(4));

// 画布宽度公式依赖模板的网格间距与内边距，二者必须与模板 CSS 保持一致（否则卡片宽度会静默偏离）
import fs from 'node:fs';
import path from 'node:path';
const tplPath = path.join(import.meta.dirname, '..', 'resources', 'template', 'schedule-template.html');
const tpl = fs.readFileSync(tplPath, 'utf8');
const membersListRule = tpl.match(/\.members-list\s*\{([^}]*)\}/)?.[1] || '';
const paddingMatch = membersListRule.match(/padding:\s*(\d+)px\s+(\d+)px/);
const gapMatch = membersListRule.match(/gap:\s*(\d+)px/);
check('模板 .members-list 存在 padding/gap 声明', !!paddingMatch && !!gapMatch);
check(`模板网格左右内边距合计与 SCHEDULE_SIDE_PADDING 一致（${SCHEDULE_SIDE_PADDING}）`,
    !!paddingMatch && Number(paddingMatch[2]) * 2 === SCHEDULE_SIDE_PADDING);
check(`模板网格 gap 与 SCHEDULE_GRID_GAP 一致（${SCHEDULE_GRID_GAP}）`,
    !!gapMatch && Number(gapMatch[1]) === SCHEDULE_GRID_GAP);
check('模板列数由 CSS 变量驱动（未硬编码 2 列）',
    /grid-template-columns:\s*repeat\(var\(--member-cols/.test(membersListRule));
check('模板已按列数注入画布宽度（{{canvasWidth}}）', /width:\s*\{\{canvasWidth/.test(tpl));
check('模板不再包含多列紧凑化规则（3/4 列不压缩卡片）', !/\.members-list\.cols-/.test(tpl));

console.log(fail === 0 ? '\n全部用例通过 ✅' : `\n${fail} 个用例失败 ❌`);
process.exit(fail === 0 ? 0 : 1);

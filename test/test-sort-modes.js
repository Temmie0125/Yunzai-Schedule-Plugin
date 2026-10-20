// 临时测试：群课表「按距上/下课时间」排序与多列配置
// 覆盖 computeBoundaryMinutes / timeDistanceGroup / compareByTimeDistance / 列数标准化与画布宽度推导
// 运行方式（从 Yunzai 根目录）：node plugins/schedule/test/test-sort-modes.js
global.logger = console; // 插件代码依赖 Yunzai 全局 logger，此处用 console 代替
import { computeBoundaryMinutes, timeDistanceGroup, compareByTimeDistance, computeAvatarProgress, buildCourseDots, MAX_COURSE_DOTS } from '../utils/timeUtils.js';
import {
    ConfigManager, MIN_SCHEDULE_COLUMNS, MAX_SCHEDULE_COLUMNS,
    SCHEDULE_CARD_WIDTH, SCHEDULE_GRID_GAP, SCHEDULE_SIDE_PADDING, SCHEDULE_TARGET_RATIO,
    SCHEDULE_CARD_HEIGHT, SCHEDULE_CHROME_HEIGHT
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

// ========== 4.5 头像进度环：完成比例（空 → 满）与边框模式 ==========
// computeAvatarProgress：上课瞬间为 0（空环），越接近下课越大，下课后封顶为 1
check('进度环：刚上课为空环', computeAvatarProgress('08:00', '09:40', hhmm(8, 0)) === 0);
check('进度环：过半填一半', computeAvatarProgress('08:00', '09:40', hhmm(8, 50)) === 0.5);
check('进度环：下课时为满环', computeAvatarProgress('08:00', '09:40', hhmm(9, 40)) === 1);
check('进度环：课后封顶为满环', computeAvatarProgress('08:00', '09:40', hhmm(10, 30)) === 1);
check('进度环：开课前为 0', computeAvatarProgress('08:00', '09:40', hhmm(7, 30)) === 0);
check('进度环：兼容未补零时间 9:00', computeAvatarProgress('9:00', '9:40', hhmm(9, 20)) === 0.5);
check('进度环：时长非正返回 null', computeAvatarProgress('09:00', '09:00', hhmm(9, 0)) === null);
check('进度环：时间无法解析返回 null', computeAvatarProgress('bad', '09:00', hhmm(9, 0)) === null);

// normalizeAvatarBorderMode：仅允许 progress / solid / off，非法值回落默认 progress
const borderModeCases = [
    ['progress', 'progress'], ['PROGRESS', 'progress'], [' Progress ', 'progress'],
    ['solid', 'solid'], ['off', 'off'], ['OFF', 'off'],
    ['', 'progress'], ['abc', 'progress'], [undefined, 'progress'], [null, 'progress'], [123, 'progress'],
];
for (const [input, expected] of borderModeCases) {
    const actual = ConfigManager.normalizeAvatarBorderMode(input);
    check(`头像边框模式标准化：${JSON.stringify(input)} → ${expected}`, actual === expected);
}

// resolveAvatarBorderMode：全局模式 + 该成员是否有进度 → 单卡展示方式
const perCardCases = [
    ['progress', 0.42, 'progress'], ['progress', 1, 'progress'], ['progress', 0, 'progress'],
    // progress 模式下没有进度的成员（非上课中）回落实色边框
    ['progress', null, 'solid'], ['progress', undefined, 'solid'], ['progress', NaN, 'solid'],
    // solid 模式一律实色，忽略进度
    ['solid', 0.42, 'solid'], ['solid', null, 'solid'],
    // off 模式一律关闭
    ['off', 0.42, 'off'], ['off', null, 'off'],
    // 非法全局值按默认 progress 处理
    ['abc', 0.42, 'progress'], [undefined, null, 'solid'],
];
for (const [mode, progress, expected] of perCardCases) {
    const actual = ConfigManager.resolveAvatarBorderMode(mode, progress);
    check(`单卡头像边框：全局 ${String(mode)} + 进度 ${String(progress)} → ${expected}`, actual === expected);
}

// ========== 4.6 今日课程圆点：分色判定与超量省略 ==========
const mkCourse = (name, start, end) => ({ name, startTime: start, endTime: end, location: '107' });
const dayCourses = [
    mkCourse('第1节', '08:00', '09:40'),
    mkCourse('第2节', '10:00', '11:40'),
    mkCourse('第3节', '14:00', '15:40'),
    mkCourse('第4节', '16:00', '17:40'),
];
// 10:30 时：第1节已上完、第2节正在上、第3/4节即将上
const dots1 = buildCourseDots(dayCourses, hhmm(10, 30));
check('圆点：状态按时间判定（已完成/进行中/未开始）', dots1.visible.join(',') === 'finished,ongoing,upcoming,upcoming');
check('圆点：未超量时不省略', dots1.hiddenPast === 0 && dots1.hiddenFuture === 0 && dots1.total === 4);

// 正在上的课被标记为已翘课
const dots2 = buildCourseDots(dayCourses, hhmm(10, 30), { skippedCourses: [dayCourses[1]] });
check('圆点：翘课中的课程显示为已翘课', dots2.visible.join(',') === 'finished,skipped,upcoming,upcoming');
// 非当前课程不会被误标
const dots3 = buildCourseDots(dayCourses, hhmm(15, 0), { skippedCourses: [dayCourses[1]] });
check('圆点：非当前课程不误标为翘课', dots3.visible.join(',') === 'finished,finished,ongoing,upcoming');

// 空列表 / 全天已结束
check('圆点：无课程返回空', buildCourseDots([], hhmm(10, 0)).total === 0);
const dotsEnded = buildCourseDots(dayCourses, hhmm(23, 0));
check('圆点：全部上完时都是 finished', dotsEnded.visible.every(s => s === 'finished') && dotsEnded.total === 4);
// 时间无法解析的课程按「即将上」处理
check('圆点：时间异常按即将上处理',
    buildCourseDots([{ name: 'x', startTime: 'bad', endTime: 'bad' }], hhmm(10, 0)).visible[0] === 'upcoming');

// 超量省略：12 节课、上限 6，当前时刻在第 7 节 → 窗口居中，两端以数字省略
const manyCourses = Array.from({ length: 12 }, (_, i) => mkCourse(`第${i + 1}节`,
    `${String(8 + i).padStart(2, '0')}:00`, `${String(8 + i).padStart(2, '0')}:45`));
const dotsMany = buildCourseDots(manyCourses, hhmm(14, 10), { maxDots: 6 });
check('圆点：超量时 visible 数量等于上限', dotsMany.visible.length === 6 && dotsMany.total === 12);
check('圆点：省略数量守恒（visible + hiddenPast + hiddenFuture = total）',
    dotsMany.visible.length + dotsMany.hiddenPast + dotsMany.hiddenFuture === 12);
check('圆点：当前课程一定在可见窗口内', dotsMany.visible.includes('ongoing'));
check('圆点：窗口两侧分别是已上完与即将上',
    dotsMany.hiddenPast > 0 && dotsMany.hiddenFuture > 0
    && dotsMany.visible[0] === 'finished' && dotsMany.visible[dotsMany.visible.length - 1] === 'upcoming');
check('圆点：默认上限为 6', buildCourseDots(manyCourses, hhmm(14, 10)).visible.length === MAX_COURSE_DOTS);

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

// ========== 6. 「自动」列数：按整图宽高比（2:3）选列数 ==========
// 设置值标准化：'auto' 与固定列数统一成字符串，供 Guoba 单选组匹配
const settingCases = [
    ['auto', 'auto'], ['AUTO', 'auto'], [' Auto ', 'auto'],
    [2, '2'], ['3', '3'], [4, '4'], [3.7, '3'],
    [5, '4'], [1, '2'], [undefined, '2'], [null, '2'], ['abc', '2'],
];
for (const [input, expected] of settingCases) {
    const actual = ConfigManager.normalizeColumnsSetting(input);
    check(`列数设置标准化：${JSON.stringify(input)} → '${expected}'`, actual === expected);
}

// 高度估算：与真实出图实测值比对（9 人样例实测 2 列 1728 / 3 列 1237 / 4 列 1233）
const heightCases = [[2, 1728], [3, 1237], [4, 1233]];
for (const [cols, measured] of heightCases) {
    const est = ConfigManager.estimateScheduleImageHeight(cols, 9);
    check(`高度估算接近实测（${cols} 列 / 9 人）: 估算 ${est} vs 实测 ${measured}`,
        Math.abs(est - measured) <= 8);
}
check('高度估算随行数线性增长（同列数）',
    ConfigManager.estimateScheduleImageHeight(2, 5) < ConfigManager.estimateScheduleImageHeight(2, 9)
    && ConfigManager.estimateScheduleImageHeight(2, 9) < ConfigManager.estimateScheduleImageHeight(2, 13));
check('0 人按 1 行估算，不出现负高度或无限大',
    Number.isFinite(ConfigManager.estimateScheduleImageHeight(2, 0))
    && ConfigManager.estimateScheduleImageHeight(2, 0) > 0);

// 自动模式的列数选择：等价于「哪一档的宽高比最接近 2:3」，本布局下切换点为 15 人、31 人
const autoCases = [
    [0, 2], [1, 2], [2, 2], [6, 2], [9, 2], [12, 2], [14, 2],
    [15, 3], [18, 3], [24, 3], [30, 3],
    [31, 4], [36, 4], [40, 4], [60, 4], [100, 4],
];
for (const [count, expected] of autoCases) {
    const actual = ConfigManager.resolveScheduleColumns('auto', count);
    check(`自动列数：${count} 人 → ${expected} 列`, actual === expected);
}
// 核心不变式：自动选出的那一档，宽高比必须比其它任何档都更接近 2:3（对数距离）
const ratioDistance = (cols, count) => {
    const width = ConfigManager.resolveScheduleCanvasWidth(cols);
    const height = ConfigManager.estimateScheduleImageHeight(cols, count);
    return Math.abs(Math.log(width / height) - Math.log(SCHEDULE_TARGET_RATIO));
};
let invariantOk = true;
let worst = '';
for (let n = 1; n <= 120; n++) {
    const chosen = ConfigManager.resolveScheduleColumns('auto', n);
    const chosenDist = ratioDistance(chosen, n);
    for (const cols of [2, 3, 4]) {
        if (ratioDistance(cols, n) < chosenDist - 1e-9) {
            invariantOk = false;
            worst = `${n} 人选了 ${chosen} 列，但 ${cols} 列更接近 2:3`;
        }
    }
}
check(`自动列数在 1~120 人范围内始终选出最接近 2:3 的档${worst ? `（反例：${worst}）` : ''}`, invariantOk);
// 距离相同时保留更少列（图片更窄）
const tieCount = (() => {
    for (let n = 1; n <= 500; n++) {
        const d2 = ratioDistance(2, n), d3 = ratioDistance(3, n);
        if (Math.abs(d2 - d3) < 1e-12) return n;
    }
    return null;
})();
check('宽高比距离完全相同时取更少列（无并列样本则跳过）',
    tieCount === null || ConfigManager.resolveScheduleColumns('auto', tieCount) === 2);
// 固定列数不受人数影响
for (const fixed of ['2', '3', '4']) {
    check(`固定 ${fixed} 列不受人数影响`,
        ConfigManager.resolveScheduleColumns(fixed, 30) === Number(fixed)
        && ConfigManager.resolveScheduleColumns(fixed, 1) === Number(fixed));
}
// 自动列数的画布宽度同样遵循「卡片宽度不变」
for (const count of [5, 13, 20]) {
    const cols = ConfigManager.resolveScheduleColumns('auto', count);
    const canvas = ConfigManager.resolveScheduleCanvasWidth(cols);
    const cardWidth = (canvas - SCHEDULE_SIDE_PADDING - (cols - 1) * SCHEDULE_GRID_GAP) / cols;
    check(`自动 ${count} 人（${cols} 列）卡片宽度仍为 ${SCHEDULE_CARD_WIDTH}px`,
        Math.abs(cardWidth - SCHEDULE_CARD_WIDTH) < 0.01);
}

console.log(fail === 0 ? '\n全部用例通过 ✅' : `\n${fail} 个用例失败 ❌`);
process.exit(fail === 0 ? 0 : 1);

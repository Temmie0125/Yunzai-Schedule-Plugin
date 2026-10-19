// 临时测试：群课表卡片渲染（直接渲染真实模板，校验剩余/距离上课时间的显示分支）
// 覆盖：上课中/分身中/翘课中 → 「剩余」；未开始 → 「距离上课」；已结束/无课程 → 均不显示
// 运行方式（从 Yunzai 根目录）：node plugins/schedule/test/test-card-render.js
global.logger = console; // 插件代码依赖 Yunzai 全局 logger，此处用 console 代替
import fs from 'node:fs';
import path from 'node:path';
import art from 'art-template';
import { lightenHexColor, darkenHexColor, mixHexColor, normalizeHexColor } from '../utils/colorUtils.js';

const pluginRoot = path.resolve(import.meta.dirname, '..');
const tplFile = path.join(pluginRoot, 'resources', 'template', 'schedule-template.html');

let fail = 0;
function check(label, cond) {
    if (!cond) fail++;
    console.log(`[${cond ? 'PASS' : 'FAIL'}] ${label}`);
}

// 断言渲染结果时应只看 <body>，避免样式表里的注释文本误伤（如注释里出现「距离上课」）
const bodyOf = (html) => html.split('<body>')[1] || html;
const avatar = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=';
const mk = (o) => ({
    userId: 10001, avatar, skipStatus: false, signature: '',
    hasSemesterStart: true, currentWeek: 5, remainingTime: null, ...o
});
const course = { name: '高等数学', location: '107', startTime: '08:00', endTime: '09:35' };

function renderOne(member, extra = {}) {
    return art(tplFile, {
        weekday: '四', currentTime: '08:25', updateTime: '2026/10/15 08:25:53',
        columns: 2, canvasWidth: 1080, totalMembers: 1,
        studyingCount: 0, skippingCount: 0, skipModeCount: 0,
        members: [member], _fontInlineUrl: 'data:font/otf;base64,', _fontFormat: 'opentype',
        ...extra
    });
}

// ========== 1. 翘课中：本次新增，必须显示「剩余」 ==========
const skipped = renderOne(mk({
    nickname: '翘课选手', status: '翘课中', skipStatus: true,
    remainingTime: '1小时20分钟', currentCourse: course
}));
check('翘课中显示「剩余」剩余时间', skipped.includes('⏳ 剩余: 1小时20分钟'));
check('翘课中同时保留「翘课模式」角标', skipped.includes('翘课模式'));
check('翘课中不误显示「距离上课」', !bodyOf(skipped).includes('距离上课'));

// ========== 2. 其他状态的显示分支不受影响 ==========
const studying = renderOne(mk({ nickname: '上课中的人', status: '上课中', remainingTime: '45分钟', currentCourse: course }));
check('上课中显示「剩余」', studying.includes('⏳ 剩余: 45分钟'));

const doubling = renderOne(mk({
    nickname: '分身中的人', status: '分身中', remainingTime: '40分钟',
    overlapCourseLabel: '高等数学 / 大学英语', overlapLocationLabel: '107 / 外语楼305',
    currentCourse: course
}));
check('分身中显示「剩余」', doubling.includes('⏳ 剩余: 40分钟'));

const notStarted = renderOne(mk({ nickname: '没上课的人', status: '未开始', remainingTime: '5分钟', currentCourse: course }));
check('未开始显示「距离上课」', notStarted.includes('⏳ 距离上课: 5分钟'));

const ended = renderOne(mk({ nickname: '下课的人', status: '已结束', currentCourse: course }));
check('已结束不显示剩余/距离上课', !bodyOf(ended).includes('剩余:') && !bodyOf(ended).includes('距离上课'));

const noCourse = renderOne(mk({ nickname: '无课的人', status: '无课程' }));
check('无课程不显示剩余/距离上课', !bodyOf(noCourse).includes('剩余:') && !bodyOf(noCourse).includes('距离上课'));

// ========== 3. 课后自动失效场景：翘课中但无剩余时间时不应渲染空徽章 ==========
const skippedNoTime = renderOne(mk({ nickname: '翘课无时间', status: '翘课中', skipStatus: true, currentCourse: course }));
// 注意：remaining-time 是样式类名，始终存在于 <style> 中，需检查只在有值时渲染的容器元素
check('翘课中无 remainingTime 时不渲染剩余徽章', !bodyOf(skippedNoTime).includes('class="course-meta"'));

// ========== 4. 文本降级同样包含翘课中的剩余时间 ==========
const rendererSrc = fs.readFileSync(path.join(pluginRoot, 'components', 'Renderer.js'), 'utf8');
const textBranch = rendererSrc.match(/if \(member\.remainingTime\) \{[\s\S]{0,400}?\n            \}/)?.[0] || '';
check('文本降级：剩余时间分支包含翘课中', /member\.status === '翘课中'/.test(textBranch));

// ========== 5. 触发者卡片高亮 ==========
const selfCard = renderOne(mk({ nickname: '触发者', status: '上课中', remainingTime: '45分钟', currentCourse: course, isSelf: true }));
const otherCard = renderOne(mk({ nickname: '其他人', status: '上课中', remainingTime: '45分钟', currentCourse: course, isSelf: false }));
check('isSelf=true 的卡片带 is-self 高亮类', selfCard.includes('member-card is-self'));
// 注意：is-self 也出现在 <style> 的样式规则里，因此这里匹配具体的容器类名组合
check('isSelf=false 的卡片不带高亮类', !otherCard.includes('member-card is-self'));
check('高亮样式定义了淡黄荧光边框', /\.member-card\.is-self\s*\{[^}]*#f2d85c/.test(fs.readFileSync(tplFile, 'utf8')));

// ========== 6. 头像边框三档：进度环 / 实色 / 关闭 ==========
const tplSrc = fs.readFileSync(tplFile, 'utf8');
const progressCard = renderOne(mk({
    nickname: '上课中', status: '上课中', remainingTime: '40分钟', currentCourse: course,
    avatarBorderMode: 'progress', avatarProgress: 0.42,
    statusColor: '#B13333', statusColorSoft: '#D48F8F', ringStrong: '#B13333', ringSoft: '#ECCCCC'
}));
check('进度环：输出 avatar-progress 类', progressCard.includes('member-avatar avatar-progress'));
check('进度环：注入完成比例 --progress', progressCard.includes('--progress: 0.42'));
check('进度环：注入同色系深浅双色', progressCard.includes('--ring-strong: #B13333') && progressCard.includes('--ring-soft: #ECCCCC'));
check('进度环：样式用 conic-gradient 画环', /\.member-avatar\.avatar-progress\s*\{[^}]*conic-gradient/.test(tplSrc));
check('进度环：填充/轨道分别使用 ring-strong 与 ring-soft', (() => {
    const rule = tplSrc.match(/\.member-avatar\.avatar-progress\s*\{([^}]*)\}/)?.[1] || '';
    return /conic-gradient/.test(rule) && /--ring-strong/.test(rule) && /--ring-soft/.test(rule);
})());
// 逆时针推进：软色在前段、深色贴 360°，填充区从 12 点起向左增长
check('进度环：逆时针推进（软色在前 + 1-progress 作为分界）', (() => {
    const rule = tplSrc.match(/\.member-avatar\.avatar-progress\s*\{([^}]*)\}/)?.[1] || '';
    return /conic-gradient\(\s*var\(--ring-soft/.test(rule) && /1 - var\(--progress/.test(rule);
})());

const solidCard = renderOne(mk({
    nickname: '未开始', status: '未开始', remainingTime: '5分钟', currentCourse: course,
    avatarBorderMode: 'solid', statusColor: '#3949AB', statusColorSoft: '#929BD1'
}));
check('实色：输出 avatar-solid 类', solidCard.includes('member-avatar avatar-solid'));
check('实色：不注入 --progress 变量', !solidCard.includes('--progress:'));
check('实色：边框用淡化的状态色变量（--status-color-soft）',
    /\.member-avatar\.avatar-solid\s*\{[^}]*var\(--status-color-soft/.test(tplSrc));
check('实色：卡片注入淡化后的状态色', solidCard.includes('--status-color-soft: #929BD1'));

const offCard = renderOne(mk({ nickname: '关闭', status: '上课中', remainingTime: '40分钟', currentCourse: course, avatarBorderMode: 'off' }));
check('关闭：输出 avatar-off 类', offCard.includes('member-avatar avatar-off'));
check('关闭：不注入 --progress 变量', !offCard.includes('--progress:'));

// ========== 6.1 颜色工具：淡色 / 深色派生 ==========
check('淡色派生：红 #B13333 → #D48F8F', lightenHexColor('#B13333', 0.45) === '#D48F8F');
check('淡色派生：轨道 #B13333 → #ECCCCC', lightenHexColor('#B13333', 0.75) === '#ECCCCC');
check('深色派生：向黑靠拢', darkenHexColor('#B13333', 1) === '#000000');
check('混合比例 0 返回原色', mixHexColor('#3949AB', '#FFFFFF', 0) === '#3949AB');
check('混合比例 1 返回目标色', mixHexColor('#3949AB', '#FFFFFF', 1) === '#FFFFFF');
check('3 位色值可规范化', normalizeHexColor('#abc') === '#AABBCC');
check('非法色值返回 null', normalizeHexColor('not-a-color') === null);
check('非法输入不抛异常、原样返回', mixHexColor('not-a-color', '#FFFFFF', 0.5) === 'not-a-color');

// ========== 7. 今日课程节数圆点 ==========
const dotsCard = renderOne(mk({
    nickname: '有课的人', status: '上课中', remainingTime: '40分钟', currentCourse: course,
    avatarBorderMode: 'solid',
    courseDots: { visible: ['finished', 'ongoing', 'upcoming'], hiddenPast: 2, hiddenFuture: 1, total: 6 }
}));
check('圆点：输出 dot 元素（分色类名）',
    ['dot-finished', 'dot-ongoing', 'dot-upcoming'].every(c => dotsCard.includes(`dot ${c}`)));
check('圆点：省略的已上完用 ×N 表示', dotsCard.includes('×2'));
check('圆点：省略的即将上用 +N 表示', dotsCard.includes('+1'));
check('圆点：与剩余时长同一行（course-meta 内）', /class="course-meta"[\s\S]{0,400}remaining-time[\s\S]{0,400}course-dots/.test(dotsCard));
check('圆点：圆点靠右（CSS margin-left: auto）', /\.course-dots\s*\{[^}]*margin-left:\s*auto/.test(tplSrc));
// 配色与尺寸：四态高对比、正在上放大、已上完偏灰（不再用 opacity 淡化，避免小圆点糊在一起）
const dotRule = (cls) => tplSrc.match(new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`))?.[1] || '';
check('圆点：已上完用偏灰配色（灰绿）', /#82A696/i.test(dotRule('dot-finished')));
check('圆点：已上完不再使用 opacity 淡化', !/opacity/.test(dotRule('dot-finished')));
check('圆点：即将上为饱和蓝（不再 opacity 淡化）',
    /#3949AB/i.test(dotRule('dot-upcoming')) && !/opacity/.test(dotRule('dot-upcoming')));
check('圆点：正在上放大（宽高大于基础 8px）', (() => {
    const rule = dotRule('dot-ongoing');
    const w = Number(rule.match(/width:\s*(\d+)px/)?.[1] || 0);
    const h = Number(rule.match(/height:\s*(\d+)px/)?.[1] || 0);
    const base = Number(dotRule('dot').match(/width:\s*(\d+)px/)?.[1] || 8);
    return w > base && h > base;
})());
check('圆点：图例中「正在上」也更大',
    /\.dots-legend \.dot-ongoing\s*\{[^}]*width:\s*13px/.test(tplSrc));

const noDotsCard = renderOne(mk({ nickname: '无课', status: '无课程', avatarBorderMode: 'off' }));
check('圆点：无课程时不渲染 course-meta', !noDotsCard.includes('class="course-meta"'));

const endedDots = renderOne(mk({
    nickname: '已结束', status: '已结束', currentCourse: course, avatarBorderMode: 'off',
    courseDots: { visible: ['finished', 'finished'], hiddenPast: 0, hiddenFuture: 0, total: 2 }
}));
check('圆点：已结束也展示（无剩余时长时单独成行）',
    endedDots.includes('class="course-meta"') && endedDots.includes('dot dot-finished') && !endedDots.includes('⏳'));

console.log(fail === 0 ? '\n全部用例通过 ✅' : `\n${fail} 个用例失败 ❌`);
process.exit(fail === 0 ? 0 : 1);

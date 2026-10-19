// 临时测试：群课表卡片渲染（直接渲染真实模板，校验剩余/距离上课时间的显示分支）
// 覆盖：上课中/分身中/翘课中 → 「剩余」；未开始 → 「距离上课」；已结束/无课程 → 均不显示
// 运行方式（从 Yunzai 根目录）：node plugins/schedule/test/test-card-render.js
global.logger = console; // 插件代码依赖 Yunzai 全局 logger，此处用 console 代替
import fs from 'node:fs';
import path from 'node:path';
import art from 'art-template';

const pluginRoot = path.resolve(import.meta.dirname, '..');
const tplFile = path.join(pluginRoot, 'resources', 'template', 'schedule-template.html');

let fail = 0;
function check(label, cond) {
    if (!cond) fail++;
    console.log(`[${cond ? 'PASS' : 'FAIL'}] ${label}`);
}

const avatar = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=';
const mk = (o) => ({
    userId: 10001, avatar, skipStatus: false, signature: '',
    hasSemesterStart: true, currentWeek: 5, remainingTime: null, ...o
});
const course = { name: '高等数学', location: '107', startTime: '08:00', endTime: '09:35' };

function renderOne(member) {
    return art(tplFile, {
        weekday: '四', currentTime: '08:25', updateTime: '2026/10/15 08:25:53',
        columns: 2, canvasWidth: 1080, totalMembers: 1,
        studyingCount: 0, skippingCount: 0, skipModeCount: 0,
        members: [member], _fontInlineUrl: 'data:font/otf;base64,', _fontFormat: 'opentype'
    });
}

// ========== 1. 翘课中：本次新增，必须显示「剩余」 ==========
const skipped = renderOne(mk({
    nickname: '翘课选手', status: '翘课中', skipStatus: true,
    remainingTime: '1小时20分钟', currentCourse: course
}));
check('翘课中显示「剩余」剩余时间', skipped.includes('⏳ 剩余: 1小时20分钟'));
check('翘课中同时保留「翘课模式」角标', skipped.includes('翘课模式'));
check('翘课中不误显示「距离上课」', !skipped.includes('距离上课'));

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
check('已结束不显示剩余/距离上课', !ended.includes('剩余:') && !ended.includes('距离上课'));

const noCourse = renderOne(mk({ nickname: '无课的人', status: '无课程' }));
check('无课程不显示剩余/距离上课', !noCourse.includes('剩余:') && !noCourse.includes('距离上课'));

// ========== 3. 课后自动失效场景：翘课中但无剩余时间时不应渲染空徽章 ==========
const skippedNoTime = renderOne(mk({ nickname: '翘课无时间', status: '翘课中', skipStatus: true, currentCourse: course }));
// 注意：remaining-time 是样式类名，始终存在于 <style> 中，需检查只在有值时渲染的容器元素
check('翘课中无 remainingTime 时不渲染剩余徽章', !skippedNoTime.includes('class="course-remaining"'));

// ========== 4. 文本降级同样包含翘课中的剩余时间 ==========
const rendererSrc = fs.readFileSync(path.join(pluginRoot, 'components', 'Renderer.js'), 'utf8');
const textBranch = rendererSrc.match(/if \(member\.remainingTime\) \{[\s\S]{0,400}?\n            \}/)?.[0] || '';
check('文本降级：剩余时间分支包含翘课中', /member\.status === '翘课中'/.test(textBranch));

console.log(fail === 0 ? '\n全部用例通过 ✅' : `\n${fail} 个用例失败 ❌`);
process.exit(fail === 0 ? 0 : 1);

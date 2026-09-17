// 临时测试：节假日数据自动更新机制（会真实请求 timor.tech API）
// 注意：插件代码基于 process.cwd()（Yunzai 根目录）定位数据目录，因此本测试需从 Yunzai 根目录运行
global.logger = console; // 插件代码依赖 Yunzai 全局 logger，此处用 console 代替
import fs from 'node:fs';
import path from 'node:path';
import { checkHolidayUpdate } from '../services/holidayUpdater.js';
import { DataManager } from '../components/DataManager.js';

if (!fs.existsSync(path.join(process.cwd(), 'plugins/schedule/package.json'))) {
    console.error('请从 Yunzai 根目录运行本测试：node plugins/schedule/test/test-holiday-update.js');
    process.exit(1);
}
const DATA_DIR = path.join(process.cwd(), 'plugins/schedule/data/holiday');
let fail = 0;
function check(label, cond) {
    if (!cond) fail++;
    console.log(`[${cond ? 'PASS' : 'FAIL'}] ${label}`);
}

// 清理旧数据，从头验证
fs.rmSync(DATA_DIR, { recursive: true, force: true });

// 1. 首次更新：当年写入、次年未发布不写入、meta 记录今天
let r1 = await checkHolidayUpdate();
const today = new Date().toISOString().slice(0, 10);
check('首次更新执行（非跳过）', r1.skipped === false);
check('当年数据已写入', fs.existsSync(path.join(DATA_DIR, '2026.json')));
check('次年未发布数据不写入', !fs.existsSync(path.join(DATA_DIR, '2027.json')));
const saved = JSON.parse(fs.readFileSync(path.join(DATA_DIR, '2026.json'), 'utf8'));
check('写入格式与资源文件一致（code/year/holiday）', saved.code === 0 && saved.year === 2026 && typeof saved.holiday === 'object');
check('写入条目非空', Object.keys(saved.holiday).length > 0);
const meta = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'meta.json'), 'utf8'));
check('meta 记录今日检查', meta.lastCheckDate === today);
check('meta 记录今日成功', meta.lastSuccessDate === today);

// 2. 同日再次调用：跳过（保护每日配额）
let r2 = await checkHolidayUpdate();
check('同日重复调用被跳过', r2.skipped === true);

// 3. loadHolidayData 优先级验证：在数据目录文件中植入标记条目，清缓存后应读到标记（证明读的是数据目录而非打包资源）
saved.holiday['12-99'] = { holiday: true, name: '优先级测试标记' };
fs.writeFileSync(path.join(DATA_DIR, '2026.json'), JSON.stringify(saved, null, 2));
DataManager.clearHolidayCache(2026);
const loaded = DataManager.loadHolidayData(2026);
check('数据目录优先于资源目录', loaded && !!loaded['12-99']);

// 4. 缓存清除后重新加载
DataManager.clearHolidayCache(2026);
const reloaded = DataManager.loadHolidayData(2026);
check('缓存清除后可重新加载', reloaded !== null);

// 5. 缓存生效（同对象引用）
check('缓存生效', DataManager.loadHolidayData(2026) === reloaded);

// 6. force 绕过守卫（验证强制刷新路径，真实再请求一次）
let r3 = await checkHolidayUpdate(true);
check('force 强制更新不被跳过', r3.skipped === false);

console.log(fail === 0 ? '\n全部通过 ✓' : `\n${fail} 项失败 ✗`);
process.exit(fail === 0 ? 0 : 1);

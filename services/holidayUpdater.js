// services/holidayUpdater.js
import fs from 'node:fs'
import path from 'node:path'
import { DataManager } from '../components/DataManager.js'

// 节假日数据 API（https://timor.tech/api/holiday/year）
// 默认参数即不返回日期类型、不包含周末，与 resources/holiday/ 下的资源文件格式一致
const HOLIDAY_API_BASE = 'https://timor.tech/api/holiday/year'
// 自动更新的节假日数据目录（gitignored，避免污染代码库）
const HOLIDAY_DATA_PATH = path.join(process.cwd(), 'plugins/schedule/data/holiday/')
// 更新状态文件，记录每日检查标记，保证 API 配额内每日最多请求一次
const HOLIDAY_META_FILE = path.join(HOLIDAY_DATA_PATH, 'meta.json')

function getTodayStr() {
    const now = new Date();
    return [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0')
    ].join('-');
}

function loadMeta() {
    try {
        return JSON.parse(fs.readFileSync(HOLIDAY_META_FILE, 'utf8')) || {};
    } catch {
        return {};
    }
}

function saveMeta(meta) {
    fs.mkdirSync(HOLIDAY_DATA_PATH, { recursive: true });
    fs.writeFileSync(HOLIDAY_META_FILE, JSON.stringify(meta, null, 2), 'utf8');
}

/**
 * 从接口获取指定年份的节假日数据
 * @param {number} year - 年份
 * @returns {Promise<object>} holiday 对象（key: MM-DD），数据未发布时为空对象
 */
async function fetchYearHolidays(year) {
    const response = await fetch(`${HOLIDAY_API_BASE}/${year}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 Yunzai-Schedule-Plugin' },
        signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    if (data.code !== 0) {
        throw new Error(`接口返回错误码 ${data.code}`);
    }
    return data.holiday || {};
}

/**
 * 保存指定年份的节假日数据到数据目录（格式与 resources/holiday/{year}.json 保持一致）
 */
function saveYearData(year, holidays) {
    fs.mkdirSync(HOLIDAY_DATA_PATH, { recursive: true });
    const filePath = path.join(HOLIDAY_DATA_PATH, `${year}.json`);
    fs.writeFileSync(filePath, JSON.stringify({ code: 0, year, holiday: holidays }, null, 2), 'utf8');
    DataManager.clearHolidayCache(year);
}

/**
 * 检查并更新节假日数据（每日最多检查一次，与课表推送共用定时节点）
 * 接口每日请求限额有限且仅提供未来一年数据，因此每次只拉取当年与次年；
 * 次年数据未发布时接口返回空对象，此时不写入，保留现有数据
 * @param {boolean} force - 是否跳过"每日一次"守卫强制更新
 * @returns {Promise<{ skipped: boolean, updated: number[], failed: number[] }>}
 */
export async function checkHolidayUpdate(force = false) {
    const meta = loadMeta();
    const today = getTodayStr();
    if (!force && meta.lastCheckDate === today) {
        return { skipped: true, updated: [], failed: [] };
    }
    const thisYear = new Date().getFullYear();
    const years = [thisYear, thisYear + 1];
    // 先记录检查标记再请求：无论成败当日不再自动重复请求，保护每日请求限额（失败可等明日自动重试，或用 #强制更新节假日数据）
    meta.lastCheckDate = today;
    saveMeta(meta);
    const results = await Promise.allSettled(years.map(fetchYearHolidays));

    const updated = [];
    const failed = [];
    years.forEach((year, i) => {
        const result = results[i];
        if (result.status === 'rejected') {
            logger.warn(`[节假日数据] 获取 ${year} 年数据失败: ${result.reason?.message || result.reason}`);
            failed.push(year);
            return;
        }
        const holidays = result.value;
        if (!holidays || Object.keys(holidays).length === 0) {
            logger.info(`[节假日数据] ${year} 年数据尚未发布，跳过写入`);
            return;
        }
        try {
            saveYearData(year, holidays);
            updated.push(year);
            logger.info(`[节假日数据] ${year} 年数据已更新（${Object.keys(holidays).length} 条）`);
        } catch (err) {
            logger.error(`[节假日数据] 写入 ${year} 年数据失败: ${err}`);
            failed.push(year);
        }
    });

    if (updated.length > 0) {
        meta.lastSuccessDate = today;
        saveMeta(meta);
    }

    if (failed.length === years.length) {
        throw new Error('当年与次年数据均获取失败');
    }
    return { skipped: false, updated, failed };
}

/**
 * 插件启动时补检（与推送节点共用"每日一次"守卫，先到先得），
 * 覆盖推送节点触发时 Bot 恰好离线的情况
 */
export async function startupCheckHolidayUpdate() {
    if (global.__schedule_holiday_startup_checked__) return;
    global.__schedule_holiday_startup_checked__ = true;
    try {
        await checkHolidayUpdate();
    } catch (err) {
        logger.warn(`[节假日数据] 启动检查更新失败，将继续使用现有数据: ${err.message}`);
    }
}

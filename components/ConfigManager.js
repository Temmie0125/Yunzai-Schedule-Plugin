// components/ConfigManager.js 
import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
export const DEFAULT_CONFIG_PATH = path.join(process.cwd(), 'plugins/schedule/config/default_config');
export const CONFIG_PATH = path.join(process.cwd(), 'plugins/schedule/config/config');
export const CONFIG_FILE = 'schedule.yaml';
// 群课表每行成员列数允许范围：至少 2 列，最多 4 列
export const MIN_SCHEDULE_COLUMNS = 2;
export const MAX_SCHEDULE_COLUMNS = 4;
// 群课表布局常量：任意列数下都保持卡片宽度不变（= 2 列时的宽度），
// 列数只影响画布宽度与每行人数，卡片内的字号/头像不随列数变化
export const SCHEDULE_CARD_WIDTH = 502;   // 单张卡片目标宽度（2 列 / 1080 画布下的实际宽度）
export const SCHEDULE_GRID_GAP = 16;      // 成员网格间距（与模板 .members-list 的 gap 一致）
export const SCHEDULE_SIDE_PADDING = 60;  // 成员网格左右内边距合计（与模板 .members-list 的 padding 一致）
// 「自动」列数的判定依据：整图宽高比（宽:高）尽量接近 2:3。
// 估算高度所需的两个常量来自真实出图实测（9 人样例：2 列 1080×1728、3 列 1598×1237、4 列 2116×1233）：
//   单卡高度约 229px（列数不影响卡片尺寸）、页头+统计+页脚+成员区内边距合计约 516px
export const SCHEDULE_TARGET_RATIO = 2 / 3;
export const SCHEDULE_CARD_HEIGHT = 229;
export const SCHEDULE_CHROME_HEIGHT = 516;
// 头像边框展示方式（群课表）：
//   progress 上课中用「剩余时长」进度环（满 → 空），其他状态用状态色实色边框
//   solid    所有状态都用状态色实色边框
//   off      恢复白色细边框（不展示状态色与进度）
export const AVATAR_BORDER_MODES = ['progress', 'solid', 'off'];
export const DEFAULT_AVATAR_BORDER_MODE = 'progress';
export class ConfigManager {
    /**
     * 获取用户配置（若不存在则从默认配置复制）
     * @returns {Object}
     */
    static getConfig() {
        const userFile = path.join(CONFIG_PATH, CONFIG_FILE)
        const defaultFile = path.join(DEFAULT_CONFIG_PATH, CONFIG_FILE)
        // 确保配置目录存在
        if (!fs.existsSync(CONFIG_PATH)) {
            fs.mkdirSync(CONFIG_PATH, { recursive: true })
        }
        // 如果用户配置不存在，复制默认配置
        if (!fs.existsSync(userFile) && fs.existsSync(defaultFile)) {
            fs.copyFileSync(defaultFile, userFile)
            logger.info('[Schedule-配置管理] 已初始化用户配置文件')
        }
        let config = {};
        try {
            const content = fs.readFileSync(userFile, 'utf8')
            config = YAML.parse(content) || {}
        } catch (err) {
            logger.error('[Schedule-配置管理] 读取配置失败:', err)
            config = {};
        }

        // 默认配置值
        const defaultConfig = {
            pushHour: 20,
            showTableName: true,
            autoRecallCode: false,
            renderScale: 1.0,         // 渲染精度
            renderRestartCount: 100,  // 渲染重启计数
            maxRenderRetry: 1,        // 最大重试次数
            renderTimeOut: 10000,     // 渲染超时时间（ms）
            renderer: "puppeteer",    // 图片渲染器: puppeteer 插件独立实例 / shotium 宿主共享引擎 / auto 自动选择
            autoCancelCheckEnabled: false,
            autoCancelCheckInterval: 60,
            // 调试模式：开启后会打印高频扫描等详细日志（默认关闭，避免刷屏）
            debugMode: false,
            // 上课提醒配置
            classReminderEnabled: false,   // 上课提醒功能总开关（管理员可全局禁用）
            classReminderScanInterval: 1,  // 上课提醒扫描间隔（分钟）
            // 生日配置
            birthdayPushHour: 0,        // 生日推送小时，默认0点
            allowSelfModify: true,       // 允许用户自行修改/重新设置生日
            birthdayWhitelistGroups: [],  // 推送白名单
            birthdayBlacklistGroups: [],   // 推送黑名单
            // WakeUp 服务配置
            wakeupServiceUrl: "https://wakeup.cpc.cn.eu.org/",  // WakeUp 服务基础URL
            wakeupApiEndpoint: "/parse",    // WakeUp API端点路径
            wakeupAuthType: "Bearer",       // WakeUp 鉴权方式: Bearer / X-Auth-Token / None
            wakeupAuthToken: "",         // WakeUp 服务鉴权 Token
            defaultSemesterStart: "2026-03-02",   // 新增：默认学期开始日期
            botName: "",    // bot自定义名称，默认取机器人昵称
            font: "像素",    // 字体风格，默认为像素字体
            // 群课表排序方式，userId：按QQ号；courseStatus：按上课状态；
            // timeDistance：先按状态分组（上课中/分身中/翘课中 → 未开始 → 其他），组内按距上/下课时间升序
            sortMode: "userId",
            scheduleColumns: 2,    // 群课表每行成员列数：'auto' 按人数自动加列，或固定 2/3/4
            avatarBorderMode: "progress",  // 群课表头像边框：progress 进度环 / solid 实色 / off 关闭
            hideEndedDays: 30,    // 群课表图片中隐藏学期已结束超过该天数的成员，0 表示不过滤
            showQQ: true,    // 生日列表是否展示QQ号。默认开启
            watchFiles: false,  // 监听所有文件以尝试自动导入课表，默认关闭
            urlImportEnabled: true,  // URL直链导入总开关
            birthdayCustomName: true  // 生日列表允许使用自定义昵称，关闭则同步QQ昵称
        };
        // 合并默认值（确保所有字段都有值）
        config = { ...defaultConfig, ...config };
        // 确保新增字段存在（防止旧配置没有这两个字段）
        if (!config.birthdayWhitelistGroups) config.birthdayWhitelistGroups = [];
        if (!config.birthdayBlacklistGroups) config.birthdayBlacklistGroups = [];
        if (config.wakeupServiceUrl === undefined) config.wakeupServiceUrl = "https://wakeup.cpc.cn.eu.org/";
        if (config.wakeupApiEndpoint === undefined) config.wakeupApiEndpoint = "/parse";
        if (config.wakeupAuthType === undefined) config.wakeupAuthType = "Bearer";
        if (config.wakeupAuthToken === undefined) config.wakeupAuthToken = "";
        // 上课提醒默认值兜底
        if (config.classReminderEnabled === undefined) config.classReminderEnabled = defaultConfig.classReminderEnabled;
        if (!config.classReminderScanInterval) config.classReminderScanInterval = defaultConfig.classReminderScanInterval;
        // 调试模式默认值兜底
        if (config.debugMode === undefined) config.debugMode = defaultConfig.debugMode;
        // 渲染器模式兜底：仅允许 puppeteer / shotium / auto
        if (!['puppeteer', 'shotium', 'auto'].includes(config.renderer)) config.renderer = defaultConfig.renderer;
        // 群课表排序模式兜底：仅允许 userId / courseStatus / timeDistance
        if (!['userId', 'courseStatus', 'timeDistance'].includes(config.sortMode)) config.sortMode = defaultConfig.sortMode;
        // 群课表列数兜底：支持 'auto'（按人数自动加列）与固定 2~4 列，非法值回落默认 2 列。
        // 统一存成字符串，便于 Guoba 单选组精确匹配选项值
        config.scheduleColumns = ConfigManager.normalizeColumnsSetting(config.scheduleColumns);
        // 头像边框展示方式兜底：仅允许 progress / solid / off
        config.avatarBorderMode = ConfigManager.normalizeAvatarBorderMode(config.avatarBorderMode);
        // 若 pushHour 为空（比如旧配置解析失败），则使用默认值
        if (!config.pushHour) {
            config.pushHour = defaultConfig.pushHour;
        }
        if (!config.birthdayPushHour) {
            config.birthdayPushHour = defaultConfig.birthdayPushHour;
        }
        // 动态生成 pushCron 字段，供其他模块调用
        config.pushCron = `0 ${config.pushHour} * * *`;
        config.birthdayPushCron = `0 ${config.birthdayPushHour} * * *`;
        return config;
    }
    /**
     * 标准化群课表列数：非法值回落默认 2 列，越界值夹到 [MIN_SCHEDULE_COLUMNS, MAX_SCHEDULE_COLUMNS]
     * @param {*} value 配置中的列数（可能是字符串/小数/undefined）
     * @returns {number} 可直接用于渲染的列数
     */
    static normalizeColumns(value) {
        const n = Number.parseInt(value, 10);
        if (!Number.isFinite(n)) return MIN_SCHEDULE_COLUMNS;
        return Math.min(MAX_SCHEDULE_COLUMNS, Math.max(MIN_SCHEDULE_COLUMNS, n));
    }
    /**
     * 标准化「列数设置」：支持 'auto' 与固定 2/3/4 列
     * 返回值统一为字符串，便于 Guoba 单选组（RadioGroup）精确匹配选项值
     * @param {*} value 配置中的 scheduleColumns
     * @returns {'auto'|'2'|'3'|'4'}
     */
    static normalizeColumnsSetting(value) {
        if (typeof value === 'string' && value.trim().toLowerCase() === 'auto') return 'auto';
        return String(ConfigManager.normalizeColumns(value));
    }
    /**
     * 标准化头像边框展示方式，非法值回落默认
     * @param {*} value 配置中的 avatarBorderMode
     * @returns {'progress'|'solid'|'off'}
     */
    static normalizeAvatarBorderMode(value) {
        const mode = typeof value === 'string' ? value.trim().toLowerCase() : '';
        return AVATAR_BORDER_MODES.includes(mode) ? mode : DEFAULT_AVATAR_BORDER_MODE;
    }
    /**
     * 解析单张卡片的头像边框展示方式
     * 全局关闭 → off；全局进度 + 该成员有进度（仅上课中）→ progress；其余 → solid（状态色实色）
     * @param {*} globalMode 配置中的 avatarBorderMode
     * @param {number|null|undefined} avatarProgress 该成员的剩余比例（非上课中为 null）
     * @returns {'progress'|'solid'|'off'}
     */
    static resolveAvatarBorderMode(globalMode, avatarProgress) {
        const mode = ConfigManager.normalizeAvatarBorderMode(globalMode);
        if (mode === 'off') return 'off';
        if (mode === 'progress' && Number.isFinite(avatarProgress)) return 'progress';
        return 'solid';
    }
    /**
     * 估算渲染后群课表图片的高度（用于「自动」列数的宽高比判定）
     * 高度 = 页头/统计/页脚/内边距 + 行数 × 单卡高度 + 行间距；
     * 列数不改变单卡尺寸（卡片宽度恒为 SCHEDULE_CARD_WIDTH），因此只有行数随列数变化
     * @param {number|string} columns 列数
     * @param {number} memberCount 成员数量
     * @returns {number} 估算高度（px）
     */
    static estimateScheduleImageHeight(columns, memberCount) {
        const cols = ConfigManager.normalizeColumns(columns);
        const count = Number.isFinite(Number(memberCount)) ? Math.max(0, Math.floor(Number(memberCount))) : 0;
        const rows = Math.max(1, Math.ceil(count / cols));
        return SCHEDULE_CHROME_HEIGHT + rows * SCHEDULE_CARD_HEIGHT + (rows - 1) * SCHEDULE_GRID_GAP;
    }
    /**
     * 解析出最终用于渲染的列数
     * - 固定列数：直接使用该列数
     * - 自动（'auto'）：在 2/3/4 列中选出「整图宽高比」最接近 SCHEDULE_TARGET_RATIO（2:3）的一档。
     *   距离用对数衡量（比例对称：偏宽 1.5 倍与偏窄 1.5 倍等价），距离相同时取更少列（图片更窄）
     * @param {*} setting 配置中的 scheduleColumns（'auto' / 2 / 3 / 4）
     * @param {number} memberCount 需要排版的成员数量
     * @returns {number} 实际列数（2~4）
     */
    static resolveScheduleColumns(setting, memberCount) {
        const normalized = ConfigManager.normalizeColumnsSetting(setting);
        if (normalized !== 'auto') return Number(normalized);
        const targetLog = Math.log(SCHEDULE_TARGET_RATIO);
        let best = MIN_SCHEDULE_COLUMNS;
        let bestDistance = Infinity;
        for (let cols = MIN_SCHEDULE_COLUMNS; cols <= MAX_SCHEDULE_COLUMNS; cols++) {
            const width = ConfigManager.resolveScheduleCanvasWidth(cols);
            const height = ConfigManager.estimateScheduleImageHeight(cols, memberCount);
            const distance = Math.abs(Math.log(width / height) - targetLog);
            // 严格更近才替换：距离相同时保留更少的列数（图片更窄，手机端缩放更友好）
            if (distance < bestDistance - 1e-9) {
                bestDistance = distance;
                best = cols;
            }
        }
        return best;
    }
    /**
     * 按列数计算群课表画布宽度
     * 画布随列数加宽而非压缩卡片：3 列约 1598px、4 列约 2116px，
     * 每张卡片宽度始终等于 2 列时的 502px，避免多列状态下字号/间距被迫缩小
     * @param {number|string} columns 列数（内部会先做标准化）
     * @returns {number} 画布宽度（px）
     */
    static resolveScheduleCanvasWidth(columns) {
        const cols = ConfigManager.normalizeColumns(columns);
        return SCHEDULE_SIDE_PADDING + cols * SCHEDULE_CARD_WIDTH + (cols - 1) * SCHEDULE_GRID_GAP;
    }
    /**
     * 标准化cron表达式，适配node-schedule
     * @param {string} cron 原始cron字符串
     * @returns {string} 标准化后的cron
     */
    static normalizeCron(cron) {
        if (!cron) return cron;
        cron = cron.trim();
        const parts = cron.split(/\s+/);
        // 如果超过6个字段（如7字段含年），只保留前6个
        if (parts.length > 6) {
            parts.length = 6;
            cron = parts.join(' ');
        }
        // 如果是5字段，补一个秒字段（默认0），使格式统一为6字段
        if (parts.length === 5) {
            cron = `0 ${cron}`;
        }
        return cron;
    }
    /**
     * 保存用户配置
     * @param {Object} data 
     */
    static setConfig(data) {
        const userFile = path.join(CONFIG_PATH, CONFIG_FILE)
        if (!fs.existsSync(CONFIG_PATH)) {
            fs.mkdirSync(CONFIG_PATH, { recursive: true })
        }
        // 仅提取需要保存的字段
        const {
            pushHour, showTableName, autoRecallCode,
            renderScale, renderRestartCount, maxRenderRetry, renderTimeOut, renderer,
            autoCancelCheckEnabled, autoCancelCheckInterval,
            classReminderEnabled, classReminderScanInterval,
            debugMode,
            birthdayPushHour, allowSelfModify,
            birthdayWhitelistGroups, birthdayBlacklistGroups,
            wakeupServiceUrl, wakeupApiEndpoint, wakeupAuthType, wakeupAuthToken,
            defaultSemesterStart,
            botName, font,
            sortMode, scheduleColumns, avatarBorderMode, hideEndedDays, showQQ,
            watchFiles, urlImportEnabled, birthdayCustomName
        } = data;
        const configToSave = {
            pushHour,
            showTableName,
            autoRecallCode,
            renderScale, renderRestartCount, maxRenderRetry, renderTimeOut,
            renderer,
            autoCancelCheckEnabled,
            autoCancelCheckInterval,
            classReminderEnabled, classReminderScanInterval,
            debugMode,
            birthdayPushHour, allowSelfModify,
            birthdayWhitelistGroups, birthdayBlacklistGroups,
            wakeupServiceUrl, wakeupApiEndpoint, wakeupAuthType, wakeupAuthToken,
            defaultSemesterStart,
            botName, font,
            sortMode, scheduleColumns, avatarBorderMode, hideEndedDays, showQQ,
            watchFiles, urlImportEnabled, birthdayCustomName
        };
        // 列数落库前同样标准化：'auto' 原样保存，数字则写成 number（YAML 更干净、可读）
        if (configToSave.scheduleColumns !== undefined) {
            const setting = ConfigManager.normalizeColumnsSetting(configToSave.scheduleColumns);
            configToSave.scheduleColumns = setting === 'auto' ? 'auto' : Number(setting);
        }
        // 过滤掉 undefined 的字段，避免写入 yaml 时出现空值
        Object.keys(configToSave).forEach(key => {
            if (configToSave[key] === undefined) {
                delete configToSave[key];
            }
        });
        fs.writeFileSync(userFile, YAML.stringify(configToSave), 'utf8')
        logger.info('[配置管理] 配置已保存')
    }
    /**
     * 局部更新配置并持久化（供管理员命令等运行时修改使用）
     * 读取当前配置 → 合并补丁 → 走 setConfig 的白名单与标准化后写回 yaml
     * @param {Object} patch 需要修改的字段，如 { avatarBorderMode: 'solid' }
     * @returns {Object} 更新后的完整配置（getConfig 结果）
     */
    static updateConfig(patch = {}) {
        ConfigManager.setConfig({ ...ConfigManager.getConfig(), ...patch })
        return ConfigManager.getConfig()
    }
}
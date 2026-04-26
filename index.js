import fs from 'node:fs';
import path from 'node:path'
import chalk from 'chalk';
import YAML from 'yaml';
import { watch } from 'node:fs';
import { createRequire } from 'node:module';
import { startSkipExpireScheduler } from './components/SkipExpireScheduler.js';
import { reloadSkipExpireScheduler } from './components/SkipExpireScheduler.js';
import { CONFIG_PATH, CONFIG_FILE } from './components/ConfigManager.js';
const require = createRequire(import.meta.url);
const pkg = require('./package.json');
let lastConfigContent = null;
logger.mark('┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
logger.mark('┃📅 课程表插件 载入中           ');
logger.mark('┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
logger.mark(`┃  版本: v${pkg.version}`);
logger.mark(`┃  作者: Temmie`);
logger.mark(`┃  项目地址: https://github.com/Temmie0125/Yunzai-Schedule-Plugin`);
logger.mark('┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

// 创建必要的数据目录
fs.mkdirSync('plugins/schedule/data', { recursive: true });

// 获取所有 .js 插件文件
const files = fs.readdirSync('./plugins/schedule/apps').filter(file => file.endsWith('.js'));

const loadPlugins = async () => {
    const importPromises = files.map(file => import(`./apps/${file}`));
    const results = await Promise.allSettled(importPromises);

    const apps = {};
    results.forEach((result, index) => {
        const name = files[index].replace('.js', '');
        if (result.status === 'fulfilled') {
            apps[name] = result.value[Object.keys(result.value)[0]];
        } else {
            logger.error(`载入插件错误：${logger.red(name)}`);
            logger.error(result.reason);
        }
    });
    // 启动翘课过期扫描定时器（内部自动防止重复启动）
    startSkipExpireScheduler();
    return apps;
};
// 定义全局事件总线
global.scheduleEvents = {
    listeners: new Set(),
    on(callback) {
        this.listeners.add(callback);
    },
    off(callback) {
        this.listeners.delete(callback);
    },
    emit(data) {
        for (const cb of this.listeners) {
            try {
                cb(data);
            } catch (err) {
                logger.error('[事件总线] 回调执行出错:', err);
            }
        }
    }
};
// 监听配置文件变化
function startConfigWatcher() {
    const configFile = path.join(CONFIG_PATH, CONFIG_FILE);
    if (!fs.existsSync(configFile)) return;

    // 初始化缓存
    try {
        lastConfigContent = fs.readFileSync(configFile, 'utf8');
    } catch (e) { /* ignore */ }

    let reloadTimer = null;
    watch(configFile, (eventType) => {
        if (eventType === 'change') {
            if (reloadTimer) clearTimeout(reloadTimer);
            reloadTimer = setTimeout(() => {
                let newContent;
                try {
                    newContent = fs.readFileSync(configFile, 'utf8');
                } catch (err) {
                    logger.error('[课程表插件] 读取配置文件失败:', err);
                    reloadTimer = null;
                    return;
                }
                // 内容完全相同则跳过
                if (newContent === lastConfigContent) {
                    logger.mark('[课程表插件] 配置文件内容未变化，跳过重载');
                    reloadTimer = null;
                    return;
                }
                // 进一步比较关键字段，防止仅空白/注释变化
                try {
                    const oldConfig = YAML.parse(lastConfigContent || '{}');
                    const newConfig = YAML.parse(newContent);
                    const keysToCompare = ['pushHour', 'birthdayPushHour', 'autoCancelCheckEnabled', 'autoCancelCheckInterval'];
                    let hasRealChange = false;
                    for (const key of keysToCompare) {
                        if (oldConfig[key] !== newConfig[key]) {
                            hasRealChange = true;
                            break;
                        }
                    }
                    if (!hasRealChange) {
                        logger.mark('[课程表插件] 关键配置字段未变化，跳过重载');
                        lastConfigContent = newContent; // 更新缓存
                        reloadTimer = null;
                        return;
                    }
                } catch (parseErr) {
                    logger.warn('[课程表插件] 配置解析失败，按变化处理', parseErr);
                }
                logger.info('[课程表插件] 检测到 schedule.yaml 实质性变化，触发重载事件');
                lastConfigContent = newContent;
                reloadSkipExpireScheduler();
                global.scheduleEvents.emit({ type: 'config-changed', file: configFile });
                reloadTimer = null;
            }, 500);
        }
    });
    logger.info('[课程表插件] 配置监听已启动，监听文件:', configFile);
}
export const apps = await loadPlugins();
// 在插件加载完成后启动监听
startConfigWatcher();
logger.mark(chalk.rgb(178, 233, 250)(`┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`));
logger.mark(chalk.rgb(0, 183, 240)(`┃  课程表插件 v${pkg.version} 载入成功~ ^_^♪`));
logger.mark(`┃  作者: @Temmie`);
logger.mark(chalk.rgb(0, 183, 240)(`┃  仓库地址：`))
logger.mark(`┃  https://github.com/Temmie0125/Yunzai-Schedule-Plugin`);
logger.mark(chalk.rgb(178, 233, 250)(`┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`));
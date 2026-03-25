import fs from 'node:fs';
import path from 'node:path'
import { watch } from 'node:fs';
import { createRequire } from 'node:module';
import { startSkipExpireScheduler } from './components/SkipExpireScheduler.js';
import { reloadSkipExpireScheduler } from './components/SkipExpireScheduler.js';
import { CONFIG_PATH, CONFIG_FILE } from './components/configManager.js'; // 需要从 configManager 导出路径
const require = createRequire(import.meta.url);
const pkg = require('./package.json');

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
    let reloadTimer = null;
    watch(configFile, (eventType) => {
        if (eventType === 'change') {
            if (reloadTimer) clearTimeout(reloadTimer);
            reloadTimer = setTimeout(() => {
                logger.info('[课程表插件] 检测到 schedule.yaml 变化，触发重载事件');
                // 先重载翘课定时器（原有的）
                reloadSkipExpireScheduler();
                // 再广播给其他模块
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
logger.mark('┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
logger.mark('┃✅ 课程表插件载入成功');
logger.mark('┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
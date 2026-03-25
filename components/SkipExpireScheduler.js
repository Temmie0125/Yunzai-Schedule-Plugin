/*
 * @Author: Temmie0125 1179755948@qq.com
 * @Date: 2026-03-25 16:56:23
 * @LastEditors: Temmie0125 1179755948@qq.com
 * @LastEditTime: 2026-03-25 17:18:37
 * @FilePath: \实验与作业e:\bot\Yunzai\plugins\schedule\components\SkipExpireScheduler.js
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
// components/SkipExpireScheduler.js
import { DataManager } from './DataManager.js';
import { ConfigManager } from './configManager.js';

// 使用全局对象存储定时器，避免模块重载时重复启动
let globalTimer = global.__schedule_skip_timer__ || null;

export function startSkipExpireScheduler() {
    // 如果已存在定时器，直接返回
    if (globalTimer) {
        logger.info('[翘课自动过期] 定时器已在运行，跳过启动');
        return globalTimer;
    }

    const config = ConfigManager.getConfig();
    const enabled = config.autoCancelCheckEnabled ?? true;
    if (!enabled) {
        logger.info('[翘课自动过期] 定时检查已禁用');
        return null;
    }

    const interval = (config.autoCancelCheckInterval ?? 60) * 60 * 1000; // 默认1小时
    globalTimer = setInterval(async () => {
        logger.info('[翘课自动过期] 开始扫描过期状态...');
        const allSkip = await DataManager.loadAllSkipStatus();
        let expiredCount = 0;
        for (const [userId, info] of Object.entries(allSkip)) {
            if (info.enabled && info.expireTime) {
                const now = new Date();
                if (now >= new Date(info.expireTime)) {
                    await DataManager.saveSkipStatus(userId, false);
                    expiredCount++;
                }
            }
        }
        logger.info(`[翘课自动过期] 扫描完成，清除 ${expiredCount} 个过期状态`);
    }, interval);

    // 存储到全局，供后续检查
    global.__schedule_skip_timer__ = globalTimer;
    logger.info(`[翘课自动过期] 定时器已启动，间隔 ${interval / 60000} 分钟`);
    return globalTimer;
}

export function stopSkipExpireScheduler() {
    if (globalTimer) {
        clearInterval(globalTimer);
        globalTimer = null;
        global.__schedule_skip_timer__ = null;
        logger.info('[翘课自动过期] 定时器已停止');
    }
}

/**
 * 重载定时器（先停止再启动）
 */
export async function reloadSkipExpireScheduler() {
    logger.info('[翘课自动过期] 正在重载...');
    stopSkipExpireScheduler();
    startSkipExpireScheduler();
}
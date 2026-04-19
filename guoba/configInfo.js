import { schemas } from "./schemas/index.js"
import { ConfigManager } from "../components/ConfigManager.js"
/**
 * 配置数据校验函数
 * @param {Object} data 待校验的配置数据
 * @returns {Object} 校验结果 { valid: boolean, message?: string }
 */
const validateConfig = (data) => {
    // 校验默认学期开始日期
    const semesterStart = data.defaultSemesterStart;
    if (!semesterStart) {
        logger.warn("[配置校验] 默认学期开始日期为空，请填写后重试");
        throw new Error("默认学期开始日期不能为空。");
    }
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(semesterStart)) {
        logger.warn(`[配置校验] 日期格式错误: ${semesterStart}，应为 YYYY-MM-DD`);
        throw new Error("日期格式必须为 YYYY-MM-DD。");
    }
    const parts = semesterStart.split('-');
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const day = parseInt(parts[2], 10);
    const testDate = new Date(year, month - 1, day);
    if (
        testDate.getFullYear() !== year ||
        testDate.getMonth() !== month - 1 ||
        testDate.getDate() !== day
    ) {
        logger.warn(`[配置校验] 无效日期: ${semesterStart}，请检查月份和日的组合`);
        throw new Error("输入的日期不存在，请检查月份和日的组合。");
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (testDate > today) {
        logger.warn(`[配置校验] 学期开始日期不能晚于当前日期: ${semesterStart} > ${today.toISOString().slice(0,10)}`);
        throw new Error("默认学期开始日期不能晚于当前日期，否则会导致周数计算错误。");
    }
    return true;
};

export default {
    schemas,
    getConfigData() {
        return ConfigManager.getConfig()
    },
    setConfigData(data, { Result }) {
        // 3. 在保存前调用校验函数
        validateConfig(data);
        // 校验通过，执行保存
        ConfigManager.setConfig(data);
        return Result.ok({}, "配置已保存");
    }
}
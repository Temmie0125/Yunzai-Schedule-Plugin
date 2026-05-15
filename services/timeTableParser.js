/**
 * 解析用户提交的时间表 JSON 数据，返回 Map<section, {start, end}>
 * @param {any} jsonData - 解析后的 JSON 对象
 * @returns {Map<number, {start: string, end: string}>}
 */
export function parseTimeTableJson(jsonData) {
    // 格式1（完整包装）：{ type: "timetable", data: { items: [...] } }
    // 格式2（拾光格式）：{ timeSlots: [...], courses: [...] } 中的 timeSlots
    // 格式3（直接items数组）：[{ section: 1, startHour: 8, ... }, ...]
    // 格式4（section映射对象）：{ "1": { start: "08:00", end: "08:45" }, ... }
    let timeSlotMap = new Map();

    if (jsonData.type === 'timetable' && jsonData.data && Array.isArray(jsonData.data.items)) {
        // 格式1：完整包装 { type: "timetable", data: { items: [...] } }
        for (const item of jsonData.data.items) {
            if (item.startHour !== undefined) {
                const start = `${String(item.startHour).padStart(2, '0')}:${String(item.startMinute || 0).padStart(2, '0')}`;
                const end = `${String(item.endHour).padStart(2, '0')}:${String(item.endMinute || 0).padStart(2, '0')}`;
                timeSlotMap.set(item.section, { start, end });
            } else if (item.startTime) {
                timeSlotMap.set(item.section, { start: item.startTime, end: item.endTime });
            }
        }
    }

    if (timeSlotMap.size === 0 && jsonData.timeSlots && Array.isArray(jsonData.timeSlots)) {
        // 格式2：拾光格式 timeSlots 数组
        for (const item of jsonData.timeSlots) {
            if (item.startTime && item.endTime) {
                timeSlotMap.set(item.number || item.section, { start: item.startTime, end: item.endTime });
            }
        }
    }

    if (timeSlotMap.size === 0 && Array.isArray(jsonData)) {
        // 格式3：直接数组
        if (jsonData.length > 0) {
            if (jsonData[0].startHour !== undefined) {
                for (const item of jsonData) {
                    const start = `${String(item.startHour).padStart(2, '0')}:${String(item.startMinute || 0).padStart(2, '0')}`;
                    const end = `${String(item.endHour).padStart(2, '0')}:${String(item.endMinute || 0).padStart(2, '0')}`;
                    timeSlotMap.set(item.section, { start, end });
                }
            } else if (jsonData[0].startTime !== undefined) {
                for (const item of jsonData) {
                    timeSlotMap.set(item.number || item.section, { start: item.startTime, end: item.endTime });
                }
            }
        }
    }

    if (timeSlotMap.size === 0 && jsonData.data && Array.isArray(jsonData.data)) {
        // data 作为数组（可能是 items 的别名）
        for (const item of jsonData.data) {
            if (item.startHour !== undefined) {
                const start = `${String(item.startHour).padStart(2, '0')}:${String(item.startMinute || 0).padStart(2, '0')}`;
                const end = `${String(item.endHour).padStart(2, '0')}:${String(item.endMinute || 0).padStart(2, '0')}`;
                timeSlotMap.set(item.section, { start, end });
            } else if (item.startTime) {
                timeSlotMap.set(item.number || item.section, { start: item.startTime, end: item.endTime });
            }
        }
    }

    if (timeSlotMap.size === 0 && typeof jsonData === 'object' && jsonData !== null) {
        // 格式4：尝试 { "1": { start: "08:00", end: "08:45" }, ... }
        let found = false;
        for (const [key, val] of Object.entries(jsonData)) {
            const section = parseInt(key);
            if (!isNaN(section) && val && typeof val === 'object' && val.start && val.end) {
                timeSlotMap.set(section, { start: val.start, end: val.end });
                found = true;
            }
        }
        if (!found) {
            // 也尝试 items 在顶层
            if (jsonData.items && Array.isArray(jsonData.items)) {
                for (const item of jsonData.items) {
                    if (item.startHour !== undefined) {
                        const start = `${String(item.startHour).padStart(2, '0')}:${String(item.startMinute || 0).padStart(2, '0')}`;
                        const end = `${String(item.endHour).padStart(2, '0')}:${String(item.endMinute || 0).padStart(2, '0')}`;
                        timeSlotMap.set(item.section, { start, end });
                    } else if (item.startTime) {
                        timeSlotMap.set(item.number || item.section, { start: item.startTime, end: item.endTime });
                    }
                }
            }
        }
    }
    if (timeSlotMap.size === 0) {
        return { success: false, reply: '未能从提供的数据中解析出有效的时间段信息，请检查 JSON 格式是否正确。\n时间表 JSON 可以从星链课表-右上角-上课时间-点击分享获取' }
    }
    return { success: true, timeSlotMap }
}
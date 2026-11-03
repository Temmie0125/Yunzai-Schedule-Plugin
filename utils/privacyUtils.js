// utils/privacyUtils.js
// 「所有人课表」（跨群聚合）的可见性与脱敏规则（纯函数，便于单测）
// - 权限三档：owner 仅 Bot 主人 / ownerAdmin Bot 主人+群管理（默认）/ everyone 所有人
// - 隐藏三档：everyone 所有人看到脱敏版 / nonMaster 非 Bot 主人脱敏（默认）/ off 不脱敏
// - 脱敏：头像高斯模糊 + 教室整行不可见（保留占位使卡片高度不变）+ 非本群群友昵称模糊
// 拿不到本群成员列表（私聊、官方 Bot 群成员缓存为空）时一律按「非本群」处理，隐私优先。

/** 权限可选项 */
export const ALL_SCHEDULE_PERMISSIONS = ['owner', 'ownerAdmin', 'everyone'];
export const DEFAULT_ALL_SCHEDULE_PERMISSION = 'ownerAdmin';
/** 隐藏策略可选项 */
export const ALL_SCHEDULE_PRIVACY_MODES = ['everyone', 'nonMaster', 'off'];
export const DEFAULT_ALL_SCHEDULE_PRIVACY = 'nonMaster';

/** 头像高斯模糊半径（px），头像 90px 时 8px 已无法辨认 */
export const AVATAR_BLUR_PX = 8;
/** 昵称模糊半径（px），配合 28px 字号可保留文字轮廓但无法阅读 */
export const NICKNAME_BLUR_PX = 4;

/**
 * 规范化「所有人课表」权限档位
 * @param {*} value 配置值
 * @returns {'owner'|'ownerAdmin'|'everyone'}
 */
export function normalizeAllSchedulePermission(value) {
    const mode = typeof value === 'string' ? value.trim() : '';
    return ALL_SCHEDULE_PERMISSIONS.includes(mode) ? mode : DEFAULT_ALL_SCHEDULE_PERMISSION;
}

/**
 * 规范化「所有人课表」隐藏策略
 * @param {*} value 配置值
 * @returns {'everyone'|'nonMaster'|'off'}
 */
export function normalizeAllSchedulePrivacy(value) {
    const mode = typeof value === 'string' ? value.trim() : '';
    return ALL_SCHEDULE_PRIVACY_MODES.includes(mode) ? mode : DEFAULT_ALL_SCHEDULE_PRIVACY;
}

/**
 * 判断当前用户能否使用「所有人课表」
 * @param {*} mode 配置的权限档位
 * @param {{isMaster?: boolean, isGroupManager?: boolean}} who 当前用户身份
 * @returns {boolean}
 */
export function canUseAllSchedule(mode, { isMaster = false, isGroupManager = false } = {}) {
    const normalized = normalizeAllSchedulePermission(mode);
    if (normalized === 'everyone') return true;
    if (isMaster) return true;
    if (normalized === 'owner') return false;
    // ownerAdmin：群主/管理员或 Bot 主人（主人已在上面放行）
    return !!isGroupManager;
}

/**
 * 判断本次渲染是否需要脱敏
 * @param {*} mode 配置的隐藏策略
 * @param {{isMaster?: boolean}} who 当前查看者身份
 * @returns {boolean}
 */
export function shouldHideAllScheduleInfo(mode, { isMaster = false } = {}) {
    const normalized = normalizeAllSchedulePrivacy(mode);
    if (normalized === 'off') return false;
    if (normalized === 'everyone') return true;
    // nonMaster：Bot 主人可看完整信息
    return !isMaster;
}

/**
 * 为成员列表打上脱敏标记（图像与文本降级共用同一份结果）
 * @param {Array} members 成员数据
 * @param {{hide?: boolean, memberIds?: Set<string>|Iterable<string>|null}} options
 *   hide：是否需要脱敏；memberIds：本群成员 ID 集合（拿不到时传 null/空 → 全部视为非本群）
 * @returns {Array} 浅拷贝后的成员数组，附带 blurAvatar / blurNickname / hideLocation
 */
export function applyAllSchedulePrivacy(members, { hide = false, memberIds = null } = {}) {
    const list = Array.isArray(members) ? members : [];
    if (!hide) {
        return list.map(member => ({
            ...member,
            blurAvatar: false,
            blurNickname: false,
            hideLocation: false
        }));
    }
    const ids = memberIds
        ? (memberIds instanceof Set ? memberIds : new Set(Array.from(memberIds, (id) => String(id))))
        : null;
    return list.map(member => {
        // 拿不到成员列表（私聊 / 官方 Bot 缓存为空）或不在列表内 → 按「非本群群友」处理
        const inGroup = ids ? ids.has(String(member.userId)) : false;
        return {
            ...member,
            blurAvatar: true,
            blurNickname: !inGroup,
            hideLocation: true
        };
    });
}

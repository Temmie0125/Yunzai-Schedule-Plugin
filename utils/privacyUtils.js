// utils/privacyUtils.js
// 「所有人课表」（跨群聚合）的可见性与脱敏规则（纯函数，便于单测）
// - 权限三档：owner 仅 Bot 主人 / ownerAdmin Bot 主人+群管理（默认）/ everyone 所有人
// - 隐藏三档：everyone 所有人看到脱敏版 / nonMaster 非 Bot 主人脱敏（默认）/ off 不脱敏
// - 脱敏：非本群群友的头像、昵称、教室（地点）一律高斯模糊；本群群友照常显示
// 拿不到本群成员列表（私聊、官方 Bot 群成员缓存为空）时一律按「非本群」处理，隐私优先。

/** 权限可选项 */
export const ALL_SCHEDULE_PERMISSIONS = ['owner', 'ownerAdmin', 'everyone'];
export const DEFAULT_ALL_SCHEDULE_PERMISSION = 'ownerAdmin';
/** 隐藏策略可选项 */
export const ALL_SCHEDULE_PRIVACY_MODES = ['everyone', 'nonMaster', 'off'];
export const DEFAULT_ALL_SCHEDULE_PRIVACY = 'nonMaster';

/** 权限档位的中文描述（帮助页展示用，必须与 canUseAllSchedule 的实际判定一致） */
const ALL_SCHEDULE_PERMISSION_LABELS = {
    owner: '仅 Bot 主人',
    ownerAdmin: 'Bot 主人或群管理员',
    everyone: '所有人（含私聊）'
};

/** 头像高斯模糊半径（px）：配合外层裁剪遮罩，模糊边缘不会透出边框底色、也不越界 */
export const AVATAR_BLUR_PX = 8;
/** 昵称模糊半径（px）：4px 仍能依稀辨认字形，8px 对 28px 字号已糊成色块 */
export const NICKNAME_BLUR_PX = 8;
/** 教室（地点）模糊半径（px）：与昵称同一档，只模糊文字本身、保留 📍 图标 */
export const LOCATION_BLUR_PX = 8;

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
 * @returns {Array} 浅拷贝后的成员数组，附带 blurAvatar / blurNickname / blurLocation
 */
export function applyAllSchedulePrivacy(members, { hide = false, memberIds = null } = {}) {
    const list = Array.isArray(members) ? members : [];
    if (!hide) {
        return list.map(member => ({
            ...member,
            blurAvatar: false,
            blurNickname: false,
            blurLocation: false
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
            // 头像、昵称、教室统一只对「非本群群友」高斯模糊：本群群友互相认识，
            // 这些信息在他们自己的群课表里本来就可见，照常显示即可
            blurAvatar: !inGroup,
            blurNickname: !inGroup,
            blurLocation: !inGroup
        };
    });
}

// ==================== 帮助页 / 导入提示用的文案 ====================

/**
 * 权限档位的中文描述
 * @param {*} value 配置中的 allSchedulePermission
 * @returns {string}
 */
export function describeAllSchedulePermission(value) {
    const normalized = normalizeAllSchedulePermission(value);
    return ALL_SCHEDULE_PERMISSION_LABELS[normalized]
        || ALL_SCHEDULE_PERMISSION_LABELS[DEFAULT_ALL_SCHEDULE_PERMISSION];
}

/** 「所有人课表」帮助条目的说明：跟随 Guoba 里配置的权限档位 */
export function buildAllScheduleHelpDesc(permission) {
    return `查看所有用户的上课状态，当前权限：${describeAllSchedulePermission(permission)}。也可使用 #全局课表`;
}

/**
 * 课表可见范围的完整说明（帮助页）
 * 重点提示的是「跨群可见」：自己上传的课表会被「所有人课表」跨群聚合，
 * 其他群的用户（能使用该命令的人）也可能看到，而不是本群内部互相查看
 */
export const SCHEDULE_VISIBILITY_TIP =
    '上传的课表可能被其他群的用户通过「所有人课表」（#全局课表）看到；' +
    '可见范围与头像/教室脱敏由 Bot 主配置（allSchedulePermission / allSchedulePrivacy）决定，如需调整可联系 Bot 主';

/** 课表可见范围的短提示（导入成功回复里追加一行，避免过度强调） */
export const SCHEDULE_VISIBILITY_TIP_SHORT =
    '课表可能被其他群用户通过 #全局课表 看到；可见范围与脱敏由 Bot 主配置，如需调整可联系 Bot 主';

/** 帮助页里「课表可见范围」条目的标题（用于去重） */
export const SCHEDULE_VISIBILITY_TIP_TITLE = '课表可见范围';

/** 匹配帮助页里的「所有人课表」条目 */
const ALL_SCHEDULE_TITLE_RE = /所有人(?:在)?上什么课|所有人课表/;

/**
 * 在导入成功的回复末尾追加课表可见范围的轻提示（幂等：已包含则不再追加）
 * @param {string} text
 * @returns {string}
 */
export function appendScheduleVisibilityTip(text) {
    if (typeof text !== 'string' || !text) return text;
    if (text.includes(SCHEDULE_VISIBILITY_TIP_SHORT)) return text;
    return `${text}\n\n🔒 ${SCHEDULE_VISIBILITY_TIP_SHORT}`;
}

/** 取该分组下一个可用的图标序号（沿用帮助页 1、2、3… 的数字序号风格） */
function nextHelpIcon(group) {
    const nums = (Array.isArray(group?.list) ? group.list : [])
        .map(item => Number(item?.icon))
        .filter(n => Number.isFinite(n));
    return nums.length ? Math.max(...nums) + 1 : (group?.list?.length || 0) + 1;
}

/**
 * 把「所有人课表」的当前权限与课表可见范围提示注入帮助数据：
 * - 权限说明随 Guoba 配置的 allSchedulePermission 实时变化，不再写死在 help.json 里；
 * - help.json 被用户自定义/缺失时也能补上这两条，且重复调用不会产生重复条目；
 * - 直接就地修改并返回 helpData（调用方通常就是本次渲染专用的数据副本）。
 * @param {object} helpData 帮助数据（{ groups: [{ group, list: [{icon,title,desc}] }] }）
 * @param {object} config 插件配置
 * @returns {object} 同一份 helpData
 */
export function applyAllScheduleHelpInfo(helpData, config = {}) {
    if (!helpData || !Array.isArray(helpData.groups)) return helpData;
    const groups = helpData.groups.filter(group => group && Array.isArray(group.list));
    if (groups.length === 0) return helpData;

    const findItem = (re) => {
        for (const group of groups) {
            const item = group.list.find(entry => re.test(String(entry?.title ?? '')));
            if (item) return { group, item };
        }
        return null;
    };
    // 新条目优先挂到「群互动」分组，没有该分组时挂到最后一组
    const hostingGroup = () =>
        groups.find(group => /群互动|互动/.test(String(group.group ?? ''))) || groups[groups.length - 1];
    const isAdminGroup = (group) => /管理员|管理命令/.test(String(group?.group ?? ''));

    // 1. 「所有人课表」：更新权限说明；旧版 help.json 把它放在「管理员命令」下时顺带挪到群互动
    const desc = buildAllScheduleHelpDesc(config.allSchedulePermission);
    const found = findItem(ALL_SCHEDULE_TITLE_RE);
    if (found) {
        found.item.desc = desc;
        if (isAdminGroup(found.group)) {
            const target = hostingGroup();
            if (target !== found.group) {
                found.group.list = found.group.list.filter(entry => entry !== found.item);
                found.item.icon = nextHelpIcon(target);
                target.list.push(found.item);
            }
        }
    } else {
        const group = hostingGroup();
        group.list.push({
            icon: nextHelpIcon(group),
            title: '所有人在上什么课',
            desc
        });
    }

    // 2. 课表可见范围提示：只补一条，避免刷屏
    if (!findItem(new RegExp(SCHEDULE_VISIBILITY_TIP_TITLE))) {
        const group = hostingGroup();
        group.list.push({
            icon: nextHelpIcon(group),
            title: SCHEDULE_VISIBILITY_TIP_TITLE,
            desc: SCHEDULE_VISIBILITY_TIP
        });
    }
    return helpData;
}

import type { AreaDefinition } from './model.ts';
import { BASE_MONSTER_HEALTH, BASE_PLAYER_STATS, CULTIVATION_REQUIREMENTS } from './balance.ts';

// 正式内容只接收已确认的配置。空值不会被临时数值替代。
export const CONTENT: {
  playerStats: typeof BASE_PLAYER_STATS;
  monsterHealth: typeof BASE_MONSTER_HEALTH;
  areas: readonly AreaDefinition[];
  cultivationRequirements: typeof CULTIVATION_REQUIREMENTS;
} = {
  playerStats: BASE_PLAYER_STATS,
  monsterHealth: BASE_MONSTER_HEALTH,
  areas: [],
  cultivationRequirements: CULTIVATION_REQUIREMENTS,
};

export const CONFIRMED_RULES = [
  { title: '刷怪获取修为', detail: '战斗采用纯自动攻击，进入游戏后自动开始；击败怪物获取修为，后续可掉落功法。' },
  { title: '双向战斗框架', detail: '双方互相攻击是已确认的战斗方向；当前先配置怪物生命，怪物攻击暂不加入数值。' },
  { title: '怪物生命', detail: '普通怪初始生命60，首领300，按怪物自身实力使用已确认的成长倍率。生命配置固定，玩家变强后回刷旧区域可更快击杀。' },
  { title: '初版敌怪与攻击', detail: '敌怪名称统一为[待编辑]。当前开放炼气一层实力的普通怪，生命60、击杀修为10；空手每秒自动攻击一次，击败后刷新相同配置并继续战斗。' },
  { title: '铜钱测试掉落', detail: '每次击败当前普通怪后独立进行20%掉落判定；成功时等概率获得2至5个铜钱，自动存入背包并在同一个格子累加数量。' },
  { title: '人物装备槽', detail: '背包左侧展示人物装备，角色位于中央，两侧从上到下对称排列头盔与胸甲、左右护腕、主副武器、左右靴。共8个空槽；右侧展示背包物品格子。' },
  { title: '背包分页', detail: '每页24个紧凑格子，满页时自动增加空白下一页，也可以主动进入下一页；翻页按钮在格子正下方居中。翻页只改变展示，物品位置与铜钱堆叠保持原规则。' },
  { title: '当前伤害结算', detail: '当前每次伤害直接使用角色攻击值，怪物暂不反击；防御等后续伤害机制另行确认。' },
  { title: '玩家持续回血', detail: '生命回复速率仅属于玩家，战斗、脱战和休整时均生效。' },
  { title: '基础属性与成长', detail: '初始生命100、攻击10、防御2、回血1点/秒。生命、攻击、防御和回血同境界首尾累计3倍，跨大境界再变为3倍；空手攻速固定为每秒1次，单次伤害沿用角色攻击值。' },
  { title: '战败后休整', detail: '玩家被击败后休整恢复生命，恢复后可继续挑战。' },
  { title: '区域刷怪', detail: '已解锁区域可持续刷怪；更高难度的区域需要清理更多普通怪，才能解锁首领。' },
  { title: '首领开启新区域', detail: '击败区域首领后开放下一级区域。首领为一次性，击败后不再出现，普通怪仍可刷取。' },
  { title: '功法装配', detail: '功法采用分类槽位；装配后提供被动属性加成，部分功法附带主动技能。' },
  { title: '小阶段直接突破', detail: '修为达到要求后，可以直接突破到下一个小阶段。' },
  { title: '阶段修为门槛', detail: '炼气一层升二层需100修为，各阶段数值已配置，完整门槛可在境界之路中查看。' },
  { title: '突破成功结算', detail: '成功突破扣除本阶段所需修为，溢出部分保留到下一阶段。' },
  { title: '普通怪修为参考', detail: '起始普通怪奖励参考为10修为，随怪物自身实力递增；具体区域和怪物资料待确认。' },
  { title: '大境界闭关突破', detail: '修为达标后闭关，等待数秒读条，再按当前概率判定。境界越高，基础成功率越低。' },
  { title: '突破失败可重试', detail: '闭关突破失败会扣除部分修为，修为重新达到要求后可再次尝试。' },
  { title: '筑基开启洞府', detail: '到达筑基期后解锁洞府及自动修炼，升级洞府可提高自动修炼的修为收益。' },
  { title: '后续扩展', detail: '后续增加丹药系统、其他世界及动画表现，具体内容待确认。' },
] as const;

export const PENDING_ITEMS = [
  { title: '装备与武器属性', detail: '装备槽位已暂定；装备资料、属性、掉落和穿戴规则待确认，后续根据装备的武器影响属性。', affects: '装备' },
  { title: '后续战斗规则', detail: '怪物攻击暂不配置；怪物防御、攻速及包含防御的伤害机制仍待确认。', affects: '战斗' },
  { title: '区域与首领', detail: '具体区域、清怪门槛、首领奖励及后续怪物配置。当前已开放初始普通怪。', affects: '历练' },
  { title: '闭关突破数据', detail: '闭关时长、各大境界成功率及失败扣除量。', affects: '突破' },
  { title: '功法分类与效果', detail: '具体类别与槽位数量、功法资料、掉落规则及主动技能机制。', affects: '功法' },
  { title: '洞府升级规则', detail: '自动修炼收益、升级条件与升级收益。', affects: '洞府' },
] as const;

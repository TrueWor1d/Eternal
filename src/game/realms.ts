export const REALMS = [
  { id: 'qi', name: '炼气期', stages: ['一层', '二层', '三层', '四层', '五层', '六层', '七层', '八层', '九层'] },
  { id: 'foundation', name: '筑基期', stages: ['初期', '中期', '后期', '圆满'] },
  { id: 'core', name: '金丹期', stages: ['初期', '中期', '后期', '圆满'] },
  { id: 'soul', name: '元婴期', stages: ['初期', '中期', '后期', '圆满'] },
  { id: 'spirit', name: '化神期', stages: ['初期', '中期', '后期', '圆满'] },
  { id: 'tribulation', name: '渡劫期', stages: ['初期', '中期', '后期', '圆满'] },
  { id: 'mahayana', name: '大乘期', stages: ['初期', '中期', '后期', '圆满'] },
] as const;

export type RealmId = (typeof REALMS)[number]['id'];
export interface Stage { realmId: RealmId; stageIndex: number }

export function getRealm(stage: Stage) {
  const realm = REALMS.find((item) => item.id === stage.realmId);
  if (!realm || !Number.isInteger(stage.stageIndex) || stage.stageIndex < 0 || stage.stageIndex >= realm.stages.length) {
    throw new RangeError('无效的境界阶段');
  }
  return realm;
}

export function stageLabel(stage: Stage): string {
  const realm = getRealm(stage);
  return `${realm.name} · ${realm.stages[stage.stageIndex]}`;
}

export function nextStage(stage: Stage): Stage | null {
  const realm = getRealm(stage);
  if (stage.stageIndex + 1 < realm.stages.length) return { ...stage, stageIndex: stage.stageIndex + 1 };
  const next = REALMS[REALMS.findIndex((item) => item.id === stage.realmId) + 1];
  return next ? { realmId: next.id, stageIndex: 0 } : null;
}

export function transitionKind(stage: Stage): 'minor' | 'major' | 'end' {
  const next = nextStage(stage);
  return next === null ? 'end' : next.realmId === stage.realmId ? 'minor' : 'major';
}

export function caveUnlocked(stage: Stage): boolean {
  getRealm(stage);
  return stage.realmId !== 'qi';
}

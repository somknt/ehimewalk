// 称号。条件はサーバー側で判定し、獲得済みの中から表示する称号を選べる。

export interface TitleStats {
  visitedSpotCount: number
  gachaDraws: number
  /** 直近 7 日間で目標を達成した日数 */
  goalDaysLast7: number
  ownedItemKinds: number
}

export interface TitleDefinition {
  titleId: string
  name: string
  condition: string
  isUnlocked: (stats: TitleStats) => boolean
}

export const DEFAULT_TITLE_ID = 'mikan_novice'

export const TITLES: readonly TitleDefinition[] = [
  { titleId: DEFAULT_TITLE_ID, name: 'みかん見習い', condition: 'はじめから', isUnlocked: () => true },
  { titleId: 'gacha_debut', name: 'ガチャデビュー', condition: 'ガチャを1回引く', isUnlocked: (s) => s.gachaDraws >= 1 },
  {
    titleId: 'steady_walker',
    name: 'コツコツ歩き',
    condition: '直近7日間で目標を3日達成',
    isUnlocked: (s) => s.goalDaysLast7 >= 3,
  },
  {
    titleId: 'first_journey',
    name: 'はじめての旅人',
    condition: '観光スポットに1か所チェックイン',
    isUnlocked: (s) => s.visitedSpotCount >= 1,
  },
  {
    titleId: 'ehime_explorer',
    name: '愛媛冒険家',
    condition: '観光スポットに3か所チェックイン',
    isUnlocked: (s) => s.visitedSpotCount >= 3,
  },
  {
    titleId: 'collector',
    name: 'おしゃれコレクター',
    condition: 'アイテムを10種類集める',
    isUnlocked: (s) => s.ownedItemKinds >= 10,
  },
]

export interface TitleStatus {
  titleId: string
  name: string
  condition: string
  unlocked: boolean
}

export function evaluateTitles(stats: TitleStats): TitleStatus[] {
  return TITLES.map(({ titleId, name, condition, isUnlocked }) => ({
    titleId,
    name,
    condition,
    unlocked: isUnlocked(stats),
  }))
}

export function titleName(titleId: string): string {
  return TITLES.find((title) => title.titleId === titleId)?.name ?? TITLES[0].name
}

/** 称号の名前から ID を探す（称号を名前で保存していた古いデータの移行用） */
export function titleIdFromName(name: string): string | undefined {
  return TITLES.find((title) => title.name === name)?.titleId
}

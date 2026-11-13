// みんな共通のクエスト。全員が同じクエストに挑戦し、達成したらコインを受け取れる。
// 達成の判定とコインの付与はサーバー側（フェーズ1 はモックサーバー）で行う。
// 過度な運動を促さないよう、毎日のクエストは健康日本21 の目標より低い歩数にしている。

/**
 * daily_steps：今日の歩数 / weekly_steps：今週の歩数
 * visit_spots：決められたスポットをすべて訪れる / community_steps：参加者みんなの今週の合計歩数
 */
export type CommonQuestKind = 'daily_steps' | 'weekly_steps' | 'visit_spots' | 'community_steps'
/** daily は毎日、weekly は毎週月曜にリセット。once は 1 回だけ */
export type QuestPeriod = 'daily' | 'weekly' | 'once'

export interface CommonQuest {
  questId: string
  title: string
  description: string
  kind: CommonQuestKind
  period: QuestPeriod
  /** 歩数の目標。visit_spots のときは spotIds の数 */
  target: number
  spotIds?: readonly string[]
  rewardCoins: number
  /** community_steps：報酬を受け取るのに必要な、自分の今週の歩数 */
  minContribution?: number
}

export const COMMON_QUESTS: readonly CommonQuest[] = [
  {
    questId: 'daily_3000',
    title: '今日の一歩',
    description: '今日 3,000 歩あるこう。体調に合わせて、無理のない範囲で。',
    kind: 'daily_steps',
    period: 'daily',
    target: 3_000,
    rewardCoins: 20,
  },
  {
    questId: 'weekly_30000',
    title: '今週のウォーキング',
    description: '今週（月曜から）合計 30,000 歩あるこう。1 日あたり約 4,300 歩です。',
    kind: 'weekly_steps',
    period: 'weekly',
    target: 30_000,
    rewardCoins: 100,
  },
  {
    questId: 'community_weekly',
    title: 'みんなで愛媛 50 万歩',
    description: '参加しているみんなの今週の歩数を合わせて 50 万歩をめざそう。自分が今週 1,000 歩以上歩いていれば報酬を受け取れます。',
    kind: 'community_steps',
    period: 'weekly',
    target: 500_000,
    rewardCoins: 50,
    minContribution: 1_000,
  },
  {
    questId: 'matsuyama_history',
    title: '松山 歴史めぐり',
    description: '松山城と道後温泉本館の両方を訪れよう。2 か所は歩いて約 40 分です。',
    kind: 'visit_spots',
    period: 'once',
    target: 2,
    spotIds: ['matsuyama_castle', 'dogo_onsen_honkan'],
    rewardCoins: 150,
  },
  {
    questId: 'ehime_first_step',
    title: '愛媛冒険の第一歩',
    description: '登録されている 3 つのスポットをすべて訪れよう。今治城は松山から電車やバスで行けます。',
    kind: 'visit_spots',
    period: 'once',
    target: 3,
    spotIds: ['matsuyama_castle', 'dogo_onsen_honkan', 'imabari_castle'],
    rewardCoins: 300,
  },
]

export function getCommonQuest(questId: string): CommonQuest | undefined {
  return COMMON_QUESTS.find((quest) => quest.questId === questId)
}

/** 受け取り済みかを記録するキー（期間ごとに 1 回） */
export function questClaimKey(quest: CommonQuest, periodKey: string): string {
  return `${quest.questId}:${periodKey}`
}

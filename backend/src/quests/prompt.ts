// Bedrock に渡す指示と、回答の形（ツールの JSON スキーマ）。
// 利用者の入力は選択肢の値だけで、自由な文章は AI に渡さない（指示の書き換え対策）。
// 利用者の現在地の座標は AI に渡さず、候補スポットまでの距離の目安だけを渡す。
import type { AiQuestPrompt } from './types'

/** 指示の内容を変えたら上げる（キャッシュのキーに含める） */
export const PROMPT_VERSION = '2'
export const QUEST_TOOL_NAME = 'propose_walking_quest'

export const LIMITS = { title: 40, description: 200, step: 200, maxSpots: 4 } as const

export const SYSTEM_PROMPT = [
  'あなたは愛媛県の散策クエストを提案するガイドです。',
  '必ず次の規則を守ってください。',
  '1. 訪問先は、利用者メッセージの「候補スポット」に書かれた spotId の中からだけ選ぶ。候補にない場所・店・施設を作ったり、名前を出したりしない。',
  '2. 説明には、候補スポットの description に書かれた事実だけを使い、言い換えにとどめる。書かれていない歴史・営業時間・料金・イベント・設備・評判を加えない。',
  '3. 「天守に上る」「入浴する」「食べる」など、description に書かれていない行動を勧めない。勧めてよい行動は「訪れる」「外から眺める」「説明を読む」程度にする。「〜の雰囲気を味わえます」のような、書かれていない感想や評価も加えない。',
  '4. 散策時間と歩行距離の上限を守る。出発地点からの距離の目安を参考にし、無理なら訪問先を減らす（1 か所でもよい）。',
  '5. 歩きながらのスマートフォン操作、立入禁止の場所、夜間や危険な場所への移動を勧めない。',
  `6. 日本語で書く。title は${LIMITS.title}文字以内、description と各 step の description は${LIMITS.step}文字以内。`,
  `7. 回答は必ずツール「${QUEST_TOOL_NAME}」で返す。`,
].join('\n')

export function buildUserMessage(prompt: AiQuestPrompt): string {
  const conditions = {
    出発地点: prompt.startLabel,
    散策時間の上限: `${prompt.minutes}分`,
    歩行距離の上限: prompt.maxDistanceKm === null ? '指定なし' : `${prompt.maxDistanceKm}km`,
    興味のあるジャンル: prompt.genreLabel,
    歩くペース: prompt.loadLabel,
  }
  const candidates = prompt.candidates.map((c) => ({
    spotId: c.spotId,
    name: c.name,
    municipality: c.municipality,
    tags: c.tags,
    description: c.description,
    出発地点からの距離の目安km: c.fromStartKm,
    ジャンルに合う: c.matchesGenre,
  }))
  return [
    '次の条件で、散策クエストを 1 つ提案してください。',
    `散策条件：${JSON.stringify(conditions)}`,
    `候補スポット（この spotId 以外は使わない）：${JSON.stringify(candidates)}`,
  ].join('\n')
}

/** AI に回答させる形（Converse API の toolConfig に入れる） */
export function questToolSchema(candidateIds: readonly string[]) {
  return {
    type: 'object',
    properties: {
      title: { type: 'string', description: `クエスト名（${LIMITS.title}文字以内）` },
      description: { type: 'string', description: `クエストの説明（${LIMITS.description}文字以内）` },
      estimatedMinutes: { type: 'integer', description: '見学を含めた所要時間の目安（分）' },
      spotIds: {
        type: 'array',
        description: '訪問する順の spotId（候補の中から 1〜4 個）',
        items: { type: 'string', enum: [...candidateIds] },
      },
      steps: {
        type: 'array',
        description: '訪問順の案内。spotIds と同じ順番',
        items: {
          type: 'object',
          properties: {
            spotId: { type: 'string', enum: [...candidateIds] },
            description: { type: 'string', description: `そのスポットでの案内（${LIMITS.step}文字以内）` },
          },
          required: ['spotId', 'description'],
        },
      },
    },
    required: ['title', 'description', 'estimatedMinutes', 'spotIds', 'steps'],
  }
}

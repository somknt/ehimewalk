// Bedrock を呼ばないモック。Bedrock と同じ形（ツールの入力と同じ JSON）を返すので、
// 検証・キャッシュ・回数制限などの処理を、料金をかけずに一通り確かめられる。
import type { AiQuestPrompt, AiUsage } from '../types'
import type { AiQuestProvider } from './types'

export class MockQuestProvider implements AiQuestProvider {
  readonly name = 'mock' as const
  readonly model = null
  private readonly delayMs: number

  /** delayMs：AI の待ち時間の再現（画面の読み込み表示を確かめるため） */
  constructor(options: { delayMs?: number } = {}) {
    this.delayMs = options.delayMs ?? 600
  }

  isConfigured(): boolean {
    return true
  }

  async generate(prompt: AiQuestPrompt): Promise<{ raw: unknown; usage: AiUsage }> {
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs))
    // ジャンルに合うものを優先して、近い順に 2 か所まで（距離の確認はサーバーの規則で行う）
    const picked = [...prompt.candidates]
      .sort((a, b) => Number(b.matchesGenre) - Number(a.matchesGenre) || a.fromStartKm - b.fromStartKm)
      .slice(0, 2)
    const first = picked[0]
    return {
      raw: {
        title: `${first.municipality}・${prompt.genreLabel}さんぽ`,
        description: `${prompt.startLabel}から${prompt.minutes}分以内で、${picked.map((c) => c.name).join('と')}をめぐるクエストです（モックの提案）。`,
        estimatedMinutes: prompt.minutes,
        spotIds: picked.map((c) => c.spotId),
        steps: picked.map((c) => ({ spotId: c.spotId, description: c.description })),
      },
      usage: { inputTokens: null, outputTokens: null },
    }
  }
}

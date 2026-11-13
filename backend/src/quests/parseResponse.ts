// AI の回答の検証。形が正しく、候補にあるスポットだけを使っている回答だけを採用する。
// 候補にない（未登録の）スポットが 1 つでも含まれていたら、回答全体を採用しない。
import { LIMITS } from './prompt'
import { QuestError, type AiQuestDraft } from './types'

const reject = (detail: string) => {
  const error = new QuestError('ai_invalid_response', 'AIの回答を確認できませんでした。もう一度お試しください。')
  // 理由はサーバーのログ用（画面には出さない）
  Object.defineProperty(error, 'detail', { value: detail })
  return error
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** 制御文字を除いて前後の空白を取る */
function cleanText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') throw reject(`${field} is not a string`)
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim()
  if (text.length === 0) throw reject(`${field} is empty`)
  // 少しの超過は許して切り詰め、大きく超える回答は指示に従っていないとみなす
  if ([...text].length > max * 2) throw reject(`${field} is too long`)
  return [...text].slice(0, max).join('')
}

/**
 * テキストの回答から JSON を取り出す（ツールで返さなかったモデルのための予備）。
 * 最初の { から最後の } までを JSON として読む
 */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw reject('no json object in text')
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    throw reject('invalid json')
  }
}

export function validateAiQuest(raw: unknown, candidateIds: ReadonlySet<string>): AiQuestDraft {
  if (!isObject(raw)) throw reject('not an object')

  const title = cleanText(raw.title, 'title', LIMITS.title)
  const description = cleanText(raw.description, 'description', LIMITS.description)

  const minutes = raw.estimatedMinutes
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < 1 || minutes > 600) {
    throw reject('estimatedMinutes out of range')
  }

  if (!Array.isArray(raw.spotIds) || raw.spotIds.length === 0 || raw.spotIds.length > LIMITS.maxSpots) {
    throw reject('spotIds length')
  }
  const spotIds: string[] = []
  for (const id of raw.spotIds) {
    if (typeof id !== 'string' || !candidateIds.has(id)) throw reject('unregistered spot id')
    if (spotIds.includes(id)) throw reject('duplicate spot id')
    spotIds.push(id)
  }

  if (!Array.isArray(raw.steps)) throw reject('steps is not an array')
  const steps: AiQuestDraft['steps'] = []
  for (const step of raw.steps) {
    if (!isObject(step) || typeof step.spotId !== 'string') throw reject('invalid step')
    // 案内にも未登録のスポットを含めない
    if (!candidateIds.has(step.spotId) || !spotIds.includes(step.spotId)) throw reject('step uses unknown spot id')
    if (steps.some((s) => s.spotId === step.spotId)) continue
    steps.push({ spotId: step.spotId, description: cleanText(step.description, 'step.description', LIMITS.step) })
  }

  return { title, description, estimatedMinutes: Math.round(minutes), spotIds, steps }
}

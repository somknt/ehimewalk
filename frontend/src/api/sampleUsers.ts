// ランキング表示を確認するための架空のサンプルユーザー。実在の人物ではない。
// 画面には「サンプル」と表示し、フェーズ2 で実際のユーザーに置き換える。
import { ITEMS, NORMAL_GACHA_POOL, STARTER_EQUIPMENT } from '../data/items'
import type { Character, EquipSlot, EyeColorId, HairColorId, HairStyleId, SkinToneId } from '../domain/types'
import { TITLES } from '../domain/titles'

export interface SampleUser {
  userId: string
  username: string
  character: Character
  titleName: string
  ehimeOptIn: boolean
  isFriend: boolean
}

const NAMES = [
  'みかん太郎', 'せとうちさんぽ', 'いよかん姫', 'しまなみライダー', 'どうごの湯', 'ぼっちゃん',
  'てくてく松山', 'うわじまっこ', 'いしづち登山部', 'たいめし好き', 'かんきつ博士', 'あさ散歩の人',
  'ゆったり歩き', 'にいはまの星', 'おおずの朝霧', 'ないこ', 'みかんジュース党', 'しまの風',
  'さくら坂', 'くるしまブルー',
]

const HAIR_STYLES: HairStyleId[] = ['short', 'bob', 'long']
const HAIR_COLORS: HairColorId[] = ['black', 'brown', 'mikan', 'blonde', 'seto', 'pink']
const SKIN_TONES: SkinToneId[] = ['light', 'medium', 'tan', 'deep']
const EYE_COLORS: EyeColorId[] = ['brown', 'black', 'blue', 'green']

/** 文字列から決まる疑似乱数（0 以上 1 未満） */
export function seeded(seed: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  let t = (hash + 0x6d2b79f5) >>> 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const pick = <T,>(list: readonly T[], seed: string): T => list[Math.floor(seeded(seed) * list.length)]

function sampleEquipment(seed: string): Partial<Record<EquipSlot, string>> {
  const equipped: Partial<Record<EquipSlot, string>> = { ...STARTER_EQUIPMENT }
  // ガチャのアイテムをいくつか装備させる
  for (let i = 0; i < 3; i++) {
    const item = ITEMS.get(pick(NORMAL_GACHA_POOL, `${seed}:item${i}`).itemId)
    if (item) equipped[item.category] = item.itemId
  }
  return equipped
}

export const SAMPLE_USERS: readonly SampleUser[] = NAMES.map((username, i) => {
  const seed = `sample-${i}`
  return {
    userId: `sample-${i}`,
    username,
    character: {
      name: username,
      appearance: {
        hairStyle: pick(HAIR_STYLES, `${seed}:hs`),
        hairColor: pick(HAIR_COLORS, `${seed}:hc`),
        skinTone: pick(SKIN_TONES, `${seed}:sk`),
        eyeColor: pick(EYE_COLORS, `${seed}:ey`),
      },
      equipped: sampleEquipment(seed),
    },
    titleName: pick(TITLES, `${seed}:title`).name,
    ehimeOptIn: seeded(`${seed}:pref`) < 0.7,
    isFriend: i % 4 === 1,
  }
})

/** その週の週間歩数（15,000〜75,000 歩程度） */
export function sampleWeeklySteps(userId: string, weekStart: string, daysElapsed: number): number {
  const perDay = 2500 + seeded(`${userId}:${weekStart}`) * 8000
  return Math.round(perDay * daysElapsed)
}

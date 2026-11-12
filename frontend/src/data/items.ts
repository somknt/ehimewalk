// アイテムのマスタデータ。フェーズ2 で DynamoDB（ewq-master）へ移す。
// 実在のキャラクター・商標（例：みきゃん）は、利用許諾を確認するまで使わない。
import type { PixelLayer } from '../components/PixelArt'
import { validateDuplicateCoins, validatePool, type GachaRates } from '../domain/gacha'
import { GACHA_COST } from '../domain/points'
import type { EquipSlot, ItemAcquisitionType, Rarity } from '../domain/types'
import {
  BOTTOM_OFFSET_Y,
  BOTTOM_PANTS_ROWS,
  BOTTOM_SKIRT_ROWS,
  OUTLINE,
  SHOES_OFFSET_Y,
  SHOES_ROWS,
  TOP_OFFSET_Y,
  TOP_SHIRT_ROWS,
  outfitLayer,
} from '../features/character/sprites'

export type ItemVisual =
  /** 体に重ねる衣装。back は体の後ろに描く（マントなど） */
  | { kind: 'outfit'; front: PixelLayer; back?: PixelLayer }
  /** 背景（CSS の background 値） */
  | { kind: 'background'; css: string }
  /** キャラクターの横に描くペット（8 × 8） */
  | { kind: 'pet'; sprite: PixelLayer }

export interface ItemMaster {
  itemId: string
  name: string
  category: EquipSlot
  rarity: Rarity
  acquisitionType: ItemAcquisitionType
  description: string
  visual: ItemVisual
}

const MIKAN = '#f39800'
const MIKAN_LIGHT = '#ffd27a'
const LEAF = '#4caf50'
const STEM = '#6b4220'
const GOLD = '#f2c14e'
const GOLD_DARK = '#c99a2e'

const items: ItemMaster[] = [
  // ---- 初期装備 ----
  {
    itemId: 'top_adventure_tee',
    name: 'ぼうけんTシャツ',
    category: 'top',
    rarity: 'N',
    acquisitionType: 'starter',
    description: '瀬戸内の海の色をしたTシャツ。冒険はここから。',
    visual: { kind: 'outfit', front: outfitLayer(TOP_SHIRT_ROWS, TOP_OFFSET_Y, { T: '#4cc3d9', t: '#2a8fa3' }) },
  },
  {
    itemId: 'bottom_denim',
    name: 'デニムパンツ',
    category: 'bottom',
    rarity: 'N',
    acquisitionType: 'starter',
    description: '歩きやすいデニム。',
    visual: { kind: 'outfit', front: outfitLayer(BOTTOM_PANTS_ROWS, BOTTOM_OFFSET_Y, { B: '#3a5a8c' }) },
  },
  {
    itemId: 'shoes_travel_boots',
    name: '旅のブーツ',
    category: 'shoes',
    rarity: 'N',
    acquisitionType: 'starter',
    description: 'どこまでも歩ける丈夫なブーツ。',
    visual: { kind: 'outfit', front: outfitLayer(SHOES_ROWS, SHOES_OFFSET_Y, { K: '#7a4a2a' }) },
  },
  {
    itemId: 'bg_seto_sea',
    name: '瀬戸内の海',
    category: 'background',
    rarity: 'N',
    acquisitionType: 'starter',
    description: 'おだやかな瀬戸内海と青い空。',
    visual: {
      kind: 'background',
      css: 'linear-gradient(180deg, #bfeefa 0%, #e8fbff 58%, #6fd3e6 58%, #4cc3d9 72%, #2aa5bd 100%)',
    },
  },

  // ---- ガチャ ----
  {
    itemId: 'top_traveler',
    name: '旅人の服',
    category: 'top',
    rarity: 'N',
    acquisitionType: 'gacha',
    description: '遍路道も似合いそうな、落ち着いた色の服。',
    visual: { kind: 'outfit', front: outfitLayer(TOP_SHIRT_ROWS, TOP_OFFSET_Y, { T: '#9b6a3c', t: '#6b4220' }) },
  },
  {
    itemId: 'top_mikan_tee',
    name: 'みかん色のTシャツ',
    category: 'top',
    rarity: 'N',
    acquisitionType: 'gacha',
    description: '愛媛のみかんみたいに元気な色。',
    visual: { kind: 'outfit', front: outfitLayer(TOP_SHIRT_ROWS, TOP_OFFSET_Y, { T: MIKAN, t: '#c46f00' }) },
  },
  {
    itemId: 'bottom_seto_skirt',
    name: '瀬戸内スカート',
    category: 'bottom',
    rarity: 'N',
    acquisitionType: 'gacha',
    description: '波のように軽やかなスカート。',
    visual: {
      kind: 'outfit',
      front: outfitLayer(BOTTOM_SKIRT_ROWS, BOTTOM_OFFSET_Y, { B: '#4cc3d9', b: '#2a8fa3' }),
    },
  },
  {
    itemId: 'shoes_mikan_sneakers',
    name: 'みかんスニーカー',
    category: 'shoes',
    rarity: 'R',
    acquisitionType: 'gacha',
    description: '足取りが軽くなる（気がする）スニーカー。',
    visual: { kind: 'outfit', front: outfitLayer(SHOES_ROWS, SHOES_OFFSET_Y, { K: MIKAN }) },
  },
  {
    itemId: 'head_mikan_hat',
    name: 'みかん帽子',
    category: 'head',
    rarity: 'R',
    acquisitionType: 'gacha',
    description: 'まるいみかんの帽子。葉っぱつき。',
    visual: {
      kind: 'outfit',
      front: outfitLayer(
        [
          '.......GL.......',
          '.....OOOOOO.....',
          '...OOAAAAAAOO...',
          '..OAAAaAAAAAAO..',
          '..OAAAAAAAAAAO..',
          '..OOOOOOOOOOOO..',
        ],
        0,
        { A: MIKAN, a: MIKAN_LIGHT, L: LEAF, G: STEM },
      ),
    },
  },
  {
    itemId: 'accessory_mikan_pendant',
    name: 'みかん型ペンダント',
    category: 'accessory',
    rarity: 'R',
    acquisitionType: 'gacha',
    description: '胸元で光る小さなみかん。',
    visual: {
      kind: 'outfit',
      front: outfitLayer(['.......L........', '.......AA.......', '.......AA.......'], 14, { A: MIKAN, L: LEAF }),
    },
  },
  {
    itemId: 'bg_mikan_field',
    name: 'みかん畑',
    category: 'background',
    rarity: 'R',
    acquisitionType: 'gacha',
    description: '段々畑にみかんが実る、愛媛の秋の景色。',
    visual: {
      kind: 'background',
      css: [
        'radial-gradient(circle at 18% 72%, #f39800 0 5px, transparent 6px)',
        'radial-gradient(circle at 42% 82%, #f39800 0 5px, transparent 6px)',
        'radial-gradient(circle at 70% 70%, #f39800 0 5px, transparent 6px)',
        'radial-gradient(circle at 86% 86%, #f39800 0 5px, transparent 6px)',
        'linear-gradient(180deg, #fff3d6 0%, #fff3d6 55%, #86c988 55%, #4caf50 100%)',
      ].join(', '),
    },
  },
  {
    itemId: 'top_starry_cape',
    name: '星空のマント',
    category: 'top',
    rarity: 'SR',
    acquisitionType: 'gacha',
    description: '石鎚山から見上げた夜空のようなマント。',
    visual: {
      kind: 'outfit',
      front: outfitLayer(
        ['...OOTTSSTTOO...', '..OTOTYTTTTOTO..', '..OTOTTTTYTOTO..', '..OtOTYTTTTOtO..', '....OttttttO....'],
        TOP_OFFSET_Y,
        { T: '#2b3a67', t: '#1d274a', Y: '#ffe27a' },
      ),
      back: outfitLayer(
        [
          '..OOOOOOOOOOOO..',
          '.OTTTTTTTTTTTTO.',
          '.OTYTTTTTTTTTTO.',
          '.OTTTTTTTTTTYTO.',
          '.OTTTTTTTTTTTTO.',
          '.OTTYTTTTTTTTTO.',
          '.OTTTTTTTTTTTTO.',
          '..OOOOOOOOOOOO..',
        ],
        TOP_OFFSET_Y,
        { T: '#2b3a67', Y: '#ffe27a' },
      ),
    },
  },
  {
    itemId: 'pet_koromikan',
    name: 'ころみかん',
    category: 'pet',
    rarity: 'SR',
    acquisitionType: 'gacha',
    description: 'ころころ転がってついてくる、みかんの妖精。',
    visual: {
      kind: 'pet',
      sprite: {
        rows: ['...GL...', '..OOOO..', '.OAAAAO.', 'OAaAAAAO', 'OAEAAEAO', 'OAAAAAAO', '.OAAAAO.', '..OOOO..'],
        palette: { O: OUTLINE, A: MIKAN, a: MIKAN_LIGHT, E: OUTLINE, L: LEAF, G: STEM },
      },
    },
  },
  {
    itemId: 'top_golden_haori',
    name: '黄金みかんの羽織',
    category: 'top',
    rarity: 'SSR',
    acquisitionType: 'gacha',
    description: 'きらきら輝く、伝説のみかん色の羽織。',
    visual: {
      kind: 'outfit',
      front: outfitLayer(
        ['...OOGGSSGGOO...', '..OGOGAGGAGOGO..', '..OGOGGAAGGOGO..', '..OgOGGGGGGOgO..', '....OggggggO....'],
        TOP_OFFSET_Y,
        { G: GOLD, g: GOLD_DARK, A: MIKAN },
      ),
      back: outfitLayer(
        [
          '..OOOOOOOOOOOO..',
          '.OGGGGGGGGGGGGO.',
          '.OGGGGGGGGGGGGO.',
          '.OaaaaaaaaaaaaO.',
          '.OaaaaaaaaaaaaO.',
          '.OggggggggggggO.',
          '.OggggggggggggO.',
          '..OOOOOOOOOOOO..',
        ],
        TOP_OFFSET_Y,
        { G: GOLD, a: MIKAN_LIGHT, g: GOLD_DARK },
      ),
    },
  },
  {
    itemId: 'head_golden_crown',
    name: '黄金みかんの冠',
    category: 'head',
    rarity: 'SSR',
    acquisitionType: 'gacha',
    description: 'みかんの王様だけがかぶれる冠。',
    visual: {
      kind: 'outfit',
      front: outfitLayer(
        ['.......LL.......', '...Y...AA...Y...', '...YO.OAAO.OY...', '...OYOYAAYOYO...', '...OYYYYYYYYO...', '...OOOOOOOOOO...'],
        0,
        { Y: GOLD, A: MIKAN, L: LEAF },
      ),
    },
  },

  // ---- 地域限定（スポットのチェックインで獲得） ----
  {
    itemId: 'head_castle_kabuto',
    name: '城主の兜',
    category: 'head',
    rarity: 'SR',
    acquisitionType: 'spot',
    description: '松山城を訪れた人だけがかぶれる兜。',
    visual: {
      kind: 'outfit',
      front: outfitLayer(
        [
          '...Y........Y...',
          '....Y......Y....',
          '.....Y.YY.Y.....',
          '....OOOOOOOO....',
          '...OKKKKKKKKO...',
          '..OKKKKKKKKKKO..',
          '.OKKKOOOOOOKKKO.',
          '.OKKO......OKKO.',
        ],
        0,
        { K: '#3a3f58', Y: '#e9b949' },
      ),
    },
  },
  {
    itemId: 'top_onsen_yukata',
    name: '温泉浴衣',
    category: 'top',
    rarity: 'SR',
    acquisitionType: 'spot',
    description: '道後温泉本館を訪れた記念の浴衣。',
    visual: {
      kind: 'outfit',
      front: outfitLayer(
        ['...OOTtSStTOO...', '..OTOTTtTTTOTO..', '..OTOTTTtTTOTO..', '..OTOAAAAAAOTO..', '....OTTTTTTO....'],
        TOP_OFFSET_Y,
        { T: '#eef4fb', t: '#2a6fb0', A: '#b8324a' },
      ),
    },
  },
  {
    itemId: 'head_pirate_hat',
    name: '海賊風の帽子',
    category: 'head',
    rarity: 'SR',
    acquisitionType: 'spot',
    description: '海城・今治城を訪れた記念の帽子。',
    visual: {
      kind: 'outfit',
      front: outfitLayer(
        [
          '......OOOO......',
          '....OOKKKKOO....',
          '...OKKKKKKKKO...',
          '.OOKKKKWWKKKKOO.',
          'OKKKKKKKKKKKKKKO',
          '.OOOOOOOOOOOOOO.',
        ],
        1,
        { K: '#2f2a33', W: '#f5f0e6' },
      ),
    },
  },
]

export const ITEMS: ReadonlyMap<string, ItemMaster> = new Map(items.map((item) => [item.itemId, item]))

export function getItem(itemId: string | undefined): ItemMaster | undefined {
  return itemId ? ITEMS.get(itemId) : undefined
}

export const STARTER_EQUIPMENT: Partial<Record<EquipSlot, string>> = {
  top: 'top_adventure_tee',
  bottom: 'bottom_denim',
  shoes: 'shoes_travel_boots',
  background: 'bg_seto_sea',
}

export const RARITY_LABELS: Record<Rarity, string> = {
  N: 'ノーマル',
  R: 'レア',
  SR: 'スーパーレア',
  SSR: 'ウルトラレア',
}

/** 通常ガチャの排出確率（合計 1）。画面にもこの値を表示する */
export const NORMAL_GACHA_RATES: GachaRates = { N: 0.6, R: 0.3, SR: 0.09, SSR: 0.01 }

/**
 * 持っているアイテムが出たときに変換するコイン（レア度別）。
 * 仮の設定値。ゲームバランスを確認して調整する（ガチャ 1 回のコイン以下にする）
 */
export const GACHA_DUPLICATE_COINS: Record<Rarity, number> = { N: 5, R: 15, SR: 30, SSR: 50 }

/** 通常ガチャの対象アイテム（初期衣装と地域限定は出ない） */
export const NORMAL_GACHA_POOL: readonly ItemMaster[] = items.filter((item) => item.acquisitionType === 'gacha')

/** ガチャの候補として使える形（domain/gacha の drawItem に渡す） */
export const NORMAL_GACHA_CANDIDATES = NORMAL_GACHA_POOL.map((item) => ({ itemId: item.itemId, rarity: item.rarity }))

// 確率の合計や、確率のあるレアリティに候補があるか、変換コインが正しいかを読み込み時に確かめる
validatePool(NORMAL_GACHA_CANDIDATES, NORMAL_GACHA_RATES)
validateDuplicateCoins(GACHA_DUPLICATE_COINS, GACHA_COST)

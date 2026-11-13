// 観光スポットのマスタデータ。説明は情報源を確認したうえで要約して登録する（docs/evidence.md）。
// 座標はチェックイン判定に使うため、誰でも安全に立ち入れる公開エリアに置く。
// 地域は全国地方公共団体コードで表し、他の市町・他県のデータを追加できるようにしている。
import type { TouristSpot } from '../domain/types'

export const EHIME_PREFECTURE_CODE = '38'

export const SPOTS: readonly TouristSpot[] = [
  {
    spotId: 'matsuyama_castle',
    name: '松山城',
    prefectureCode: EHIME_PREFECTURE_CODE,
    municipalityCode: '38201',
    municipality: '松山市',
    address: '愛媛県松山市丸之内1',
    latitude: 33.8456,
    longitude: 132.7656,
    checkinRadiusM: 150,
    kind: 'landmark',
    tags: ['歴史', '城', '絶景'],
    description:
      '松山市の中心部、標高132mの勝山の山頂に本丸を置く平山城です。江戸時代までに建てられた天守が今も残る全国12城（現存12天守）の一つです。',
    guide: {
      history: '加藤嘉明が勝山の山頂に城を築いたのが始まりで、「松山」という地名も嘉明の命名とされています。',
      culture: '天守は親藩の松平家が建てたもので、現存12天守の中で唯一、瓦に「葵の御紋」が付いています。',
    },
    rewardItemId: 'head_castle_kabuto',
    nearbySpotIds: ['dogo_onsen_honkan'],
    sources: [
      {
        label: '松山市公式ホームページ「松山城総合案内」',
        url: 'https://www.city.matsuyama.ehime.jp/kanko/kankoguide/shitestukoen/matsuyamajyo/sougouannnai.html',
      },
      { label: '松山城公式サイト「観覧ガイド」', url: 'https://www.matsuyamajo.jp/guide/' },
      { label: '松山城公式サイト「天守」', url: 'https://www.matsuyamajo.jp/discover/tenshu.html' },
      { label: 'nippon.com「日本100名城 愛媛県・松山城」', url: 'https://www.nippon.com/ja/guide-to-japan/castle00138081/' },
    ],
  },
  {
    spotId: 'dogo_onsen_honkan',
    name: '道後温泉本館',
    prefectureCode: EHIME_PREFECTURE_CODE,
    municipalityCode: '38201',
    municipality: '松山市',
    address: '愛媛県松山市道後湯之町5-6',
    latitude: 33.852,
    longitude: 132.7864,
    checkinRadiusM: 100,
    kind: 'culture',
    tags: ['温泉', '歴史', '文化'],
    description:
      '日本最古といわれる道後温泉のシンボルです。明治27年に改築された建物で、平成6年に公衆浴場として初めて国の重要文化財に指定されました。',
    guide: {
      history:
        '道後温泉は約3000年の歴史を持つといわれます。本館は平成31年1月から保存修理工事が行われ、令和6年12月に完了しました。',
      culture: '夏目漱石の小説『坊っちゃん』に登場する温泉としても知られています。',
    },
    rewardItemId: 'top_onsen_yukata',
    nearbySpotIds: ['matsuyama_castle'],
    sources: [
      { label: '道後温泉 公式サイト', url: 'https://dogo.jp/' },
      { label: '道後温泉 公式サイト「道後温泉本館」', url: 'https://dogo.jp/onsen/honkan' },
      { label: 'nippon.com「入湯できる国重要文化財『道後温泉本館』」', url: 'https://www.nippon.com/ja/guide-to-japan/gu900285/' },
    ],
  },
  {
    spotId: 'imabari_castle',
    name: '今治城',
    prefectureCode: EHIME_PREFECTURE_CODE,
    municipalityCode: '38202',
    municipality: '今治市',
    address: '愛媛県今治市通町3-1-3',
    latitude: 34.0656,
    longitude: 133.0054,
    checkinRadiusM: 150,
    kind: 'landmark',
    tags: ['歴史', '城', '海'],
    description:
      '築城の名手・藤堂高虎が築いた海岸平城です。全国的にも珍しく、堀に海水を引き入れています。別名は吹揚城（ふきあげじょう）です。',
    guide: {
      history: '慶長7年（1602年）に藤堂高虎が築城に着手しました。平成19年には鉄御門（くろがねごもん）が再建されています。',
      culture: '5層6階の天守は、展望台と展示室になっています。',
    },
    rewardItemId: 'head_pirate_hat',
    nearbySpotIds: [],
    sources: [
      { label: '今治市「今治城について」', url: 'https://www.city.imabari.ehime.jp/museum/imabarijo/about/' },
      { label: '今治市 観光スポット「今治城」', url: 'https://www.city.imabari.ehime.jp/kanko/spot/?a=106' },
    ],
  },
  {
    spotId: 'shimonada_station',
    name: '下灘駅',
    prefectureCode: EHIME_PREFECTURE_CODE,
    municipalityCode: '38210',
    municipality: '伊予市',
    address: '愛媛県伊予市双海町大久保',
    // 座標は公開資料からの概略値（docs/evidence.md）。現地での確認は未実施
    latitude: 33.65523,
    longitude: 132.58933,
    checkinRadiusM: 100,
    kind: 'landmark',
    tags: ['絶景', '海'],
    description:
      'JR予讃線の無人駅で、プラットホームから伊予灘の海が見えます。夕日の撮影スポットとして知られ、青春18きっぷのポスターにも何度も取り上げられています。',
    guide: {
      culture: '毎年9月には、夕日を背景にした「夕焼けプラットホームコンサート」が開かれています。',
    },
    rewardItemId: 'accessory_sunset_mantle',
    nearbySpotIds: [],
    sources: [
      { label: '伊予市「JR下灘駅」', url: 'https://www.city.iyo.lg.jp/machizukuri/kanko/guidemap/jrshimonada.html' },
      { label: 'いよ観ネット「JR下灘駅」', url: 'https://www.iyokannet.jp/spot/3580' },
    ],
  },
  {
    spotId: 'uwajima_castle',
    name: '宇和島城',
    prefectureCode: EHIME_PREFECTURE_CODE,
    municipalityCode: '38203',
    municipality: '宇和島市',
    address: '愛媛県宇和島市丸之内1',
    // 座標は公開資料からの天守付近の概略値（docs/evidence.md）。現地での確認は未実施
    latitude: 33.21948,
    longitude: 132.56524,
    checkinRadiusM: 150,
    kind: 'landmark',
    tags: ['歴史', '城', '絶景'],
    description:
      '藤堂高虎が築き、伊達家の2代宗利が大改修した城です。三重三階の天守は国の重要文化財で、現存12天守の一つです。',
    guide: {
      history: '天守が今の形に建て替えられたのは、伊達宗利が城を大改修した寛文年間（1661〜72年）です。',
      culture: '天守の3階からは宇和島湾を眺められます。',
    },
    rewardItemId: 'top_samurai_armor',
    nearbySpotIds: [],
    sources: [
      { label: '宇和島市「国指定 宇和島城天守」', url: 'https://www.city.uwajima.ehime.jp/site/sizen-bunka/1tensyu.html' },
      { label: '愛媛県「えひめの文化財」', url: 'https://www.pref.ehime.jp/ehimenotakara/16.html' },
    ],
  },
]

/**
 * スポットデータの版。AI クエストのキャッシュのキーに含め、スポットを追加・修正したら上げる
 * （古いデータで作った提案を使い回さないため）
 */
export const SPOT_DATA_VERSION = '2026-11-12.1'

/** AI 散策クエストで選べるジャンル。tags は、そのジャンルに合うスポットのタグ（空はすべてのスポット） */
export const QUEST_GENRES = [
  { id: 'sightseeing', label: '観光', tags: [] },
  { id: 'history', label: '歴史', tags: ['歴史', '城'] },
  { id: 'nature', label: '自然', tags: ['絶景', '海', '自然'] },
  { id: 'gourmet', label: 'グルメ', tags: ['グルメ', '特産品'] },
  { id: 'any', label: 'おまかせ', tags: [] },
] as const satisfies readonly { id: string; label: string; tags: readonly string[] }[]

export type QuestGenreId = (typeof QUEST_GENRES)[number]['id']

export function getQuestGenre(id: string) {
  return QUEST_GENRES.find((genre) => genre.id === id)
}

export function getSpot(spotId: string): TouristSpot | undefined {
  return SPOTS.find((spot) => spot.spotId === spotId)
}

/** AI クエストで選べる興味ジャンル（登録スポットのタグから作る） */
export const QUEST_INTERESTS: readonly string[] = [...new Set(SPOTS.flatMap((spot) => spot.tags))]

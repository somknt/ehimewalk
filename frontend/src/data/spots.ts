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
    rewardItemId: 'head_castle_kabuto',
    nearbySpotIds: ['dogo_onsen_honkan'],
    sources: [
      {
        label: '松山市公式ホームページ「松山城総合案内」',
        url: 'https://www.city.matsuyama.ehime.jp/kanko/kankoguide/shitestukoen/matsuyamajyo/sougouannnai.html',
      },
      { label: '松山城公式サイト「観覧ガイド」', url: 'https://www.matsuyamajo.jp/guide/' },
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
    rewardItemId: 'top_onsen_yukata',
    nearbySpotIds: ['matsuyama_castle'],
    sources: [
      { label: '道後温泉 公式サイト', url: 'https://dogo.jp/' },
      { label: '道後温泉 公式サイト「道後温泉本館」', url: 'https://dogo.jp/onsen/honkan' },
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
    rewardItemId: 'head_pirate_hat',
    nearbySpotIds: [],
    sources: [
      { label: '今治市「今治城について」', url: 'https://www.city.imabari.ehime.jp/museum/imabarijo/about/' },
      { label: '今治市 観光スポット「今治城」', url: 'https://www.city.imabari.ehime.jp/kanko/spot/?a=106' },
    ],
  },
]

export function getSpot(spotId: string): TouristSpot | undefined {
  return SPOTS.find((spot) => spot.spotId === spotId)
}

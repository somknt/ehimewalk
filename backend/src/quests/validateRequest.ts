// 散策条件の検証。クライアントの値は信用せず、選択肢にある値だけを受け付ける。
import { getQuestGenre, getSpot, isValidLatLng, type QuestGenreId } from '../shared'
import { QUEST_DISTANCE_OPTIONS_M, QUEST_MINUTE_OPTIONS, QuestError, WALKING_LOADS, type QuestConditions } from './types'

/** 文字列項目の長さの上限（ID や選択肢しか送られないため、短くてよい） */
export const MAX_FIELD_LENGTH = 64
const ALLOWED_KEYS = new Set(['startSpotId', 'currentLocation', 'minutes', 'genre', 'maxDistanceM', 'load'])

const invalid = (message: string) => new QuestError('invalid_input', message)
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function shortString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw invalid(`${field}が指定されていません。`)
  if (value.length > MAX_FIELD_LENGTH) throw invalid(`${field}が長すぎます。`)
  return value
}

export function validateQuestRequest(body: unknown): QuestConditions {
  if (!isObject(body)) throw invalid('リクエストの形式が正しくありません。')
  for (const key of Object.keys(body)) {
    if (!ALLOWED_KEYS.has(key)) throw invalid('不明な項目が含まれています。')
  }

  const startSpotId = shortString(body.startSpotId, '出発地点')
  let currentLocation: QuestConditions['currentLocation'] = null
  if (startSpotId === 'current') {
    const loc = body.currentLocation
    if (!isObject(loc) || typeof loc.latitude !== 'number' || typeof loc.longitude !== 'number') {
      throw invalid('現在地を取得できませんでした。出発地点をスポットから選んでください。')
    }
    const point = { latitude: loc.latitude, longitude: loc.longitude }
    if (!isValidLatLng(point)) throw invalid('現在地の値が正しくありません。')
    currentLocation = point
  } else {
    if (!getSpot(startSpotId)) throw invalid('出発地点が登録スポットにありません。')
    if (body.currentLocation !== undefined) throw invalid('現在地は「現在地から」を選んだときだけ送れます。')
  }

  const minutes = body.minutes
  if (!QUEST_MINUTE_OPTIONS.includes(minutes as QuestConditions['minutes'])) {
    throw invalid('散策時間は15・30・45・60分から選んでください。')
  }

  const genreId = shortString(body.genre ?? 'any', 'ジャンル')
  if (!getQuestGenre(genreId)) throw invalid('ジャンルが正しくありません。')

  const rawDistance = body.maxDistanceM ?? null
  if (rawDistance !== null && !QUEST_DISTANCE_OPTIONS_M.includes(rawDistance as never)) {
    throw invalid('歩行距離は1・2・3・5kmから選ぶか、指定なしにしてください。')
  }

  const load = shortString(body.load ?? 'normal', '歩くペース')
  if (!WALKING_LOADS.includes(load as QuestConditions['load'])) throw invalid('歩くペースが正しくありません。')

  return {
    startSpotId,
    currentLocation,
    minutes: minutes as QuestConditions['minutes'],
    genre: genreId as QuestGenreId,
    maxDistanceM: rawDistance as QuestConditions['maxDistanceM'],
    load: load as QuestConditions['load'],
  }
}

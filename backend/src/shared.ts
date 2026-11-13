// フロントエンドと共有するゲーム規則・スポットデータ。
// 画面に依存しない純粋なモジュール（domain/ と data/spots）だけを読み込む。
// 将来は shared/ パッケージに移す（docs/phase2-aws-design.md の P2-1）。それまでは参照先をこのファイルに集める。
export { getQuestGenre, getSpot, QUEST_GENRES, SPOT_DATA_VERSION, SPOTS, type QuestGenreId } from '../../frontend/src/data/spots'
export { toJstDateKey } from '../../frontend/src/domain/date'
export { isValidLatLng } from '../../frontend/src/domain/checkin'
export { distanceMeters, type LatLng } from '../../frontend/src/domain/geo'
export {
  buildRouteFromSpotIds,
  MAX_QUEST_SPOTS,
  selectQuestCandidates,
  type QuestCandidate,
  type QuestPlan,
} from '../../frontend/src/domain/questPlanner'
export type { TouristSpot, WalkingLoad } from '../../frontend/src/domain/types'

/** クエストの訪問先から、AI 経由の訪問として記録するためのリンク */
export function questSpotLink(questId: string, spotId: string): string {
  return `/adventure/spots/${spotId}?via=ai_quest&questId=${encodeURIComponent(questId)}`
}

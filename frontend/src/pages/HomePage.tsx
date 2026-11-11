import { ErrorMessage, LoadingCards } from '../components/ui'
import { CharacterStage } from '../features/character/CharacterStage'
import { PointsCard } from '../features/points/PointsCard'
import { RecommendedQuestCard } from '../features/quests/RecommendedQuestCard'
import { HealthDashboard, TodayStepsCard } from '../features/steps/StepCards'
import { useHomeData } from '../hooks/useHomeData'

export function HomePage() {
  const { state, reload } = useHomeData()

  if (state.status === 'loading') return <LoadingCards count={4} />
  if (state.status === 'error') return <ErrorMessage message={state.message} onRetry={reload} />

  const { profile, character, steps, balance, quest, lastSync } = state.data
  // スマートフォンでは左の列 → 右の列の順に縦に並び、幅 768px 以上では 2 列になる
  return (
    <div className="grid gap-4 md:grid-cols-2 md:items-start lg:gap-6">
      <h1 className="sr-only">ホーム</h1>
      <div className="space-y-4 lg:space-y-6">
        <CharacterStage character={character} profile={profile} steps={steps} />
        <TodayStepsCard steps={steps} source={lastSync.source} syncedAt={lastSync.syncedAt} />
        <PointsCard balance={balance} awardedNow={lastSync.awardedPoints} />
      </div>
      <div className="space-y-4 lg:space-y-6">
        <RecommendedQuestCard quest={quest} />
        <HealthDashboard steps={steps} />
        <button type="button" onClick={reload} className="rpg-button w-full bg-white">
          歩数を更新する
        </button>
      </div>
    </div>
  )
}

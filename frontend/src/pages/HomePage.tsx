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
  return (
    <div className="space-y-4">
      <h1 className="sr-only">ホーム</h1>
      <CharacterStage character={character} profile={profile} steps={steps} />
      <TodayStepsCard steps={steps} source={lastSync.source} syncedAt={lastSync.syncedAt} />
      <PointsCard balance={balance} awardedNow={lastSync.awardedPoints} />
      <RecommendedQuestCard quest={quest} />
      <HealthDashboard steps={steps} />
      <button type="button" onClick={reload} className="rpg-button w-full bg-white">
        歩数を更新する
      </button>
    </div>
  )
}

import { Link } from 'react-router'
import { ErrorMessage, LoadingCards } from '../components/ui'
import { summarizeSteps } from '../domain/steps'
import { toJstDateKey } from '../domain/date'
import { titleName } from '../domain/titles'
import { CharacterStage } from '../features/character/CharacterStage'
import { PointsCard } from '../features/points/PointsCard'
import { QuestCard } from '../features/quests/QuestCard'
import { MissionCard } from '../features/steps/MissionCard'
import { HealthDashboard, TodayStepsCard } from '../features/steps/StepCards'
import { useHomeData } from '../hooks/useHomeData'
import { useSession } from '../session/sessionContext'

export function HomePage() {
  const { session } = useSession()
  const { state, reload } = useHomeData()

  if (state.status === 'loading') return <LoadingCards count={4} />
  if (state.status === 'error') return <ErrorMessage message={state.message} onRetry={reload} />

  const { records, quest, mission, lastSync } = state.data
  // 目標は画面上で変更されることがあるため、表示のたびに最新の目標で集計する
  const steps = summarizeSteps(records, toJstDateKey(), session.profile.dailyGoal)

  // スマートフォンでは左の列 → 右の列の順に縦に並び、幅 768px 以上では 2 列になる
  return (
    <div className="grid gap-4 md:grid-cols-2 md:items-start lg:gap-6">
      <h1 className="sr-only">ホーム</h1>
      <div className="space-y-4 lg:space-y-6">
        <CharacterStage character={session.character} title={titleName(session.profile.titleId)} steps={steps} />
        <TodayStepsCard steps={steps} source={lastSync.source} syncedAt={lastSync.syncedAt} />
        <PointsCard balance={session.balance} awardedNow={lastSync.awardedPoints} />
        <MissionCard mission={mission} />
      </div>
      <div className="space-y-4 lg:space-y-6">
        <QuestCard
          quest={quest}
          footer={
            <Link to="/adventure?tab=quest" className="rpg-button mt-4 w-full bg-seto-400 text-ink">
              条件を変えてクエストを作る
            </Link>
          }
        />
        <HealthDashboard steps={steps} />
        <button type="button" onClick={reload} className="rpg-button w-full bg-white">
          歩数を更新する
        </button>
      </div>
    </div>
  )
}

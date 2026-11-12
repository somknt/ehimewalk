import { useState } from 'react'
import { Link } from 'react-router'
import { SwipePager } from '../components/SwipePager'
import { ErrorMessage, LoadingCards } from '../components/ui'
import { DemoToolsCard } from '../features/demo/DemoToolsCard'
import { CharacterStage } from '../features/character/CharacterStage'
import { LoginBonusCard } from '../features/points/LoginBonusCard'
import { PointsCard } from '../features/points/PointsCard'
import { RecommendedQuestCard } from '../features/quests/RecommendedQuestCard'
import { MissionCard } from '../features/steps/MissionCard'
import { HealthDashboard, TodayStepsCard } from '../features/steps/StepCards'
import { useHomeData } from '../hooks/useHomeData'

/**
 * ホームは 2 ページ構成（左右スワイプ・下部のインジケーターで切り替え）。
 * 1 ページ目：キャラクター・今日の歩数・所持コイン・ログインボーナス・ガチャと着せ替えへの近道
 * 2 ページ目：おすすめクエストと進行状況・健康ミッション・健康ダッシュボード（週間・月間・グラフ・距離・カロリー）
 */
export function HomePage() {
  const { state, reload, refresh } = useHomeData()
  const [refreshing, setRefreshing] = useState(false)

  if (state.status === 'loading') return <LoadingCards count={4} />
  if (state.status === 'error') return <ErrorMessage message={state.message} onRetry={reload} />

  const { profile, character, steps, todayDemoAddedSteps, balance, quest, mission, visitedSpotIds, lastSync } = state.data

  const updateSteps = async () => {
    setRefreshing(true)
    try {
      await refresh()
    } finally {
      setRefreshing(false)
    }
  }

  const mainPage = (
    // 幅 768px 以上では 2 列に並べる
    <div className="grid gap-4 md:grid-cols-2 md:items-start lg:gap-6">
      <div className="space-y-4">
        <CharacterStage character={character} profile={profile} steps={steps} />
        <Link to="/gacha/wardrobe" className="rpg-button w-full bg-seto-300">
          着せ替えする
        </Link>
      </div>
      <div className="space-y-4">
        <TodayStepsCard
          steps={steps}
          source={lastSync.source}
          syncedAt={lastSync.syncedAt}
          demoAddedSteps={todayDemoAddedSteps}
        />
        <button
          type="button"
          onClick={() => void updateSteps()}
          disabled={refreshing}
          className="rpg-button w-full bg-white disabled:opacity-60"
        >
          {refreshing ? '歩数を更新しています…' : '歩数を更新する'}
        </button>
        <PointsCard balance={balance} awardedNow={lastSync.awardedPoints} />
        <LoginBonusCard />
        <DemoToolsCard onStepsChanged={() => void refresh()} />
      </div>
    </div>
  )

  const healthPage = (
    <div className="grid gap-4 md:grid-cols-2 md:items-start lg:gap-6">
      <div className="space-y-4">
        <RecommendedQuestCard quest={quest} todaySteps={steps.todaySteps} visitedSpotIds={visitedSpotIds} />
        {/* 目標を変えたら、達成率やグラフの目標線を読み直す */}
        <MissionCard mission={mission} onAccepted={() => void refresh()} />
      </div>
      <HealthDashboard steps={steps} />
    </div>
  )

  return (
    <div>
      <h1 className="sr-only">ホーム</h1>
      <SwipePager
        label="ホーム"
        pages={[
          { id: 'main', label: 'キャラ・歩数', content: mainPage },
          { id: 'health', label: 'クエスト・健康', content: healthPage },
        ]}
      />
    </div>
  )
}

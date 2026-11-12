import { Link } from 'react-router'
import { api, type WeeklyMission } from '../../api'
import { Badge, Card, CardTitle } from '../../components/ui'
import { useAction } from '../../hooks/useAction'
import { useSession } from '../../session/sessionContext'

/**
 * 過去 7 日間の歩数から提案する、今週の目標。
 * onAccepted：目標を変えたあとに、ホームの達成率などを読み直すために呼ぶ
 */
export function MissionCard({ mission, onAccepted }: { mission: WeeklyMission; onAccepted?: () => void }) {
  const { session, setSession } = useSession()
  const accept = useAction(async () => {
    setSession(await api.updateProfile({ dailyGoal: mission.targetSteps }))
    onAccepted?.()
  })
  const alreadySet = session.profile.dailyGoal === mission.targetSteps

  return (
    <Card className="bg-leaf-50">
      <CardTitle aside={<Badge tone={mission.generatedBy === 'mock' ? 'gray' : 'leaf'}>{mission.generatedBy === 'mock' ? 'モック' : 'AI提案'}</Badge>}>
        今週の健康ミッション
      </CardTitle>
      <p className="font-pixel text-xl text-leaf-700">{mission.message}</p>
      <p className="mt-2 text-sm text-ink-soft">
        過去7日間の平均 {mission.average7Days.toLocaleString('ja-JP')} 歩をもとに、無理のない目標（平均の+10%まで）を提案しています。
      </p>
      {alreadySet ? (
        <p className="mt-3 rounded-lg bg-white px-3 py-2 text-center text-sm font-bold text-leaf-700">
          この目標（1日 {mission.targetSteps.toLocaleString('ja-JP')} 歩）を設定中です
        </p>
      ) : (
        <button
          type="button"
          onClick={() => void accept.run()}
          disabled={accept.pending}
          className="rpg-button mt-3 w-full bg-leaf-500 text-white [text-shadow:1px_1px_0_var(--color-ink)] disabled:opacity-60"
        >
          1日 {mission.targetSteps.toLocaleString('ja-JP')} 歩を目標にする
        </button>
      )}
      {accept.error && (
        <p role="alert" className="mt-2 text-sm font-bold text-red-700">
          {accept.error}
        </p>
      )}
      <p className="mt-2 text-xs text-ink-soft">
        目標は<Link to="/mypage" className="underline">マイページ</Link>でいつでも変えられます。体調がすぐれない日は休みましょう。
      </p>
    </Card>
  )
}

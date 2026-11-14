import { useCallback } from 'react'
import { Link } from 'react-router'
import { api, type CommonQuestStatus } from '../../api'
import { CoinIcon } from '../../components/CoinBadge'
import { Badge, Card, CardTitle, ErrorMessage, LoadingCards, ProgressBar } from '../../components/ui'
import { getSpot } from '../../data/spots'
import { formatMonthDay } from '../../domain/date'
import { useAction } from '../../hooks/useAction'
import { useAsyncData } from '../../hooks/useAsyncData'

const loadQuests = () => api.getCommonQuests()

const PERIOD_LABELS = { daily: '毎日', weekly: '毎週', once: '1回だけ' } as const

const formatProgress = (status: CommonQuestStatus) =>
  status.quest.kind === 'visit_spots'
    ? `${status.progress} / ${status.quest.target} か所`
    : `${status.progress.toLocaleString('ja-JP')} / ${status.quest.target.toLocaleString('ja-JP')} 歩`

function QuestRow({ status, onClaim, claiming }: { status: CommonQuestStatus; onClaim: () => void; claiming: boolean }) {
  const { quest } = status
  const ready = status.completed && !status.claimed
  return (
    <li className={`rounded-xl border-[3px] p-3 ${ready ? 'border-mikan-600 bg-mikan-50' : status.claimed ? 'border-leaf-600/40 bg-leaf-50' : 'border-ink/15 bg-white'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-pixel text-lg">{quest.title}</p>
          <p className="text-sm text-ink-soft">{quest.description}</p>
        </div>
        <Badge tone={quest.period === 'once' ? 'seto' : 'mikan'}>{PERIOD_LABELS[quest.period]}</Badge>
      </div>

      <div className="mt-2">
        <div className="mb-1 flex justify-between text-sm">
          <span>{quest.kind === 'community_steps' ? 'みんなの合計' : '進み具合'}</span>
          <span className="font-bold">{formatProgress(status)}</span>
        </div>
        <ProgressBar value={status.progress / quest.target} label={`${quest.title}の進み具合`} />
      </div>

      {quest.kind === 'community_steps' && (
        <p className="mt-1.5 text-xs text-ink-soft">
          参加 {status.participants} 人・あなたの今週の歩数 {(status.myContribution ?? 0).toLocaleString('ja-JP')} 歩
          {(status.myContribution ?? 0) < (quest.minContribution ?? 0) &&
            `（報酬は自分が ${quest.minContribution?.toLocaleString('ja-JP')} 歩以上で受け取れます）`}
        </p>
      )}
      {quest.kind === 'visit_spots' && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {(quest.spotIds ?? []).map((spotId) => {
            const visited = status.visitedSpotIds?.includes(spotId)
            return (
              <li key={spotId}>
                <Link
                  to={`/adventure/spots/${spotId}`}
                  className={`inline-flex min-h-9 items-center gap-1 rounded-full border-2 px-2.5 text-sm ${visited ? 'border-leaf-600 bg-leaf-100 font-bold' : 'border-ink/30 bg-white'}`}
                >
                  {visited ? '✓' : '・'} {getSpot(spotId)?.name}
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1 text-sm font-bold whitespace-nowrap">
          <CoinIcon size={18} />
          報酬 {quest.rewardCoins}コイン
        </p>
        {status.claimed ? (
          <span className="text-sm font-bold text-leaf-700">受け取り済み</span>
        ) : (
          <button
            type="button"
            onClick={onClaim}
            disabled={!ready || claiming}
            className="rpg-button min-h-11 bg-mikan-500 px-3 text-base text-white [text-shadow:1px_1px_0_var(--color-ink)] disabled:bg-gray-200 disabled:text-ink-soft disabled:[text-shadow:none]"
          >
            {ready ? '受け取る' : '未達成'}
          </button>
        )}
      </div>
      {status.resetsOn && (
        <p className="mt-1 text-right text-xs text-ink-soft">{formatMonthDay(status.resetsOn)} 0:00 に新しくなります</p>
      )}
    </li>
  )
}

/** みんな共通のクエスト。全員が同じクエストに挑戦する */
export function CommonQuests() {
  const { state, reload, update } = useAsyncData(loadQuests)
  const claim = useAction(async (questId: string) => {
    const result = await api.claimCommonQuest(questId)
    update(() => result.quests)
    return result.reward
  })
  const onClaim = useCallback((questId: string) => void claim.run(questId), [claim])

  if (state.status === 'loading') return <LoadingCards count={2} />
  if (state.status === 'error') return <ErrorMessage message={state.message} onRetry={reload} />

  const readyCount = state.data.filter((s) => s.completed && !s.claimed).length
  return (
    <Card>
      <CardTitle aside={readyCount > 0 ? <Badge tone="mikan">受け取れる報酬 {readyCount}</Badge> : undefined}>みんなのクエスト</CardTitle>
      <p className="mb-3 text-sm text-ink-soft">
        アプリを使っている全員が、同じクエストに挑戦しています。達成したら報酬のコインを受け取ろう。
      </p>
      {claim.error && (
        <p role="alert" className="mb-2 text-sm font-bold text-red-700">
          {claim.error}
        </p>
      )}
      <ul className="space-y-3">
        {state.data.map((status) => (
          <QuestRow key={status.quest.questId} status={status} onClaim={() => onClaim(status.quest.questId)} claiming={claim.pending} />
        ))}
      </ul>
      <p className="mt-3 text-xs text-ink-soft">
        {api.mode === 'mock'
          ? '「みんなで愛媛50万歩」の参加者は、いまは架空のサンプルユーザーです（モック）。'
          : '「みんなで愛媛50万歩」は、アプリを使っているみんなの今週の歩数の合計です（デモ操作の歩数は入りません）。'}
        体調に合わせて、無理のない範囲で歩きましょう。
      </p>
    </Card>
  )
}

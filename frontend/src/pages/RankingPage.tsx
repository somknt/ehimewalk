import { useCallback, useState } from 'react'
import { Link } from 'react-router'
import { api, type RankingEntry, type RankingResult, type RankingScope } from '../api'
import { Tabs } from '../components/Tabs'
import { Badge, Card, ErrorMessage, LoadingCards, PageTitle } from '../components/ui'
import { formatMonthDay } from '../domain/date'
import { CharacterAvatar } from '../features/character/CharacterAvatar'
import { CheerButtons } from '../features/friends/CheerButtons'
import { useAsyncData } from '../hooks/useAsyncData'

/** オンライン（Supabase）で、実際の利用者のランキングを表示しているか */
const ONLINE = api.mode !== 'mock'

const TABS: { id: RankingScope; label: string }[] = [
  { id: 'all', label: '全ユーザー' },
  { id: 'ehime', label: '愛媛県' },
  { id: 'friends', label: 'フレンド' },
]

const DESCRIPTIONS: Record<RankingScope, string> = {
  all: 'アプリを使っている全員の週間歩数ランキングです。',
  ehime: '愛媛県ランキングへの参加を選んだ人どうしのランキングです。',
  friends: 'フレンド登録した人どうしのランキングです。',
}

const RANK_STYLES: Record<number, string> = {
  1: 'bg-mikan-400 text-white',
  2: 'bg-gray-300 text-ink',
  3: 'bg-[#d39a6a] text-white',
}

function RankingRow({ entry, showCheer }: { entry: RankingEntry; showCheer: boolean }) {
  return (
    <li className={`rounded-xl border-[3px] p-2.5 ${entry.isMe ? 'border-mikan-600 bg-mikan-50' : 'border-ink/15 bg-white'}`}>
      <div className="flex items-center gap-3">
        <span
          className={`flex size-10 shrink-0 items-center justify-center rounded-full border-2 border-ink font-pixel text-lg ${
            RANK_STYLES[entry.rank] ?? 'bg-white'
          }`}
        >
          {entry.rank}
        </span>
        <CharacterAvatar character={entry.character} scale={3} showPet={false} className="h-16 w-12 shrink-0 rounded-lg border-2 border-ink/20" />
        <div className="min-w-0 flex-1">
          <p className="font-bold break-all">
            {entry.username}
            {entry.isMe && <span className="ml-1 text-sm text-mikan-800">（あなた）</span>}
          </p>
          <p className="text-sm text-ink-soft">{entry.title}</p>
          {entry.isSample && <span className="text-xs text-ink-soft">サンプル</span>}
        </div>
        <p className="shrink-0 text-right font-pixel text-lg">
          {entry.weeklySteps.toLocaleString('ja-JP')}
          <span className="ml-0.5 text-sm">歩</span>
        </p>
      </div>
      {showCheer && !entry.isMe && (
        <div className="mt-2 border-t border-ink/10 pt-2">
          <CheerButtons userId={entry.userId} />
        </div>
      )}
    </li>
  )
}

function MyStatus({ result }: { result: RankingResult }) {
  const { me } = result
  return (
    <Card className="bg-mikan-50">
      <p className="text-sm text-ink-soft">あなたの今週の歩数</p>
      <p className="font-pixel text-3xl">
        {me.weeklySteps.toLocaleString('ja-JP')}
        <span className="ml-1 text-lg">歩</span>
      </p>
      {me.eligible ? (
        <p className="mt-1 font-bold">{ONLINE ? 'ランキングに参加中です（端末のセンサーで数えた推定の歩数）' : '正式ランキングに参加中です'}</p>
      ) : me.excludedReason === 'not_opted_in' ? (
        <p className="mt-1 text-sm">
          愛媛県ランキングに参加していません。<Link to="/mypage" className="font-bold text-seto-700 underline">マイページ</Link>
          で参加できます。
        </p>
      ) : (
        <p className="mt-1 text-sm">
          {me.excludedReason === 'demo_data'
            ? 'デモ操作で追加した歩数を含むため、正式な順位には入りません'
            : '端末のセンサーで数えた歩数は、不正防止の確認ができるまで正式な順位には入りません'}
          （参考：<span className="font-bold">{me.referenceRank}位</span>相当）。
        </p>
      )}
    </Card>
  )
}

export function RankingPage() {
  const [scope, setScope] = useState<RankingScope>('all')
  const loader = useCallback(() => api.getRanking(scope), [scope])
  const { state, reload } = useAsyncData(loader)

  return (
    <div className="max-w-3xl space-y-4">
      <PageTitle lead="週間歩数で競おう。毎週月曜 0:00（日本時間）に新しい週が始まります。">ランキング</PageTitle>
      <Tabs label="ランキングの種類" tabs={TABS} active={scope} onChange={setScope}>
        <p className="mb-3">{DESCRIPTIONS[scope]}</p>
        {/* タブを切り替えた直後は前のタブのデータが残っているため、選択中のタブのデータが届くまで読み込み中にする */}
        {(state.status === 'loading' || (state.status === 'ready' && state.data.scope !== scope)) && <LoadingCards count={2} />}
        {state.status === 'error' && <ErrorMessage message={state.message} onRetry={reload} />}
        {state.status === 'ready' && state.data.scope === scope && (
          <div className="space-y-4">
            <MyStatus result={state.data} />
            <Card>
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="font-pixel text-lg">{formatMonthDay(state.data.weekStart)}（月）からの週間歩数</h2>
                {!ONLINE && <Badge tone="gray">サンプル表示</Badge>}
              </div>
              {state.data.entries.length === 0 ? (
                scope === 'friends' ? (
                  <div>
                    <p className="text-ink-soft">まだフレンドがいません。フレンドコードで友だちを追加しよう！</p>
                    <Link to="/friends" className="rpg-button mt-3 w-full bg-seto-400">
                      フレンドを追加する
                    </Link>
                  </div>
                ) : (
                  <p className="text-ink-soft">まだランキングに参加している人がいません。</p>
                )
              ) : (
                <ol className="space-y-2">
                  {state.data.entries.map((entry) => (
                    <RankingRow key={entry.userId} entry={entry} showCheer={scope === 'friends'} />
                  ))}
                </ol>
              )}
              <p className="mt-3 text-xs text-ink-soft">
                {ONLINE
                  ? '端末のセンサーで数えた歩数（推定値）で並べています。デモ操作で追加した歩数は入りません。'
                  : 'いまはAWS未接続のため、表示確認用の架空のサンプルユーザーを表示しています。'}
                位置情報や訪問先はランキングに表示しません。
              </p>
            </Card>
          </div>
        )}
      </Tabs>
    </div>
  )
}

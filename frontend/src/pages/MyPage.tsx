import { api } from '../api'
import { Card, CardTitle, ComingSoon, ErrorMessage, LoadingCards, PageTitle } from '../components/ui'
import { CharacterAvatar } from '../features/character/CharacterAvatar'
import { useAsyncData } from '../hooks/useAsyncData'

async function loadMyPage() {
  const [profile, character] = await Promise.all([api.getProfile(), api.getCharacter()])
  return { profile, character }
}

export function MyPage() {
  const { state, reload } = useAsyncData(loadMyPage)

  return (
    <div className="space-y-4">
      <PageTitle>マイページ</PageTitle>

      {state.status === 'loading' && <LoadingCards count={2} />}
      {state.status === 'error' && <ErrorMessage message={state.message} onRetry={reload} />}
      {state.status === 'ready' && (
        <Card>
          <CardTitle>プロフィール</CardTitle>
          <div className="flex items-center gap-4">
            <CharacterAvatar
              character={state.data.character}
              scale={5}
              showPet={false}
              className="h-28 w-24 shrink-0 rounded-xl border-[3px] border-ink"
            />
            <div>
              <p className="font-pixel text-2xl">{state.data.character.name}</p>
              <p className="mt-1 inline-block rounded-lg border-2 border-ink bg-mikan-100 px-2 py-0.5 text-sm font-bold">
                {state.data.profile.title}
              </p>
            </div>
          </div>
          <dl className="mt-4 divide-y divide-ink/15 border-t border-ink/15">
            {[
              [
                'フレンドコード',
                <span key="friendCode" className="font-pixel tracking-widest">
                  {state.data.profile.friendCode}
                </span>,
              ],
              ['1日の目標', `${state.data.profile.dailyGoal.toLocaleString('ja-JP')} 歩`],
              ['愛媛県ランキング', state.data.profile.ehimeRankingOptIn ? '参加する' : '参加しない'],
            ].map(([term, value]) => (
              <div key={String(term)} className="flex items-center justify-between gap-3 py-2">
                <dt className="text-ink-soft">{term}</dt>
                <dd className="font-bold">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>
      )}

      <ComingSoon
        items={[
          { label: 'キャラクター作成・名前の変更', task: 'タスク 1.7' },
          { label: '歩数履歴・目標の変更', task: 'タスク 1.14' },
          { label: 'フレンド管理', task: 'フェーズ2' },
          { label: '獲得称号・訪問履歴', task: 'フェーズ3' },
          { label: 'アカウント設定・データ削除', task: 'フェーズ2' },
        ]}
      />
    </div>
  )
}

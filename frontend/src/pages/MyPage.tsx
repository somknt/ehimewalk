import { useCallback, useState, type FormEvent } from 'react'
import { api, type ActivitySummary } from '../api'
import { TextField, Toggle } from '../components/forms'
import { Badge, Card, CardTitle, ErrorMessage, LoadingCards, PageTitle } from '../components/ui'
import { getSpot } from '../data/spots'
import { addDays, formatMonthDay, toJstDateKey, weekdayLabel } from '../domain/date'
import { MAX_DAILY_GOAL, MIN_DAILY_GOAL } from '../domain/steps'
import { titleName } from '../domain/titles'
import type { StepRecord, Visit } from '../domain/types'
import { AppearanceFields } from '../features/character/AppearanceFields'
import { CharacterAvatar } from '../features/character/CharacterAvatar'
import { useAction } from '../hooks/useAction'
import { useAsyncData } from '../hooks/useAsyncData'
import { useSession } from '../session/sessionContext'

const GOAL_PRESETS = [4000, 6000, 8000, 10000]
const SOURCE_LABELS: Record<StepRecord['source'], string> = { demo: 'デモ', healthkit: 'ヘルスケア', health_connect: 'ヘルスコネクト' }

function ErrorText({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="mt-2 text-sm font-bold text-red-700">
      {message}
    </p>
  )
}

function SavedText({ show }: { show: boolean }) {
  return show ? (
    <p role="status" className="mt-2 text-sm font-bold text-leaf-700">
      保存しました
    </p>
  ) : null
}

function ProfileCard() {
  const { session, setSession, applyCharacter } = useSession()
  const { profile, character } = session
  const [characterName, setCharacterName] = useState(character.name)
  const [username, setUsername] = useState(profile.username)
  const [appearance, setAppearance] = useState(character.appearance)
  const [saved, setSaved] = useState(false)

  const save = useAction(async () => {
    setSaved(false)
    applyCharacter(await api.updateCharacter({ name: characterName, appearance }))
    setSession(await api.updateProfile({ username }))
    setSaved(true)
  })
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void save.run()
  }

  return (
    <Card>
      <CardTitle>プロフィール</CardTitle>
      <div className="flex items-center gap-4">
        <CharacterAvatar
          character={{ ...character, name: characterName, appearance }}
          scale={5}
          showPet={false}
          className="h-28 w-24 shrink-0 rounded-xl border-[3px] border-ink"
        />
        <div>
          <p className="font-pixel text-2xl">{character.name}</p>
          <p className="mt-1 inline-block rounded-lg border-2 border-ink bg-mikan-100 px-2 py-0.5 text-sm font-bold">
            {titleName(profile.titleId)}
          </p>
          <p className="mt-2 text-sm text-ink-soft">
            フレンドコード：<span className="font-pixel tracking-widest text-ink">{profile.friendCode}</span>
          </p>
        </div>
      </div>
      <details className="mt-4">
        <summary className="cursor-pointer py-2 font-bold text-seto-700">名前・見た目を変える</summary>
        <form onSubmit={onSubmit} className="mt-2 space-y-4">
          <TextField label="キャラクターの名前" value={characterName} onChange={setCharacterName} maxLength={12} />
          <TextField
            label="ユーザー名（ランキングに表示）"
            value={username}
            onChange={setUsername}
            maxLength={12}
            hint="本名は入れないでください。"
          />
          <AppearanceFields value={appearance} onChange={setAppearance} />
          <button type="submit" disabled={save.pending} className="rpg-button w-full bg-mikan-500 text-white disabled:opacity-60">
            保存する
          </button>
          <ErrorText message={save.error} />
          <SavedText show={saved} />
        </form>
      </details>
    </Card>
  )
}

function GoalCard() {
  const { session, setSession } = useSession()
  const [goal, setGoal] = useState(String(session.profile.dailyGoal))
  const [saved, setSaved] = useState(false)
  const save = useAction(async (value: number) => {
    setSaved(false)
    setSession(await api.updateProfile({ dailyGoal: value }))
    setGoal(String(value))
    setSaved(true)
  })
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void save.run(Number(goal))
  }

  return (
    <Card>
      <CardTitle>1日の歩数目標</CardTitle>
      <p className="mb-3">
        いまの目標：<span className="font-pixel text-2xl">{session.profile.dailyGoal.toLocaleString('ja-JP')}</span> 歩
      </p>
      <div className="grid grid-cols-4 gap-2">
        {GOAL_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => void save.run(preset)}
            aria-pressed={session.profile.dailyGoal === preset}
            className={`min-h-12 rounded-xl border-[3px] text-sm font-bold ${
              session.profile.dailyGoal === preset ? 'border-ink bg-mikan-100' : 'border-ink/25 bg-white'
            }`}
          >
            {preset.toLocaleString('ja-JP')}
          </button>
        ))}
      </div>
      <form onSubmit={onSubmit} className="mt-3 flex items-end gap-2">
        <label className="flex-1">
          <span className="text-sm font-bold">自分で決める（{MIN_DAILY_GOAL.toLocaleString('ja-JP')}〜{MAX_DAILY_GOAL.toLocaleString('ja-JP')}歩）</span>
          <input
            type="number"
            inputMode="numeric"
            min={MIN_DAILY_GOAL}
            max={MAX_DAILY_GOAL}
            step={100}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            className="mt-1 block min-h-12 w-full rounded-xl border-[3px] border-ink bg-white px-3 text-lg"
          />
        </label>
        <button type="submit" disabled={save.pending} className="rpg-button bg-white">
          設定
        </button>
      </form>
      <ErrorText message={save.error} />
      <SavedText show={saved} />
      <p className="mt-3 text-xs text-ink-soft">
        参考：健康日本21（第三次）の目標は、20〜64歳で1日8,000歩、65歳以上で6,000歩です。無理のない目標から始めましょう。
      </p>
    </Card>
  )
}

function SettingsCard() {
  const { session, setSession } = useSession()
  const update = useAction(async (patch: Parameters<typeof api.updateProfile>[0]) => setSession(await api.updateProfile(patch)))
  return (
    <Card>
      <CardTitle>設定</CardTitle>
      <div className="divide-y divide-ink/10">
        <Toggle
          label="愛媛県ランキングに参加する"
          description="参加すると、愛媛県ランキングにユーザー名と週間歩数が表示されます。"
          checked={session.profile.ehimeRankingOptIn}
          disabled={update.pending}
          onChange={(checked) => void update.run({ ehimeRankingOptIn: checked })}
        />
        <Toggle
          label="ガチャの演出を短くする"
          description="アニメーションを省いて、すぐに結果を表示します。"
          checked={session.profile.reduceGachaEffects}
          disabled={update.pending}
          onChange={(checked) => void update.run({ reduceGachaEffects: checked })}
        />
      </div>
      <ErrorText message={update.error} />
    </Card>
  )
}

function TitlesCard() {
  const { session, setSession } = useSession()
  const select = useAction(async (titleId: string) => setSession(await api.updateProfile({ titleId })))
  const unlocked = session.titles.filter((t) => t.unlocked).length
  return (
    <Card>
      <CardTitle aside={<span className="font-pixel">{unlocked} / {session.titles.length}</span>}>称号</CardTitle>
      <ul className="space-y-2">
        {session.titles.map((title) => {
          const selected = session.profile.titleId === title.titleId
          return (
            <li key={title.titleId}>
              <button
                type="button"
                disabled={!title.unlocked || select.pending}
                aria-pressed={selected}
                onClick={() => void select.run(title.titleId)}
                className={`flex min-h-12 w-full items-center justify-between gap-2 rounded-xl border-[3px] px-3 py-2 text-left ${
                  selected ? 'border-ink bg-mikan-100' : title.unlocked ? 'border-ink/25 bg-white' : 'border-dashed border-ink/20 bg-cream text-ink-soft'
                }`}
              >
                <span>
                  <span className="block font-bold">{title.unlocked ? title.name : '？？？'}</span>
                  <span className="block text-xs">{title.condition}</span>
                </span>
                {selected ? <Badge tone="mikan">表示中</Badge> : title.unlocked ? <span className="text-sm">これにする</span> : null}
              </button>
            </li>
          )
        })}
      </ul>
      <ErrorText message={select.error} />
    </Card>
  )
}

function StepHistoryCard({ records, goal }: { records: StepRecord[]; goal: number }) {
  const sorted = [...records].sort((a, b) => b.date.localeCompare(a.date))
  return (
    <Card>
      <CardTitle>歩数履歴（30日）</CardTitle>
      {sorted.length === 0 ? (
        <p className="text-ink-soft">まだ記録がありません。</p>
      ) : (
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b-2 border-ink text-sm">
                <th scope="col" className="py-1.5">日付</th>
                <th scope="col" className="py-1.5 text-right">歩数</th>
                <th scope="col" className="py-1.5 text-right">取得元</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((record) => (
                <tr key={record.date} className="border-b border-ink/10">
                  <td className="py-1.5">
                    {formatMonthDay(record.date)}（{weekdayLabel(record.date)}）
                  </td>
                  <td className="py-1.5 text-right font-bold">
                    {record.steps.toLocaleString('ja-JP')}
                    {record.steps >= goal && <span className="ml-1 text-leaf-700" aria-label="目標達成">★</span>}
                  </td>
                  <td className="py-1.5 text-right text-sm text-ink-soft">{SOURCE_LABELS[record.source]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-ink-soft">★は目標を達成した日です。</p>
    </Card>
  )
}

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' }).format(new Date(iso))

function VisitHistoryCard({ visits }: { visits: Visit[] }) {
  const sorted = [...visits].sort((a, b) => b.visitedAt.localeCompare(a.visitedAt))
  return (
    <Card>
      <CardTitle>訪問履歴</CardTitle>
      {sorted.length === 0 ? (
        <p className="text-ink-soft">まだ訪れたスポットはありません。冒険画面からチェックインしてみよう！</p>
      ) : (
        <ul className="space-y-2">
          {sorted.map((visit) => (
            <li key={visit.spotId} className="flex items-center justify-between gap-2 rounded-lg bg-cream px-3 py-2">
              <span className="font-bold">{getSpot(visit.spotId)?.name}</span>
              <span className="text-sm text-ink-soft">
                {formatDate(visit.visitedAt)}・{visit.via === 'ai_quest' ? 'AIクエスト経由' : '一覧から'}
                {!visit.verified && '・デモ'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function ActivityCard({ activity }: { activity: ActivitySummary }) {
  const items = [
    ['利用日数', `${activity.activeDays}日`],
    ['目標を達成した日', `${activity.goalAchievedDays} / ${activity.recordedDays}日`],
    ['AIクエストを作った回数', `${activity.questGenerations}回`],
    ['AIクエスト経由の訪問', `${activity.visitsViaQuest}か所`],
    ['一覧からの訪問', `${activity.visitsViaList}か所`],
    ['ガチャを引いた回数', `${activity.gachaDraws}回`],
  ]
  return (
    <Card>
      <CardTitle>あなたの記録</CardTitle>
      <dl className="grid grid-cols-2 gap-2">
        {items.map(([label, value]) => (
          <div key={label} className="rounded-xl bg-cream p-3">
            <dt className="text-sm text-ink-soft">{label}</dt>
            <dd className="font-pixel text-xl">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-ink-soft">この端末に保存された記録です。デモデータを含みます。</p>
    </Card>
  )
}

function DangerZone() {
  const remove = useAction(async () => {
    await api.deleteAllData()
    // 保存データを消したので、最初の画面から読み込み直す
    window.location.assign(import.meta.env.BASE_URL)
  })
  const onClick = () => {
    if (window.confirm('キャラクター、ポイント、アイテム、歩数の記録をすべて削除します。元に戻せません。削除しますか？')) {
      void remove.run()
    }
  }
  return (
    <Card className="border-red-700">
      <CardTitle>アカウント</CardTitle>
      <p className="text-sm">フレンド管理とログインは、AWS連携（フェーズ2）で追加します。</p>
      <button type="button" onClick={onClick} disabled={remove.pending} className="rpg-button mt-3 w-full bg-red-50 text-red-800">
        すべてのデータを削除する
      </button>
      <ErrorText message={remove.error} />
    </Card>
  )
}

interface MyPageData {
  records: StepRecord[]
  visits: Visit[]
  activity: ActivitySummary
}

export function MyPage() {
  const { session, setSession } = useSession()
  const loader = useCallback(async (): Promise<MyPageData> => {
    const today = toJstDateKey()
    const [fresh, records, visits, activity] = await Promise.all([
      api.getSession(),
      api.getStepRecords(addDays(today, -29), today),
      api.getVisits(),
      api.getActivitySummary(),
    ])
    // 称号の獲得状況など、ほかの画面での変化を反映する
    setSession(fresh)
    return { records, visits, activity }
  }, [setSession])
  const { state, reload } = useAsyncData(loader)

  return (
    <div className="space-y-4">
      <PageTitle>マイページ</PageTitle>
      <div className="grid gap-4 md:grid-cols-2 md:items-start">
        <div className="space-y-4">
          <ProfileCard />
          <GoalCard />
          <SettingsCard />
          <TitlesCard />
        </div>
        <div className="space-y-4">
          {state.status === 'loading' && <LoadingCards count={2} />}
          {state.status === 'error' && <ErrorMessage message={state.message} onRetry={reload} />}
          {state.status === 'ready' && (
            <>
              <ActivityCard activity={state.data.activity} />
              <StepHistoryCard records={state.data.records} goal={session.profile.dailyGoal} />
              <VisitHistoryCard visits={state.data.visits} />
            </>
          )}
          <DangerZone />
        </div>
      </div>
    </div>
  )
}

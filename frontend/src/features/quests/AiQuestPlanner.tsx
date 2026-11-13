import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react'
import { Link } from 'react-router'
import {
  AI_QUEST_DISTANCES_M,
  AI_QUEST_MINUTES,
  AiQuestError,
  aiQuestClient,
  type AiQuest,
  type AiQuestRequest,
  type AiQuestResult,
  type AiQuestStatus,
} from '../../api/aiQuestClient'
import { ChoiceGroup } from '../../components/forms'
import { Badge, Card, CardTitle } from '../../components/ui'
import { getItem } from '../../data/items'
import { getSpot, QUEST_GENRES, SPOTS } from '../../data/spots'
import { useAction } from '../../hooks/useAction'
import { getCurrentPosition } from '../geo/getCurrentPosition'
import { aiQuestHistory, MAX_FAVORITE_QUESTS, MAX_RECENT_QUESTS } from './aiQuestHistory'

type Minutes = (typeof AI_QUEST_MINUTES)[number]
type Distance = 'none' | `${(typeof AI_QUEST_DISTANCES_M)[number]}`
const formatKm = (meters: number) => (meters / 1000).toFixed(1)

/**
 * AI 散策クエスト（backend 経由で Amazon Bedrock に提案してもらう）。
 * 訪問先は登録スポットからだけ選ばれ、backend が回答を検証してから表示する。
 */
export function AiQuestPlanner() {
  const [startSpotId, setStartSpotId] = useState<string>(SPOTS[0].spotId)
  const [minutes, setMinutes] = useState<`${Minutes}`>('30')
  const [genre, setGenre] = useState<string>('history')
  const [distance, setDistance] = useState<Distance>('none')
  // 「見つからなかった」結果だけはその場の表示にする（提案のコースは保存した履歴から表示する）
  const [noSpots, setNoSpots] = useState<Extract<AiQuestResult, { status: 'no_spots' }> | null>(null)
  // いま表示している提案。未選択なら最新の提案を表示する（ほかの画面から戻っても消えない）
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [justGenerated, setJustGenerated] = useState<{ questId: string; cached: boolean } | null>(null)
  const history = useSyncExternalStore(aiQuestHistory.subscribe, aiQuestHistory.getSnapshot)
  const [status, setStatus] = useState<AiQuestStatus | null>(null)
  const [remaining, setRemaining] = useState<number | null>(null)

  // 残り回数はサーバーが数えた値を表示する
  useEffect(() => {
    let ignore = false
    aiQuestClient.getStatus().then(
      (s) => {
        if (ignore) return
        setStatus(s)
        setRemaining(s.remainingToday)
      },
      () => undefined,
    )
    return () => {
      ignore = true
    }
  }, [])

  const generate = useAction(async () => {
    const body: AiQuestRequest = {
      startSpotId,
      minutes: Number(minutes) as Minutes,
      genre,
      maxDistanceM: distance === 'none' ? null : (Number(distance) as AiQuestRequest['maxDistanceM']),
      load: 'normal',
    }
    if (startSpotId === 'current') {
      // 位置情報はボタンを押したときに 1 回だけ取得する（ブラウザが許可を確認する）
      const position = await getCurrentPosition()
      body.currentLocation = { latitude: position.latitude, longitude: position.longitude }
    }
    try {
      const res = await aiQuestClient.generate(body)
      setRemaining(res.remainingToday)
      if (res.status === 'ok') {
        aiQuestHistory.addRecent(res.quest)
        setSelectedId(res.quest.questId)
        setJustGenerated({ questId: res.quest.questId, cached: res.cached })
        setNoSpots(null)
      } else {
        setNoSpots(res)
      }
    } catch (error) {
      if (error instanceof AiQuestError && error.remainingToday !== undefined) setRemaining(error.remainingToday)
      throw error
    }
  })

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!generate.pending) void generate.run()
  }

  const outOfQuota = remaining === 0

  const allSaved = [...history.recent, ...history.favorites]
  const shown = allSaved.find((q) => q.questId === selectedId) ?? history.recent[0] ?? history.favorites[0] ?? null
  const favoriteIds = new Set(history.favorites.map((q) => q.questId))
  const [favoriteMessage, setFavoriteMessage] = useState<string | null>(null)

  const select = (questId: string) => {
    setSelectedId(questId)
    setNoSpots(null)
    setFavoriteMessage(null)
  }

  const toggleFavorite = (quest: AiQuest) => {
    const result = aiQuestHistory.toggleFavorite(quest)
    setFavoriteMessage(
      result === 'full'
        ? `お気に入りは${MAX_FAVORITE_QUESTS}件までです。どれかの ★ を外してから保存してください。`
        : result === 'added'
          ? `「${quest.title}」をお気に入りに保存しました。`
          : `「${quest.title}」をお気に入りから外しました。`,
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
      <Card>
        <CardTitle
          aside={
            <span className="rounded-full border-2 border-ink bg-mikan-100 px-2.5 py-0.5 text-sm font-bold" aria-live="polite">
              今日あと {remaining ?? '—'} 回{status ? ` / ${status.dailyLimit}回` : ''}
            </span>
          }
        >
          AI散策クエストを作る
        </CardTitle>
        <form onSubmit={onSubmit} className="space-y-5">
          <label className="block">
            <span className="font-bold">出発地点</span>
            <select
              value={startSpotId}
              onChange={(e) => setStartSpotId(e.target.value)}
              className="mt-1 block min-h-12 w-full rounded-xl border-[3px] border-ink bg-white px-3 text-lg"
            >
              {SPOTS.map((spot) => (
                <option key={spot.spotId} value={spot.spotId}>
                  {spot.name}周辺（{spot.municipality}）
                </option>
              ))}
              <option value="current">現在地から（位置情報を1回だけ使います）</option>
            </select>
          </label>

          <ChoiceGroup
            legend="散歩の時間"
            columns={4}
            value={minutes}
            onChange={setMinutes}
            options={AI_QUEST_MINUTES.map((m) => ({ value: `${m}` as const, label: `${m}分` }))}
          />

          <ChoiceGroup
            legend="興味のあるジャンル"
            columns={3}
            value={genre}
            onChange={setGenre}
            options={QUEST_GENRES.map((g) => ({ value: g.id, label: g.label }))}
          />

          <ChoiceGroup<Distance>
            legend="歩く距離（任意）"
            columns={3}
            value={distance}
            onChange={setDistance}
            options={[
              { value: 'none', label: '指定なし' },
              ...AI_QUEST_DISTANCES_M.map((m) => ({ value: `${m}` as Distance, label: `${m / 1000}kmまで` })),
            ]}
          />

          <button
            type="submit"
            disabled={generate.pending || outOfQuota}
            aria-busy={generate.pending}
            className="rpg-button min-h-14 w-full bg-mikan-500 text-xl text-white [text-shadow:1px_1px_0_var(--color-ink)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {generate.pending ? 'AIが考えています…' : 'AIに散策コースを提案してもらう'}
          </button>
          {generate.pending && (
            <p role="status" className="flex items-center justify-center gap-2 text-sm font-bold text-mikan-800">
              <span aria-hidden="true" className="inline-block size-3 animate-ping rounded-full bg-mikan-500 motion-reduce:animate-none" />
              登録スポットの中から、条件に合うコースを考えています（数秒〜20秒ほど）
            </p>
          )}
          {outOfQuota && !generate.pending && (
            <p className="text-sm font-bold text-mikan-800">今日の回数を使い切りました。また明日お試しください。</p>
          )}
          {generate.error && (
            <p role="alert" className="rounded-xl border-[3px] border-red-700 bg-red-50 px-3 py-2 text-sm font-bold text-red-800">
              {generate.error}
            </p>
          )}
          <p className="text-xs text-ink-soft">
            訪問先は、情報源を確認して登録したスポットの中からだけ選びます。AIの利用料金を抑えるため、1日{status?.dailyLimit ?? 5}
            回までです。同じ条件の提案はしばらく使い回します（回数は減りません）。
          </p>
        </form>
      </Card>

      <div className="space-y-4">
        <div aria-live="polite" className="space-y-4">
          {noSpots && (
            <Card className="bg-mikan-50">
              <CardTitle>条件に合うスポットが見つかりませんでした</CardTitle>
              {noSpots.nearest ? (
                <p>
                  いちばん近い登録スポットは
                  <Link to={`/adventure/spots/${noSpots.nearest.spotId}`} className="mx-1 font-bold text-seto-700 underline">
                    {noSpots.nearest.name}
                  </Link>
                  で、直線で約{formatKm(noSpots.nearest.distanceM)}km離れています。時間や距離を長くするか、出発地点を変えてみてください。
                </p>
              ) : (
                <p>登録スポットがありません。</p>
              )}
              <p className="mt-2 text-sm text-ink-soft">AIは呼んでいないため、回数は減っていません。</p>
            </Card>
          )}
          {shown ? (
            <AiQuestCard
              quest={shown}
              label={shown.questId === history.recent[0]?.questId ? '最新の提案' : '保存した提案'}
              cached={justGenerated?.questId === shown.questId && justGenerated.cached}
              favorite={history.favorites.some((q) => q.questId === shown.questId)}
              onToggleFavorite={() => toggleFavorite(shown)}
            />
          ) : (
            !noSpots && (
              <Card className="bg-cream">
                <p className="text-ink-soft">条件を選んで「AIに散策コースを提案してもらう」を押すと、ここに散策クエストが表示されます。</p>
              </Card>
            )
          )}
          {favoriteMessage && (
            <p role="status" className="rounded-xl border-2 border-mikan-600 bg-white px-3 py-2 text-sm font-bold text-mikan-800">
              {favoriteMessage}
            </p>
          )}
        </div>

        <SavedQuestList
          title="お気に入り"
          counter={`${history.favorites.length} / ${MAX_FAVORITE_QUESTS}`}
          empty="気に入った提案の ☆ を押すと、ここに保存されます（10件まで）。"
          quests={history.favorites}
          selectedId={shown?.questId ?? null}
          favoriteIds={favoriteIds}
          onSelect={select}
          onToggleFavorite={toggleFavorite}
        />
        <SavedQuestList
          title="最近の提案"
          counter={`直近${MAX_RECENT_QUESTS}件`}
          empty="まだ提案はありません。"
          quests={history.recent}
          selectedId={shown?.questId ?? null}
          favoriteIds={favoriteIds}
          onSelect={select}
          onToggleFavorite={toggleFavorite}
        />
        {aiQuestHistory.saveFailed && (
          <p role="alert" className="text-sm font-bold text-red-800">
            提案をこの端末に保存できませんでした（空き容量が足りない可能性があります）。ページを閉じると消えます。
          </p>
        )}
        <p className="text-xs text-ink-soft">提案はこの端末のブラウザにだけ保存します。現在地の位置は保存しません。</p>
      </div>
    </div>
  )
}

function StarButton({ favorite, onClick, compact = false }: { favorite: boolean; onClick: () => void; compact?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={favorite}
      aria-label={favorite ? 'お気に入りから外す' : 'お気に入りに保存する'}
      className={`flex shrink-0 items-center justify-center gap-1 rounded-xl border-[3px] font-bold ${
        favorite ? 'border-ink bg-yellow-300 text-ink' : 'border-ink/30 bg-white text-ink-soft'
      } ${compact ? 'size-11 text-xl' : 'min-h-11 px-3 text-sm'}`}
    >
      <span aria-hidden="true" className="text-xl leading-none">
        {favorite ? '★' : '☆'}
      </span>
      {!compact && <span>{favorite ? 'お気に入り' : 'お気に入りに保存'}</span>}
    </button>
  )
}

const formatSavedAt = (iso: string) =>
  new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  )

function SavedQuestList(props: {
  title: string
  counter: string
  empty: string
  quests: AiQuest[]
  selectedId: string | null
  favoriteIds: ReadonlySet<string>
  onSelect: (questId: string) => void
  onToggleFavorite: (quest: AiQuest) => void
}) {
  return (
    <Card>
      <CardTitle aside={<span className="text-sm text-ink-soft">{props.counter}</span>}>{props.title}</CardTitle>
      {props.quests.length === 0 ? (
        <p className="text-sm text-ink-soft">{props.empty}</p>
      ) : (
        <ul className="space-y-2">
          {props.quests.map((quest) => {
            const selected = quest.questId === props.selectedId
            return (
              <li key={quest.questId} className="flex items-stretch gap-2">
                <button
                  type="button"
                  onClick={() => props.onSelect(quest.questId)}
                  aria-current={selected ? 'true' : undefined}
                  className={`min-w-0 flex-1 rounded-xl border-[3px] px-3 py-2 text-left ${
                    selected ? 'border-ink bg-mikan-100' : 'border-ink/20 bg-white hover:border-ink'
                  }`}
                >
                  <span className="block truncate font-bold">{quest.title}</span>
                  <span className="block truncate text-xs text-ink-soft">
                    {quest.startLabel}・{quest.spots.map((s) => s.name).join(' → ')}・{formatSavedAt(quest.createdAt)}
                  </span>
                </button>
                <StarButton compact favorite={props.favoriteIds.has(quest.questId)} onClick={() => props.onToggleFavorite(quest)} />
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

function AiQuestCard({
  quest,
  label,
  cached,
  favorite,
  onToggleFavorite,
}: {
  quest: AiQuest
  label: string
  cached: boolean
  favorite: boolean
  onToggleFavorite: () => void
}) {
  return (
    <Card className="border-mikan-600 bg-mikan-50">
      <CardTitle
        aside={
          <span className="flex flex-wrap gap-1">
            {quest.generatedBy === 'bedrock' ? <Badge tone="mikan">AI（Bedrock）</Badge> : <Badge tone="gray">モック</Badge>}
            {cached && <Badge tone="seto">前回の提案</Badge>}
          </span>
        }
      >
        {label}
      </CardTitle>
      <div className="-mt-1 mb-2 flex justify-end">
        <StarButton favorite={favorite} onClick={onToggleFavorite} />
      </div>
      {quest.generatedBy === 'mock' && (
        <p className="-mt-2 mb-2 text-xs text-ink-soft">AIに接続していないため、規則に沿って作った仮の提案です。</p>
      )}
      <p className="font-pixel text-2xl text-mikan-800">{quest.title}</p>
      <p className="mt-1">{quest.description}</p>
      <p className="mt-2 text-sm">
        出発：<span className="font-bold">{quest.startLabel}</span>
      </p>

      <ol className="mt-3 space-y-2" aria-label="訪問する順番">
        {quest.spots.map((spot) => (
          <li key={spot.spotId}>
            {spot.order > 1 && spot.legM > 0 && (
              <p className="py-1 pl-4 text-xs text-ink-soft">↓ 約{formatKm(spot.legM)}km（直線距離からの目安）</p>
            )}
            <Link
              to={`/adventure/spots/${spot.spotId}`}
              className="flex items-start gap-3 rounded-xl border-2 border-ink/20 bg-white p-2.5 hover:border-ink"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-mikan-500 font-pixel text-white">
                {spot.order}
              </span>
              <span className="min-w-0">
                <span className="block font-bold">
                  {spot.name}
                  <span className="ml-2 text-sm font-normal text-ink-soft">{spot.municipality}</span>
                </span>
                <span className="mt-0.5 block text-sm">{spot.description}</span>
                <span className="mt-0.5 block text-xs text-mikan-800">
                  限定アイテム：{getItem(getSpot(spot.spotId)?.rewardItemId)?.name ?? '―'}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ol>

      <div className="mt-3 rounded-xl border-2 border-dashed border-mikan-600 bg-white p-3">
        <p className="font-bold">推定所要時間：約{quest.estimatedMinutes}分</p>
        {quest.route.distanceM > 0 ? (
          <p className="mt-1 text-sm">
            歩く距離の目安：約{formatKm(quest.route.distanceM)}km・約{quest.route.steps.toLocaleString('ja-JP')}歩（徒歩 約{quest.route.minutes}分）
          </p>
        ) : (
          <p className="mt-1 text-sm">出発地点のスポットとその周辺を散策するクエストです（スポット間の移動はありません）。</p>
        )}
        <p className="mt-1 text-xs text-ink-soft">
          所要時間はAIの推定、距離はスポット間の直線距離から出した目安です。実際の道のり・徒歩時間は保証できません（経路の確認は今後の地図機能で対応します）。
        </p>
      </div>
      <p className="mt-2 text-xs text-ink-soft">歩きスマホはやめましょう。立入禁止の場所には入らず、体調に合わせて休憩してください。</p>
    </Card>
  )
}

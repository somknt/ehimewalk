import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { api, type QuestGenerationResult, type QuestRequest } from '../../api'
import { ChoiceGroup } from '../../components/forms'
import { Card, CardTitle } from '../../components/ui'
import { QUEST_INTERESTS, SPOTS } from '../../data/spots'
import type { WalkingLoad } from '../../domain/types'
import { useAction } from '../../hooks/useAction'
import { getCurrentPosition } from '../geo/getCurrentPosition'
import { QuestCard } from './QuestCard'

const MINUTE_OPTIONS = ['15', '30', '45', '60', '90'] as const
const LOAD_OPTIONS: { value: WalkingLoad; label: string }[] = [
  { value: 'easy', label: 'ゆったり' },
  { value: 'normal', label: 'ふつう' },
  { value: 'active', label: 'しっかり' },
]

/** AI 散策クエストの条件入力。訪問先は登録スポットから選ぶ */
export function QuestPlanner() {
  const [startSpotId, setStartSpotId] = useState<string>(SPOTS[0].spotId)
  const [minutes, setMinutes] = useState<(typeof MINUTE_OPTIONS)[number]>('45')
  const [interests, setInterests] = useState<string[]>(['歴史'])
  const [load, setLoad] = useState<WalkingLoad>('normal')
  const [result, setResult] = useState<QuestGenerationResult | null>(null)

  const generate = useAction(async () => {
    const request: QuestRequest = { startSpotId, minutes: Number(minutes), interests, load }
    if (startSpotId === 'current') request.currentLocation = await getCurrentPosition()
    setResult(await api.generateQuest(request))
  })

  const toggleInterest = (tag: string) =>
    setInterests((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]))

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    void generate.run()
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
      <Card>
        <CardTitle>AI散策クエストを作る</CardTitle>
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
              <option value="current">現在地（位置情報を1回だけ使います）</option>
            </select>
          </label>

          <ChoiceGroup
            legend="散策時間"
            columns={5}
            value={minutes}
            onChange={setMinutes}
            options={MINUTE_OPTIONS.map((m) => ({ value: m, label: `${m}分` }))}
          />

          <fieldset>
            <legend className="mb-2 font-bold">興味のあるジャンル（いくつでも）</legend>
            <div className="flex flex-wrap gap-2">
              {QUEST_INTERESTS.map((tag) => {
                const checked = interests.includes(tag)
                return (
                  <label
                    key={tag}
                    className={`flex min-h-12 cursor-pointer items-center rounded-full border-[3px] px-4 has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-seto-500 ${
                      checked ? 'border-ink bg-seto-100 font-bold' : 'border-ink/25 bg-white'
                    }`}
                  >
                    <input type="checkbox" className="sr-only" checked={checked} onChange={() => toggleInterest(tag)} />
                    {checked && <span aria-hidden="true" className="mr-1">✓</span>}
                    {tag}
                  </label>
                )
              })}
            </div>
          </fieldset>

          <ChoiceGroup legend="歩くペース" value={load} onChange={setLoad} options={LOAD_OPTIONS} />

          <button
            type="submit"
            disabled={generate.pending}
            className="rpg-button w-full bg-seto-400 text-xl disabled:opacity-60"
          >
            {generate.pending ? '考えています…' : 'クエストを提案してもらう'}
          </button>
          {generate.error && (
            <p role="alert" className="text-sm font-bold text-red-700">
              {generate.error}
            </p>
          )}
          <p className="text-xs text-ink-soft">
            訪問先は、情報源を確認して登録したスポットの中からだけ選びます。いまはAI未接続のため、規則に沿って選ぶモックで動いています。
          </p>
        </form>
      </Card>

      <div aria-live="polite">
        {result?.status === 'ok' && (
          <QuestCard
            quest={result.quest}
            heading="あなたへのクエスト"
            showIntro
            footer={<p className="mt-3 text-center text-sm text-ink-soft">今日あと {result.remainingToday} 回作れます</p>}
          />
        )}
        {result?.status === 'no_spots' && (
          <Card className="bg-mikan-50">
            <CardTitle>条件に合うスポットが見つかりませんでした</CardTitle>
            {result.nearest ? (
              <p>
                いちばん近い登録スポットは
                <Link to={`/adventure/spots/${result.nearest.spotId}`} className="mx-1 font-bold text-seto-700 underline">
                  {result.nearest.name}
                </Link>
                で、直線で約{(result.nearest.distanceM / 1000).toFixed(1)}km離れています。散策時間を長くするか、出発地点を変えてみてください。
              </p>
            ) : (
              <p>登録スポットがありません。</p>
            )}
            <p className="mt-2 text-sm text-ink-soft">今日あと {result.remainingToday} 回作れます</p>
          </Card>
        )}
        {result?.status === 'quota_exceeded' && (
          <Card className="bg-mikan-50">
            <CardTitle>今日の提案回数の上限に達しました</CardTitle>
            <p>AIの利用料金を抑えるため、1日の回数に上限があります。また明日お試しください。</p>
          </Card>
        )}
        {!result && (
          <Card className="bg-cream">
            <p className="text-ink-soft">条件を選んで「クエストを提案してもらう」を押すと、ここに散策プランが表示されます。</p>
          </Card>
        )}
      </div>
    </div>
  )
}

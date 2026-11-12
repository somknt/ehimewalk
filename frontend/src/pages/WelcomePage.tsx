import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { api } from '../api'
import { TextField } from '../components/forms'
import { Card } from '../components/ui'
import { STARTER_BOTTOM_IDS, STARTER_EQUIPMENT, STARTER_TOP_IDS, getItem } from '../data/items'
import type { Appearance, Character } from '../domain/types'
import { AppearanceFields } from '../features/character/AppearanceFields'
import { CharacterAvatar } from '../features/character/CharacterAvatar'
import { useAction } from '../hooks/useAction'
import { useSession } from '../session/sessionContext'

/** 服の選択肢。選んだ服を着たキャラクターで見せる */
function OutfitChoice({
  legend,
  ids,
  value,
  onChange,
  preview,
}: {
  legend: string
  ids: readonly string[]
  value: string
  onChange: (id: string) => void
  preview: (id: string) => Character
}) {
  return (
    <fieldset>
      <legend className="mb-2 font-bold">{legend}</legend>
      <div className="grid grid-cols-3 gap-2">
        {ids.map((id) => {
          const checked = id === value
          return (
            <label
              key={id}
              className={`flex cursor-pointer flex-col items-center gap-1 rounded-xl border-[3px] p-2 text-center text-sm has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-seto-500 ${
                checked ? 'border-ink bg-mikan-100 font-bold' : 'border-ink/25 bg-white'
              }`}
            >
              <input type="radio" name={legend} className="sr-only" checked={checked} onChange={() => onChange(id)} />
              <CharacterAvatar character={preview(id)} scale={3} showBackground={false} showPet={false} className="h-16" />
              <span>{getItem(id)?.name}</span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

export function WelcomePage() {
  const { session, setSession } = useSession()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [characterName, setCharacterName] = useState('')
  const [appearance, setAppearance] = useState<Appearance>(session.character.appearance)
  const [topItemId, setTopItemId] = useState<string>(STARTER_TOP_IDS[0])
  const [bottomItemId, setBottomItemId] = useState<string>(STARTER_BOTTOM_IDS[0])

  const submit = useAction(async () => {
    const next = await api.completeOnboarding({ username, characterName, appearance, topItemId, bottomItemId })
    setSession(next)
    navigate('/', { replace: true })
  })

  if (session.profile.onboarded) return <Navigate to="/" replace />

  const character = (top = topItemId, bottom = bottomItemId): Character => ({
    name: characterName || 'あなたのキャラクター',
    appearance,
    equipped: { ...STARTER_EQUIPMENT, top, bottom },
  })

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    void submit.run()
  }

  return (
    <div className="min-h-dvh bg-cream">
      <header className="border-b-[3px] border-ink bg-mikan-500 px-4 py-4 text-center">
        <h1 className="font-pixel text-2xl text-white [text-shadow:2px_2px_0_var(--color-ink)]">えひめウォーククエスト</h1>
        <p className="mt-1 font-pixel text-white [text-shadow:1px_1px_0_var(--color-ink)]">
          歩く楽しさが、健康と愛媛の未来をつくる。
        </p>
      </header>

      <form onSubmit={onSubmit} className="mx-auto max-w-md px-4 py-6 md:max-w-4xl md:grid md:grid-cols-[1fr_1.3fr] md:gap-6">
        <div className="md:sticky md:top-6 md:self-start">
          <Card className="overflow-hidden p-0">
            <CharacterAvatar character={character()} scale={10} animated className="h-60 pb-3" />
            <p className="border-t-[3px] border-ink p-3 text-center font-pixel text-xl">{character().name}</p>
          </Card>
          <p className="mt-3 text-center text-ink-soft">いっしょに愛媛を冒険するキャラクターをつくろう！</p>
        </div>

        <div className="mt-4 space-y-5 md:mt-0">
          <Card className="space-y-4">
            <h2 className="font-pixel text-lg">なまえ</h2>
            <TextField
              label="キャラクターの名前"
              value={characterName}
              onChange={setCharacterName}
              maxLength={12}
              hint="12文字まで"
            />
            <TextField
              label="ユーザー名（ランキングに表示）"
              value={username}
              onChange={setUsername}
              maxLength={12}
              hint="12文字まで。本名は入れないでください。"
            />
          </Card>

          <Card>
            <h2 className="mb-4 font-pixel text-lg">みため</h2>
            <AppearanceFields value={appearance} onChange={setAppearance} />
          </Card>

          <Card className="space-y-5">
            <h2 className="font-pixel text-lg">さいしょの服</h2>
            <OutfitChoice
              legend="上半身"
              ids={STARTER_TOP_IDS}
              value={topItemId}
              onChange={setTopItemId}
              preview={(id) => character(id, bottomItemId)}
            />
            <OutfitChoice
              legend="下半身"
              ids={STARTER_BOTTOM_IDS}
              value={bottomItemId}
              onChange={setBottomItemId}
              preview={(id) => character(topItemId, id)}
            />
          </Card>

          {submit.error && (
            <p role="alert" className="rounded-xl border-[3px] border-red-700 bg-red-50 p-3 font-bold text-red-800">
              {submit.error}
            </p>
          )}
          <button
            type="submit"
            disabled={submit.pending}
            className="rpg-button w-full bg-mikan-500 text-xl text-white [text-shadow:1px_1px_0_var(--color-ink)] disabled:opacity-60"
          >
            {submit.pending ? 'つくっています…' : 'この姿で冒険をはじめる'}
          </button>
          <p className="text-center text-sm text-ink-soft">見た目や名前は、あとから変えられます。</p>
        </div>
      </form>
    </div>
  )
}

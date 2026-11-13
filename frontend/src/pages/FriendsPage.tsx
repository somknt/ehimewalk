import { useCallback, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import { api, type FriendCandidate, type FriendEntry, type FriendsData } from '../api'
import { Badge, Card, CardTitle, ErrorMessage, LoadingCards, PageTitle } from '../components/ui'
import { CharacterAvatar } from '../features/character/CharacterAvatar'
import { CheerButtons } from '../features/friends/CheerButtons'
import { useAction } from '../hooks/useAction'
import { useAsyncData } from '../hooks/useAsyncData'

const loadFriends = () => api.getFriends()

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' }).format(new Date(iso))

/** 4 文字ずつに区切って読みやすくする（例：ABCD-EFGH） */
const formatCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`

function Person({
  name,
  title,
  character,
  children,
}: {
  name: string
  title: string
  character: FriendEntry['character']
  children?: ReactNode
}) {
  return (
    <div className="flex items-center gap-3">
      <CharacterAvatar character={character} scale={3} showPet={false} className="h-16 w-12 shrink-0 rounded-lg border-2 border-ink/20" />
      <div className="min-w-0 flex-1">
        <p className="font-bold break-all">{name}</p>
        <p className="text-sm text-ink-soft">{title}</p>
        {children}
      </div>
    </div>
  )
}

function MyCodeCard({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }
  const share = async () => {
    try {
      await navigator.share({ title: 'えひめウォーククエスト', text: `えひめウォーククエストでフレンドになろう！フレンドコード：${code}` })
    } catch {
      // 共有を取りやめた場合など
    }
  }
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  return (
    <Card className="bg-mikan-50">
      <CardTitle>あなたのフレンドコード</CardTitle>
      <p className="text-center font-pixel text-4xl tracking-widest" aria-label={`フレンドコード ${code.split('').join(' ')}`}>
        {formatCode(code)}
      </p>
      <div className="mt-3 grid gap-2" style={{ gridTemplateColumns: canShare ? '1fr 1fr' : '1fr' }}>
        <button type="button" onClick={() => void copy()} className="rpg-button bg-white text-base">
          {copied ? 'コピーしました' : 'コピーする'}
        </button>
        {canShare && (
          <button type="button" onClick={() => void share()} className="rpg-button bg-white text-base">
            共有する
          </button>
        )}
      </div>
      <p className="mt-2 text-xs text-ink-soft">このコードを友だちに伝えると、フレンド申請してもらえます。フレンドには名前・見た目・称号・週間歩数が見えます。位置情報や訪れた場所は見えません。</p>
    </Card>
  )
}

function AddFriendCard({ data, onChange }: { data: FriendsData; onChange: (data: FriendsData) => void }) {
  const [code, setCode] = useState('')
  const [candidate, setCandidate] = useState<FriendCandidate | null | undefined>(undefined)
  const [message, setMessage] = useState<string | null>(null)
  const search = useAction(async (value: string) => {
    setMessage(null)
    setCandidate(await api.findUserByFriendCode(value))
  })
  const request = useAction(async () => {
    const next = await api.sendFriendRequest(code)
    onChange(next)
    const becameFriend = next.friends.some((f) => f.userId === candidate?.userId)
    setMessage(becameFriend ? 'フレンドになりました！' : 'フレンド申請を送りました。相手が承認するとフレンドになります。')
    setCandidate(undefined)
    setCode('')
  })
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void search.run(code)
  }
  const error = search.error ?? request.error
  const relationLabel: Record<FriendCandidate['relation'], string> = {
    self: 'あなたのフレンドコードです',
    friend: 'すでにフレンドです',
    pending_sent: '申請中です（相手の承認待ち）',
    pending_received: 'この人から申請が届いています',
    none: '',
  }

  return (
    <Card>
      <CardTitle>フレンドを追加</CardTitle>
      <form onSubmit={onSubmit} className="flex items-end gap-2">
        <label className="min-w-0 flex-1">
          <span className="font-bold">友だちのフレンドコード</span>
          <input
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={9}
            placeholder="ABCD-EFGH"
            value={code}
            onChange={(e) => {
              setCode(e.target.value)
              setCandidate(undefined)
            }}
            className="mt-1 block min-h-12 w-full rounded-xl border-[3px] border-ink bg-white px-3 font-pixel text-xl tracking-widest uppercase"
          />
        </label>
        <button type="submit" disabled={search.pending || code.trim().length === 0} className="rpg-button bg-seto-400 disabled:opacity-60">
          探す
        </button>
      </form>

      {error && (
        <p role="alert" className="mt-2 text-sm font-bold text-red-700">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="mt-2 text-sm font-bold text-leaf-700">
          {message}
        </p>
      )}
      {candidate === null && (
        <p role="status" className="mt-3 rounded-xl bg-cream p-3 text-sm">
          このフレンドコードのユーザーは見つかりませんでした。コードを確かめてください。
        </p>
      )}
      {candidate && (
        <div className="mt-3 rounded-xl border-[3px] border-ink/20 bg-white p-3" aria-live="polite">
          <Person name={candidate.username} title={candidate.title} character={candidate.character} />
          {candidate.relation === 'none' || candidate.relation === 'pending_received' ? (
            <button
              type="button"
              onClick={() => void request.run()}
              disabled={request.pending}
              className="rpg-button mt-3 w-full bg-mikan-500 text-white [text-shadow:1px_1px_0_var(--color-ink)] disabled:opacity-60"
            >
              {candidate.relation === 'pending_received' ? '申請を承認してフレンドになる' : 'フレンド申請を送る'}
            </button>
          ) : (
            <p className="mt-2 text-sm font-bold text-ink-soft">{relationLabel[candidate.relation]}</p>
          )}
        </div>
      )}

      {data.sampleCodes.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer py-1 font-bold text-seto-700">試しに使えるフレンドコード（モック）</summary>
          <p className="mt-1 text-xs text-ink-soft">いまはAWS未接続のため、架空のサンプルユーザーとフレンドになれます。申請すると、数秒後に承認されます。</p>
          <ul className="mt-2 space-y-1">
            {data.sampleCodes.map((sample) => (
              <li key={sample.friendCode}>
                <button
                  type="button"
                  onClick={() => {
                    setCode(sample.friendCode)
                    void search.run(sample.friendCode)
                  }}
                  className="flex min-h-10 w-full items-center justify-between gap-2 rounded-lg bg-cream px-3 text-left"
                >
                  <span>{sample.username}</span>
                  <span className="font-pixel tracking-widest">{formatCode(sample.friendCode)}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  )
}

function RequestsCard({ data, onChange }: { data: FriendsData; onChange: (data: FriendsData) => void }) {
  const respond = useAction(async (userId: string, accept: boolean) => onChange(await api.respondFriendRequest(userId, accept)))
  const cancel = useAction(async (userId: string) => onChange(await api.removeFriend(userId)))
  if (data.incoming.length === 0 && data.outgoing.length === 0) return null
  const error = respond.error ?? cancel.error

  return (
    <Card>
      <CardTitle aside={data.incoming.length > 0 ? <Badge tone="mikan">{data.incoming.length}件</Badge> : undefined}>フレンド申請</CardTitle>
      {data.incoming.length > 0 && (
        <>
          <h3 className="mb-2 text-sm font-bold">届いた申請</h3>
          <ul className="space-y-2">
            {data.incoming.map((entry) => (
              <li key={entry.userId} className="rounded-xl border-[3px] border-mikan-500 bg-mikan-50 p-3">
                <Person name={entry.username} title={entry.title} character={entry.character}>
                  <p className="text-xs text-ink-soft">{formatDate(entry.since)}に届きました</p>
                </Person>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => void respond.run(entry.userId, true)}
                    disabled={respond.pending}
                    className="rpg-button bg-leaf-500 text-base text-white [text-shadow:1px_1px_0_var(--color-ink)] disabled:opacity-60"
                  >
                    承認する
                  </button>
                  <button
                    type="button"
                    onClick={() => void respond.run(entry.userId, false)}
                    disabled={respond.pending}
                    className="rpg-button bg-white text-base disabled:opacity-60"
                  >
                    見送る
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {data.outgoing.length > 0 && (
        <>
          <h3 className="mt-4 mb-2 text-sm font-bold">送った申請（承認待ち）</h3>
          <ul className="space-y-2">
            {data.outgoing.map((entry) => (
              <li key={entry.userId} className="rounded-xl border-2 border-ink/15 bg-white p-3">
                <Person name={entry.username} title={entry.title} character={entry.character}>
                  <p className="text-xs text-ink-soft">{formatDate(entry.since)}に申請</p>
                </Person>
                <button
                  type="button"
                  onClick={() => void cancel.run(entry.userId)}
                  disabled={cancel.pending}
                  className="mt-2 text-sm font-bold text-ink-soft underline"
                >
                  申請を取り消す
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm font-bold text-red-700">
          {error}
        </p>
      )}
    </Card>
  )
}

function FriendListCard({ data, onChange, onCheered }: { data: FriendsData; onChange: (data: FriendsData) => void; onCheered: () => void }) {
  const remove = useAction(async (userId: string) => onChange(await api.removeFriend(userId)))
  const onRemove = (entry: FriendEntry) => {
    if (window.confirm(`${entry.username}さんとのフレンドを解除しますか？`)) void remove.run(entry.userId)
  }

  return (
    <Card>
      <CardTitle aside={<span className="font-pixel">{data.friends.length} / {data.limit}</span>}>フレンド</CardTitle>
      {data.friends.length === 0 ? (
        <p className="rounded-xl bg-cream p-4 text-center text-ink-soft">
          まだフレンドがいません。フレンドコードで友だちを追加して、いっしょに歩こう！
        </p>
      ) : (
        <ul className="space-y-2">
          {data.friends.map((entry) => (
            <li key={entry.userId} className="rounded-xl border-[3px] border-ink/15 bg-white p-3">
              <Person name={entry.username} title={entry.title} character={entry.character}>
                <p className="text-sm">
                  今週 <span className="font-pixel text-lg">{(entry.weeklySteps ?? 0).toLocaleString('ja-JP')}</span> 歩
                </p>
                {entry.isSample && <span className="text-xs text-ink-soft">サンプル</span>}
              </Person>
              <div className="mt-2 border-t border-ink/10 pt-2">
                <CheerButtons userId={entry.userId} onSent={onCheered} />
                <div className="mt-2 flex items-center justify-between text-xs text-ink-soft">
                  <span>
                    {formatDate(entry.since)}からフレンド{entry.cheersSent > 0 && `・応援 ${entry.cheersSent}回`}
                  </span>
                  <button type="button" onClick={() => onRemove(entry)} disabled={remove.pending} className="min-h-10 px-2 font-bold underline">
                    解除
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {remove.error && (
        <p role="alert" className="mt-2 text-sm font-bold text-red-700">
          {remove.error}
        </p>
      )}
      {data.friends.length > 0 && (
        <Link to="/ranking" className="rpg-button mt-3 w-full bg-white">
          フレンドランキングを見る
        </Link>
      )}
    </Card>
  )
}

export function FriendsPage() {
  const { state, reload, refresh, update } = useAsyncData(loadFriends)
  const replace = useCallback((data: FriendsData) => update(() => data), [update])

  return (
    <div className="space-y-4">
      <PageTitle lead="フレンドと週間歩数を比べたり、応援を送り合ったりしよう。">フレンド</PageTitle>
      {state.status === 'loading' && <LoadingCards count={3} />}
      {state.status === 'error' && <ErrorMessage message={state.message} onRetry={reload} />}
      {state.status === 'ready' && (
        <div className="grid gap-4 md:grid-cols-2 md:items-start">
          <div className="space-y-4">
            <MyCodeCard code={state.data.myFriendCode} />
            <AddFriendCard data={state.data} onChange={replace} />
          </div>
          <div className="space-y-4">
            <RequestsCard data={state.data} onChange={replace} />
            <FriendListCard data={state.data} onChange={replace} onCheered={() => void refresh()} />
            {state.data.outgoing.length > 0 && (
              <button type="button" onClick={() => void refresh()} className="rpg-button w-full bg-white">
                申請の状況を更新する
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

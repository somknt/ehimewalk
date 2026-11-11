import { Link, Navigate, Outlet } from 'react-router'
import { api } from '../api'
import { useSession } from '../session/sessionContext'
import { BottomNav } from './BottomNav'
import { SideNav } from './SideNav'

/**
 * 画面幅ごとのレイアウト
 * - スマートフォン（〜767px）：1 列、下部ナビ
 * - タブレット（768〜1023px）：内容を少し広げる、下部ナビ
 * - パソコン（1024px〜）：左側メニュー + 広い内容エリア
 */
export function AppLayout() {
  const { session } = useSession()

  // 初回はキャラクター作成から始める
  if (!session.profile.onboarded) return <Navigate to="/welcome" replace />

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b-[3px] border-ink bg-mikan-500">
        <div className="mx-auto flex max-w-md items-center justify-between gap-2 px-4 py-2 md:max-w-3xl lg:max-w-6xl lg:px-6 lg:py-3">
          <Link to="/" className="font-pixel text-lg text-white [text-shadow:2px_2px_0_var(--color-ink)] lg:text-2xl">
            えひめウォーククエスト
          </Link>
          <p className="hidden font-pixel text-white [text-shadow:1px_1px_0_var(--color-ink)] xl:block">
            歩く楽しさが、健康と愛媛の未来をつくる。
          </p>
          <Link
            to="/gacha"
            className="shrink-0 rounded-full border-2 border-ink bg-white px-3 py-1 font-pixel text-mikan-700"
            aria-label={`所持ポイント ${session.balance.balance}pt（ガチャへ）`}
          >
            {session.balance.balance.toLocaleString('ja-JP')}pt
          </Link>
        </div>
        {api.mode === 'mock' && (
          <p role="status" className="bg-mikan-100 px-4 py-1.5 text-center text-sm font-bold text-mikan-800">
            モック動作中：データはこの端末だけに保存されます
          </p>
        )}
      </header>

      <div className="mx-auto max-w-md md:max-w-3xl lg:flex lg:max-w-6xl lg:gap-6 lg:px-6 lg:pt-6">
        <SideNav />
        <main className="min-w-0 px-4 pt-4 pb-28 lg:flex-1 lg:px-0 lg:pt-0 lg:pb-10">
          <Outlet />
        </main>
      </div>

      <BottomNav />
    </div>
  )
}

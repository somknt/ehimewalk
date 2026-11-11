import { Link, Outlet } from 'react-router'
import { api } from '../api'
import { BottomNav } from './BottomNav'

export function AppLayout() {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b-[3px] border-ink bg-mikan-500">
        <div className="mx-auto flex max-w-md items-center justify-between px-4 py-2">
          <Link to="/" className="font-pixel text-lg text-white [text-shadow:2px_2px_0_var(--color-ink)]">
            えひめウォーククエスト
          </Link>
        </div>
        {api.mode === 'mock' && (
          <p role="status" className="bg-mikan-100 px-4 py-1.5 text-center text-sm font-bold text-mikan-800">
            モック動作中：データはこの端末だけに保存されます
          </p>
        )}
      </header>

      <main className="mx-auto max-w-md px-4 pt-4 pb-28">
        <Outlet />
      </main>

      <BottomNav />
    </div>
  )
}

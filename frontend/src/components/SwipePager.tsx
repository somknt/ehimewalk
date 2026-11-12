import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

export interface PagerPage {
  id: string
  /** インジケーターに出す短い名前 */
  label: string
  content: ReactNode
}

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/**
 * 左右スワイプで切り替えるページ。
 * - 横方向はブラウザのスクロールスナップで動かすため、縦スクロールとは干渉しない（指の向きでブラウザが判定する）
 * - 縦方向は画面（ページ全体）がスクロールする。表示中のページの高さに合わせるので、短いページで余白をスクロールしない
 * - 下部のインジケーターのタップ・クリック、左右キーでも切り替えられる
 */
export function SwipePager({ pages, label }: { pages: PagerPage[]; label: string }) {
  const baseId = useId()
  const trackRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<(HTMLDivElement | null)[]>([])
  const [active, setActive] = useState(0)
  const [height, setHeight] = useState<number | undefined>(undefined)

  // 表示中のページの高さに合わせる（中身が増えたときも追従する）
  useLayoutEffect(() => {
    const el = pageRefs.current[active]
    if (!el) return
    const update = () => setHeight(el.offsetHeight)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [active])

  /** ページが変わったら、ページの先頭が見える位置まで戻す（下までスクロールしていた場合） */
  const revealTop = useCallback(() => {
    const track = trackRef.current
    if (!track) return
    const top = track.getBoundingClientRect().top + window.scrollY - 120
    if (window.scrollY > top) window.scrollTo({ top: Math.max(0, top), behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  }, [])

  // スワイプで止まった位置から、表示中のページを決める
  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    let frame = 0
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const index = Math.round(track.scrollLeft / Math.max(1, track.clientWidth))
        setActive((current) => {
          if (current === index) return current
          revealTop()
          return Math.min(pages.length - 1, Math.max(0, index))
        })
      })
    }
    track.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      track.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [pages.length, revealTop])

  const goTo = (index: number) => {
    const track = trackRef.current
    const next = Math.min(pages.length - 1, Math.max(0, index))
    if (!track) return
    track.scrollTo({ left: next * track.clientWidth, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
    setActive(next)
    revealTop()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const next = (active + (event.key === 'ArrowRight' ? 1 : pages.length - 1)) % pages.length
    goTo(next)
    document.getElementById(`${baseId}-tab-${next}`)?.focus()
  }

  return (
    <div>
      <div
        ref={trackRef}
        // relative：中の絶対配置の要素（読み上げ用の sr-only など）が枠の外へ出て、画面の横幅を広げないようにする
        className="relative -mx-1 flex snap-x snap-mandatory items-start overflow-x-auto overflow-y-hidden overscroll-x-contain transition-[height] duration-300 [scrollbar-width:none] motion-reduce:transition-none [&::-webkit-scrollbar]:hidden"
        style={{ height }}
        aria-label={label}
      >
        {pages.map((page, index) => (
          <div
            key={page.id}
            ref={(el) => {
              pageRefs.current[index] = el
            }}
            id={`${baseId}-panel-${index}`}
            role="tabpanel"
            aria-labelledby={`${baseId}-tab-${index}`}
            // 表示していないページにはフォーカスが移らないようにする
            inert={index !== active}
            className="w-full shrink-0 snap-start snap-always px-1 pb-2"
          >
            {page.content}
          </div>
        ))}
      </div>

      <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-20 mt-3 lg:bottom-4">
        <div className="mx-auto flex max-w-sm items-center gap-1 rounded-full border-[3px] border-ink bg-white/95 p-1 shadow-[0_3px_0_0_var(--color-ink)]">
          <button
            type="button"
            className="h-11 w-11 shrink-0 rounded-full font-bold text-ink-soft disabled:opacity-30"
            aria-label="前のページ"
            disabled={active === 0}
            onClick={() => goTo(active - 1)}
          >
            ‹
          </button>
          <div role="tablist" aria-label={`${label}のページ`} className="flex min-w-0 flex-1 gap-1">
            {pages.map((page, index) => {
              const selected = index === active
              return (
                <button
                  key={page.id}
                  id={`${baseId}-tab-${index}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={`${baseId}-panel-${index}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => goTo(index)}
                  onKeyDown={onKeyDown}
                  className={`flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full px-2 text-xs font-bold whitespace-nowrap ${
                    selected ? 'bg-mikan-500 text-white' : 'text-ink-soft'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`h-2.5 w-2.5 shrink-0 rounded-full border-2 ${selected ? 'border-white bg-white' : 'border-ink-soft'}`}
                  />
                  <span className="truncate">{page.label}</span>
                </button>
              )
            })}
          </div>
          <button
            type="button"
            className="h-11 w-11 shrink-0 rounded-full font-bold text-ink-soft disabled:opacity-30"
            aria-label="次のページ"
            disabled={active === pages.length - 1}
            onClick={() => goTo(active + 1)}
          >
            ›
          </button>
        </div>
        <p className="sr-only" aria-live="polite">
          {pages[active]?.label}（{active + 1} / {pages.length}ページ）
        </p>
      </div>
    </div>
  )
}

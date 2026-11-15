import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { api } from '../../api'
import { isOnStepPage, TOUR_STEPS, type TourStep } from './tourSteps'
import { tourStore, useTour } from './tourStore'

interface Box {
  top: number
  left: number
  width: number
  height: number
}

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/** ルーター（basename）を通さずに、今の画面の場所を読む（タイマーの中から使うため） */
function currentLocation() {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '')
  let pathname = window.location.pathname
  if (base && pathname.startsWith(base)) pathname = pathname.slice(base.length) || '/'
  return { pathname, search: window.location.search }
}

/** 見えている要素だけを探す（ホームの見えていないページ・幅で隠れたメニューは除く） */
function findTarget(target: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`)) {
    if (el.getClientRects().length > 0 && !el.closest('[inert]')) return el
  }
  return null
}

/** 画面全体をおおう確認（歩数の計測の許可など）が出ている間は、ガイドを隠す */
function hasBlockingDialog() {
  for (const el of document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')) {
    if (getComputedStyle(el).position === 'fixed') return true
  }
  return false
}

function isFixed(el: HTMLElement) {
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    if (getComputedStyle(node).position === 'fixed') return true
  }
  return false
}

/** 光らせる場所が、上のヘッダーと下のガイドに隠れない位置までスクロールする */
function reveal(el: HTMLElement) {
  if (isFixed(el)) return
  const rect = el.getBoundingClientRect()
  // 上に「ここをタップ」の吹き出しが入るよう、ヘッダーの下を少し空ける
  if (rect.top >= 130 && rect.bottom <= window.innerHeight - 280) return
  window.scrollTo({ top: Math.max(0, window.scrollY + rect.top - 150), behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
}

const sameBox = (a: Box | null, b: Box | null) =>
  a === b || (!!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height)

/**
 * デモモードの操作ガイド。光らせた場所と「ここをタップ」で順番に案内する。
 * ガイドは画面の操作をじゃましない（光っている場所はそのままタップできる）
 */
export function TourGuide() {
  const tour = useTour()
  if (!tour.active || !api.demo) return null
  const index = Math.min(tour.step, TOUR_STEPS.length - 1)
  return <TourPanel key={index} index={index} step={TOUR_STEPS[index]} />
}

function TourPanel({ index, step }: { index: number; step: TourStep }) {
  const location = useLocation()
  const navigate = useNavigate()
  const panelRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<Box | null>(null)
  const [blocked, setBlocked] = useState(false)
  const [placeTop, setPlaceTop] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const [bubbleWidth, setBubbleWidth] = useState(200)
  const onPage = isOnStepPage(step, location)
  const last = index === TOUR_STEPS.length - 1

  const goTo = useCallback(
    (next: number) => {
      if (next >= TOUR_STEPS.length) {
        tourStore.stop()
        return
      }
      tourStore.goTo(next)
      const target = TOUR_STEPS[next]
      if (!isOnStepPage(target, currentLocation())) navigate(target.path)
    },
    [navigate],
  )

  // 光らせる場所を追いかける（画面の読み込み・スクロール・タブの切り替えに合わせる）
  useEffect(() => {
    let revealed = false
    let frame = 0
    const update = () => {
      const el = step.target ? findTarget(step.target) : null
      const rect = el?.getBoundingClientRect()
      const next = rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : null
      setBox((prev) => (sameBox(prev, next) ? prev : next))
      setBlocked(hasBlockingDialog())
      if (bubbleRef.current) setBubbleWidth(bubbleRef.current.offsetWidth)
      if (el && !revealed) {
        revealed = true
        reveal(el)
      }
      // 光らせた場所がガイドの下に隠れるときは、ガイドを画面の上に出す
      const panelHeight = panelRef.current?.offsetHeight ?? 220
      const bottomOffset = window.innerWidth >= 1024 ? 24 : 92
      const panelTop = window.innerHeight - bottomOffset - panelHeight
      setPlaceTop(!!rect && rect.bottom > panelTop && rect.top > 140)
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    }
    schedule()
    const timer = window.setInterval(schedule, 300)
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(frame)
      window.clearInterval(timer)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [step])

  // 光っている場所をタップしたら、少し待って（画面の切り替えや結果の表示のあと）次へ進む
  useEffect(() => {
    const target = step.target
    if (!target || !step.tap || step.advance === 'next') return
    let timer = 0
    const onClick = (event: MouseEvent) => {
      const el = findTarget(target)
      if (el && event.target instanceof Node && el.contains(event.target)) {
        window.clearTimeout(timer)
        timer = window.setTimeout(() => goTo(index + 1), 450)
      }
    }
    document.addEventListener('click', onClick, true)
    return () => {
      document.removeEventListener('click', onClick, true)
      window.clearTimeout(timer)
    }
  }, [step, index, goTo])

  if (blocked) return null

  const body = typeof step.body === 'function' ? step.body() : step.body
  const showRing = onPage && box !== null
  const bubbleAbove = box !== null && box.top > 64
  // 吹き出しが画面の端から切れないよう、幅に合わせて寄せる
  const half = bubbleWidth / 2 + 8
  const bubbleLeft = box ? Math.min(Math.max(box.left + box.width / 2, half), window.innerWidth - half) : 0
  const position = placeTop
    ? 'top-[4.25rem] lg:top-24'
    : 'bottom-[calc(5.75rem+env(safe-area-inset-bottom))] lg:bottom-6'

  return (
    <>
      {showRing && box && (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none fixed z-[1090] rounded-2xl border-[4px] border-mikan-500 shadow-[0_0_0_4px_white,0_0_18px_6px_rgba(243,152,0,0.55)] motion-safe:animate-pulse"
            style={{ top: box.top - 6, left: box.left - 6, width: box.width + 12, height: box.height + 12 }}
          />
          {step.tap && (
            <div
              ref={bubbleRef}
              aria-hidden="true"
              className="pointer-events-none fixed z-[1095] -translate-x-1/2 rounded-full border-[3px] border-white bg-ink px-3 py-1 text-sm font-bold whitespace-nowrap text-white shadow-lg motion-safe:animate-bounce"
              style={bubbleAbove ? { top: box.top - 46, left: bubbleLeft } : { top: box.top + box.height + 12, left: bubbleLeft }}
            >
              {bubbleAbove ? '👇 ' : '👆 '}
              {step.tap}
            </div>
          )}
        </>
      )}

      <div
        ref={panelRef}
        role="region"
        aria-label="操作ガイド"
        className={`fixed inset-x-2 z-[1100] mx-auto max-w-md lg:right-6 lg:left-auto lg:w-[26rem] ${position}`}
      >
        {minimized ? (
          <button
            type="button"
            onClick={() => setMinimized(false)}
            className="rpg-button ml-auto flex min-h-11 bg-mikan-500 px-4 text-base text-white [text-shadow:1px_1px_0_var(--color-ink)]"
          >
            操作ガイド {index + 1} / {TOUR_STEPS.length}（ひらく）
          </button>
        ) : (
          <div className="rounded-2xl border-[3px] border-ink bg-white p-4 shadow-[0_4px_0_0_var(--color-ink)]">
            <div className="flex items-center justify-between gap-2">
              <span className="rounded-full border-2 border-mikan-600 bg-mikan-100 px-2 py-0.5 text-xs font-bold text-mikan-800">
                操作ガイド {index + 1} / {TOUR_STEPS.length}
              </span>
              <div className="flex gap-1">
                <button type="button" onClick={() => setMinimized(true)} className="min-h-9 rounded-lg px-2 text-sm font-bold text-ink-soft">
                  小さくする
                </button>
                <button type="button" onClick={() => tourStore.stop()} className="min-h-9 rounded-lg px-2 text-sm font-bold text-ink-soft">
                  とじる
                </button>
              </div>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-cream" aria-hidden="true">
              <div className="h-full bg-mikan-500" style={{ width: `${((index + 1) / TOUR_STEPS.length) * 100}%` }} />
            </div>
            <h2 className="mt-2 font-pixel text-lg" aria-live="polite">
              {step.title}
            </h2>
            <p className="mt-1 text-sm leading-relaxed">{body}</p>
            {!onPage && (
              <button type="button" onClick={() => navigate(step.path)} className="mt-2 text-sm font-bold text-seto-700 underline">
                ガイドの画面へ戻る
              </button>
            )}
            {onPage && step.target && step.tap && box === null && (
              <p className="mt-1 text-xs text-ink-soft">光る場所が出てこないときは「次へ」で進めます。</p>
            )}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => goTo(index - 1)}
                disabled={index === 0}
                className="rpg-button min-h-11 bg-white text-base disabled:opacity-40"
              >
                戻る
              </button>
              <button
                type="button"
                onClick={() => goTo(index + 1)}
                className="rpg-button min-h-11 bg-mikan-500 text-base text-white [text-shadow:1px_1px_0_var(--color-ink)]"
              >
                {last ? 'ガイドをおわる' : '次へ'}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

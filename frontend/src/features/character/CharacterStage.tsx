import { Link } from 'react-router'
import type { StepSummary } from '../../domain/steps'
import type { Character } from '../../domain/types'
import { CharacterAvatar } from './CharacterAvatar'

function currentJstHour(): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', hour: 'numeric', hourCycle: 'h23' }).format(new Date()))
}

/** キャラクターのひとこと。過度な運動や夜間の外出を促さない */
function greeting(steps: StepSummary): string {
  const remaining = Math.max(0, steps.goal - steps.todaySteps)
  const hour = currentJstHour()
  if (steps.goalRate >= 1) return '目標達成！今日はもう十分。ゆっくり休んでね。'
  if (hour >= 21 || hour < 5) return '夜道は無理しないでね。続きはまた明日歩こう。'
  if (steps.goalRate >= 0.5) return `いい調子！あと${remaining.toLocaleString('ja-JP')}歩で目標だよ。`
  return '今日もいっしょに愛媛を歩こう！'
}

export function CharacterStage({ character, title, steps }: { character: Character; title: string; steps: StepSummary }) {
  return (
    <section className="rpg-card overflow-hidden" aria-label="あなたのキャラクター">
      <CharacterAvatar character={character} scale={11} animated className="h-64 pb-3" />
      <div className="border-t-[3px] border-ink bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="font-pixel text-2xl">{character.name}</p>
          <span className="rounded-lg border-2 border-ink bg-mikan-100 px-2 py-0.5 text-sm font-bold">{title}</span>
        </div>
        <p className="mt-2 rounded-xl border-2 border-ink bg-cream px-3 py-2">
          <span className="sr-only">{character.name}のひとこと：</span>
          {greeting(steps)}
        </p>
        <Link to="/gacha?tab=wardrobe" className="mt-3 block text-right text-sm font-bold text-seto-700 underline">
          着せ替える
        </Link>
      </div>
    </section>
  )
}

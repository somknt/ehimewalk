import { Link } from 'react-router'
import { Card } from '../components/ui'

export function NotFoundPage() {
  return (
    <Card className="text-center">
      <h1 className="font-pixel text-2xl">道に迷ったようです</h1>
      <p className="mt-2">お探しのページは見つかりませんでした。</p>
      <Link to="/" className="rpg-button mt-4 bg-mikan-500 text-white">
        ホームへ戻る
      </Link>
    </Card>
  )
}

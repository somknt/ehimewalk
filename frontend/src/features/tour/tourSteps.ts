import { api } from '../../api'
import { SPOTS } from '../../data/spots'

export interface TourStep {
  id: string
  /** 説明する画面。「次へ」「戻る」で、ちがう画面にいればここへ移動する */
  path: string
  /** 今いる画面が説明の画面か（省略時：path と同じ画面。path に ?tab= があればタブも比べる） */
  match?: (location: { pathname: string; search: string }) => boolean
  title: string
  body: string | (() => string)
  /** 光らせる場所（data-tour の値） */
  target?: string
  /** タップの案内。光っている場所をタップすると、自動で次へ進む（advance: 'next' なら進まない） */
  tap?: string
  advance?: 'tap' | 'next'
}

const firstSpot = SPOTS[0]

/** デモモードで始めた人に、アプリをひととおり体験してもらう順番 */
export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'welcome',
    path: '/',
    title: 'EhimeWalk へようこそ！',
    body:
      '歩くとコインがたまり、ガチャ・着せ替え・愛媛の観光スポットめぐりが楽しめるアプリです。デモモードでは、歩かなくても歩数を足したり、現地に行かなくてもチェックインを試したりできます。光っている場所を順番にタップしてみましょう。',
  },
  {
    id: 'today-steps',
    path: '/',
    target: 'today-steps',
    title: '今日の歩数',
    body: 'スマホのセンサーで歩数を数えます（アプリを開いている間、自動で計測）。100歩で1コインもらえます。',
  },
  {
    id: 'demo-steps',
    path: '/',
    target: 'demo-steps-5000',
    tap: '「+5,000歩」をタップ',
    title: '歩いたことにしてみよう',
    body: 'デモ操作で、今日の歩数を足せます。5,000歩で50コイン。足した歩数は「デモ」として記録し、正式なランキングには入りません。',
  },
  {
    id: 'login-bonus',
    path: '/',
    target: 'login-bonus',
    tap: 'タップして受け取る',
    title: 'ログインボーナス',
    body: '1日1回、10コインもらえます。受け取り済みのときは「次へ」で進んでください。',
  },
  {
    id: 'home-health',
    path: '/',
    target: 'pager-health',
    tap: '「クエスト・健康」をタップ',
    title: 'ホームの2ページ目',
    body: 'ホームは左右にスワイプできます。2ページ目には、AIおすすめクエストと健康ダッシュボードがあります。',
  },
  {
    id: 'health',
    path: '/',
    target: 'mission',
    title: '無理のない目標',
    body: '過去7日の歩数から、少しだけ高い目標を提案します。週・月の歩数、距離や消費カロリーの目安も見られます。',
  },
  {
    id: 'nav-gacha',
    path: '/',
    target: 'nav-/gacha',
    tap: '「ガチャ」をタップ',
    title: 'ガチャへ行こう',
    body: 'たまったコインで、愛媛らしいドット絵の衣装やペットが手に入ります。',
  },
  {
    id: 'gacha-draw',
    path: '/gacha',
    target: 'gacha-draw',
    tap: '「1回引く」をタップ',
    title: 'ガチャを引く',
    body: '1回50コインで、課金はありません。抽選はサーバーで行い、排出確率も画面に出しています。コインが足りないときは、ホームのデモ操作で足せます。',
  },
  {
    id: 'gacha-wear',
    path: '/gacha',
    target: 'gacha-wear',
    tap: '「すぐに装備する」をタップ',
    title: '手に入れた衣装を着る',
    body: 'カプセルが開いたら、「すぐに装備する」でキャラクターがその衣装に着替えます。',
  },
  {
    id: 'wardrobe-tab',
    path: '/gacha',
    target: 'gacha-tab-wardrobe',
    tap: '「着せ替え」をタップ',
    title: '着せ替え',
    body: '頭・髪・上・下・靴・アクセサリー・背景・ペットの8か所を、自由に着せ替えられます。',
  },
  {
    id: 'wardrobe',
    path: '/gacha/wardrobe',
    target: 'wardrobe-items',
    title: '持ち物から選ぶ',
    body: '「装備する場所」を選んで、持ち物をタップすると着替えます。変更はすぐに保存されます。',
  },
  {
    id: 'nav-adventure',
    path: '/gacha/wardrobe',
    target: 'nav-/adventure',
    tap: '「冒険」をタップ',
    title: '冒険に出かけよう',
    body: '地図を見ながら、愛媛の観光スポットを歩いてめぐります。',
  },
  {
    id: 'map',
    path: '/adventure?tab=spots',
    target: 'adventure-map',
    title: '冒険マップ',
    body: '観光スポットは、お城や温泉のドット絵で表示されます。現在地を許可すると、自分のキャラクターが地図の上を歩きます（位置情報は保存しません）。',
  },
  {
    id: 'spot',
    path: '/adventure?tab=spots',
    target: 'spot-detail',
    tap: '「くわしく・チェックイン」をタップ',
    title: 'スポットを選ぶ',
    body: '地図の下の一覧から、スポットのくわしい説明とチェックインの画面を開きます。',
  },
  {
    id: 'checkin',
    path: `/adventure/spots/${firstSpot.spotId}`,
    match: ({ pathname }) => pathname.startsWith('/adventure/spots/'),
    target: 'demo-checkin',
    tap: 'デモ用のチェックインをタップ',
    advance: 'next',
    title: 'チェックイン',
    body: '本来は現地（スポットから約100〜150m以内）でチェックインします。デモでは「現地にいるもの」としてチェックインでき、そのスポットだけの限定アイテムがもらえます。結果を見たら「次へ」。',
  },
  {
    id: 'ai',
    path: '/adventure?tab=ai',
    target: 'ai-submit',
    tap: '条件を選んで、ここをタップ',
    advance: 'next',
    title: 'AIが散策コースを提案',
    body: '出発地点・時間・ジャンルを選ぶと、Amazon Bedrock の AI が、登録スポットの中から巡る順番と紹介文を作ります（数秒〜20秒・1日5回まで）。提案を見たら「次へ」。',
  },
  {
    id: 'quests',
    path: '/adventure',
    match: ({ pathname }) => pathname === '/adventure',
    target: 'adventure-tab-quests',
    tap: '「クエスト」をタップ',
    advance: 'next',
    title: 'みんなのクエスト',
    body: '利用者全員が同じクエストに挑戦します。「みんなで愛媛50万歩」のように、全員の歩数を合わせる目標もあります。達成したら報酬を受け取れます。',
  },
  {
    id: 'zukan',
    path: '/adventure',
    match: ({ pathname }) => pathname === '/adventure',
    target: 'adventure-tab-zukan',
    tap: '「図鑑」をタップ',
    advance: 'next',
    title: '愛媛冒険図鑑',
    body: '訪れたスポットが、市町ごとに図鑑に載ります。まだのスポットはシルエットとヒントだけが見えます。',
  },
  {
    id: 'nav-friends',
    path: '/adventure',
    match: ({ pathname }) => pathname === '/adventure',
    target: 'nav-/friends',
    tap: '「フレンド」をタップ',
    title: 'フレンド',
    body: 'フレンドIDで友だちとつながり、応援し合えます。本名やメールアドレスは要りません。',
  },
  {
    id: 'friend-add',
    path: '/friends',
    target: 'friend-add',
    title: 'フレンドを追加',
    body: () =>
      api.mode === 'supabase'
        ? '友だちのフレンドIDを入れて「探す」。試しに ABCD-2345 を入れると、発表用のデモ用アカウントとすぐにフレンドになれます。'
        : '友だちのフレンドIDを入れて「探す」。この版では、下の「試しに使えるフレンドID」で試せます。',
  },
  {
    id: 'nav-ranking',
    path: '/friends',
    target: 'nav-/ranking',
    tap: '「ランキング」をタップ',
    title: 'ランキング',
    body: '週間歩数で、ほかの利用者やフレンドと競います。',
  },
  {
    id: 'ranking',
    path: '/ranking',
    target: 'ranking-tab',
    title: '3つのランキング',
    body: '全ユーザー・愛媛県・フレンドの3種類で、毎週月曜に新しい週が始まります。デモで足した歩数とデモモードのアカウントは、正式な順位に入りません。',
  },
  {
    id: 'nav-mypage',
    path: '/ranking',
    target: 'nav-/mypage',
    tap: '「マイページ」をタップ',
    title: 'マイページ',
    body: '名前・見た目・1日の目標・称号などを変えられます。',
  },
  {
    id: 'mypage',
    path: '/mypage',
    target: 'tour-replay',
    title: 'ガイドはいつでも見られます',
    body: 'このガイドは、マイページの「操作ガイドを最初から見る」から、もう一度見られます。「発表用デモ」では、途中まで遊んだ状態のデータでも試せます。',
  },
  {
    id: 'finish',
    path: '/',
    title: 'おつかれさまでした！',
    body: 'これで EhimeWalk をひととおり体験しました。歩く → コインがたまる → ガチャ・着せ替え → 観光スポットへ → 図鑑・ランキング、の流れで、健康と愛媛の観光を一緒に楽しめます。',
  },
]

/** 今いる画面が、そのステップの画面か */
export function isOnStepPage(step: TourStep, location: { pathname: string; search: string }): boolean {
  if (step.match) return step.match(location)
  const url = new URL(step.path, 'https://example.invalid')
  if (url.pathname !== location.pathname) return false
  const current = new URLSearchParams(location.search)
  for (const [key, value] of url.searchParams) {
    // タブを指定していない URL は、最初のタブ（spots）を開いている
    const actual = current.get(key) ?? (key === 'tab' ? 'spots' : null)
    if (actual !== value) return false
  }
  return true
}

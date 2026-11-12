import { Route, Routes } from 'react-router'
import { AppLayout } from './components/AppLayout'
import { AdventurePage } from './pages/AdventurePage'
import { GachaPage } from './pages/GachaPage'
import { HomePage } from './pages/HomePage'
import { MyPage } from './pages/MyPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { RankingPage } from './pages/RankingPage'
import { SpotDetailPage } from './pages/SpotDetailPage'
import { WardrobePage } from './pages/WardrobePage'
import { WelcomePage } from './pages/WelcomePage'
import { SessionProvider } from './session/SessionProvider'

export default function App() {
  return (
    <SessionProvider>
      <Routes>
        {/* 初回のキャラクター作成（共通レイアウトの外に置く） */}
        <Route path="welcome" element={<WelcomePage />} />
        <Route element={<AppLayout />}>
          <Route index element={<HomePage />} />
          <Route path="adventure" element={<AdventurePage />} />
          <Route path="adventure/spots/:spotId" element={<SpotDetailPage />} />
          <Route path="gacha" element={<GachaPage />} />
          <Route path="gacha/wardrobe" element={<WardrobePage />} />
          <Route path="ranking" element={<RankingPage />} />
          <Route path="mypage" element={<MyPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </SessionProvider>
  )
}

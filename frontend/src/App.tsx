import { Route, Routes } from 'react-router'
import { AppLayout } from './components/AppLayout'
import { AdventurePage } from './pages/AdventurePage'
import { GachaPage } from './pages/GachaPage'
import { HomePage } from './pages/HomePage'
import { MyPage } from './pages/MyPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { RankingPage } from './pages/RankingPage'

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<HomePage />} />
        <Route path="adventure" element={<AdventurePage />} />
        <Route path="gacha" element={<GachaPage />} />
        <Route path="ranking" element={<RankingPage />} />
        <Route path="mypage" element={<MyPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}

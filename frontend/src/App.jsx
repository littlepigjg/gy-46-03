import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import UrlList from './pages/UrlList.jsx'
import ScreenshotTimeline from './pages/ScreenshotTimeline.jsx'

export default function App() {
  return (
    <Router>
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white shadow-sm border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
            <h1 className="text-2xl font-bold text-gray-900">
              网页截图归档工具
            </h1>
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
          <Routes>
            <Route path="/" element={<UrlList />} />
            <Route path="/url/:id" element={<ScreenshotTimeline />} />
          </Routes>
        </main>
      </div>
    </Router>
  )
}

import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom'
import UrlList from './pages/UrlList.jsx'
import ScreenshotTimeline from './pages/ScreenshotTimeline.jsx'
import AlertList from './pages/AlertList.jsx'

function NavBar() {
  const location = useLocation()

  const isActive = (path) => {
    if (path === '/' && location.pathname === '/') return true
    if (path !== '/' && location.pathname.startsWith(path)) return true
    return false
  }

  return (
    <nav className="bg-white shadow-sm border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center h-16">
          <h1 className="text-xl font-bold text-gray-900 mr-8">网页截图归档工具</h1>
          <div className="flex gap-1">
            <Link
              to="/"
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive('/') && !isActive('/alerts')
                  ? 'bg-blue-100 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`}
            >
              URL监控
            </Link>
            <Link
              to="/alerts"
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive('/alerts')
                  ? 'bg-blue-100 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`}
            >
              告警中心
            </Link>
          </div>
        </div>
      </div>
    </nav>
  )
}

export default function App() {
  return (
    <Router>
      <div className="min-h-screen bg-gray-50">
        <NavBar />
        <main className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
          <Routes>
            <Route path="/" element={<UrlList />} />
            <Route path="/url/:id" element={<ScreenshotTimeline />} />
            <Route path="/alerts" element={<AlertList />} />
          </Routes>
        </main>
      </div>
    </Router>
  )
}

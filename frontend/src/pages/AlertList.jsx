import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import {
  getAlerts,
  getAlertStats,
  markFalsePositive,
  getUrls
} from '../api.js'

function getScreenshotUrl(filePath) {
  if (!filePath) return ''
  const idx = filePath.indexOf('screenshots')
  if (idx === -1) return ''
  return '/' + filePath.slice(idx).replace(/\\/g, '/')
}

const CHANGE_TYPE_COLORS = {
  layout: { bg: 'bg-orange-100', text: 'text-orange-800', label: '布局' },
  content: { bg: 'bg-blue-100', text: 'text-blue-800', label: '内容' },
  style: { bg: 'bg-purple-100', text: 'text-purple-800', label: '样式' },
  minor: { bg: 'bg-gray-100', text: 'text-gray-700', label: '轻微' }
}

function ScoreBar({ label, value, max = 1, color = 'bg-blue-500' }) {
  const percent = Math.min(100, (value / max) * 100)
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-gray-500">{label}</span>
        <span className="font-medium text-gray-700">{Math.round(value * 100)}%</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full ${color} rounded-full transition-all`}
          style={{ width: `${percent}%` }}
        ></div>
      </div>
    </div>
  )
}

function AlertCard({ alert, onMarkFalsePositive }) {
  const [showCompare, setShowCompare] = useState(false)

  const beforeImg = getScreenshotUrl(alert.before_file_path)
  const afterImg = getScreenshotUrl(alert.after_file_path)

  return (
    <div className={`bg-white rounded-xl shadow-sm border overflow-hidden transition-all ${
      alert.is_false_positive ? 'border-gray-200 opacity-60' : 'border-gray-200 hover:shadow-md'
    }`}>
      <div className="p-4 border-b border-gray-100">
        <div className="flex justify-between items-start">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="font-medium text-gray-900">{alert.url_name}</h3>
              {alert.is_false_positive && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                  已标记误报
                </span>
              )}
              {alert.notified && alert.notification_channels && alert.notification_channels.length > 0 && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                  已通知
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500 truncate">{alert.url}</p>
            <p className="text-xs text-gray-400 mt-1">
              {dayjs(alert.created_at).format('YYYY-MM-DD HH:mm:ss')}
            </p>
          </div>
          <div className="flex gap-2 ml-4">
            {!alert.is_false_positive && (
              <button
                onClick={() => onMarkFalsePositive(alert.id, true)}
                className="text-xs bg-yellow-50 text-yellow-700 px-3 py-1.5 rounded-lg hover:bg-yellow-100"
              >
                标记误报
              </button>
            )}
            {alert.is_false_positive && (
              <button
                onClick={() => onMarkFalsePositive(alert.id, false)}
                className="text-xs bg-gray-50 text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-100"
              >
                取消误报
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 mt-3">
          {alert.change_types.map((t, i) => {
            const color = CHANGE_TYPE_COLORS[t.type] || CHANGE_TYPE_COLORS.minor
            return (
              <span
                key={i}
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${color.bg} ${color.text}`}
              >
                {color.label} {Math.round(t.severity * 100)}%
              </span>
            )
          })}
        </div>
      </div>

      <div className="p-4 space-y-3">
        <ScoreBar label="总体差异" value={alert.overall_score} color="bg-red-500" />
        <div className="grid grid-cols-3 gap-3">
          <ScoreBar label="布局" value={alert.layout_score} color="bg-orange-500" />
          <ScoreBar label="内容" value={alert.content_score} color="bg-blue-500" />
          <ScoreBar label="样式" value={alert.style_score} color="bg-purple-500" />
        </div>
      </div>

      {beforeImg && afterImg && (
        <div className="border-t border-gray-100">
          <button
            onClick={() => setShowCompare(!showCompare)}
            className="w-full px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 flex items-center justify-center gap-1"
          >
            {showCompare ? '收起对比图' : '查看对比截图'}
            <span className={`transform transition-transform ${showCompare ? 'rotate-180' : ''}`}>▼</span>
          </button>
          {showCompare && (
            <div className="p-4 border-t border-gray-100 grid grid-cols-2 gap-4 bg-gray-50">
              <div>
                <div className="text-xs text-gray-500 mb-1 text-center">之前</div>
                <img
                  src={beforeImg}
                  alt="before"
                  className="w-full rounded-lg border border-gray-200 object-cover"
                  style={{ aspectRatio: '16/9' }}
                />
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1 text-center">之后</div>
                <img
                  src={afterImg}
                  alt="after"
                  className="w-full rounded-lg border border-gray-200 object-cover"
                  style={{ aspectRatio: '16/9' }}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function AlertList() {
  const navigate = useNavigate()
  const [alerts, setAlerts] = useState([])
  const [stats, setStats] = useState(null)
  const [urls, setUrls] = useState([])
  const [filterUrlId, setFilterUrlId] = useState('')
  const [includeFalsePositive, setIncludeFalsePositive] = useState(true)
  const [loading, setLoading] = useState(false)

  const loadData = async () => {
    setLoading(true)
    try {
      const [alertsRes, statsRes, urlsRes] = await Promise.all([
        getAlerts({
          url_id: filterUrlId || undefined,
          include_false_positive: includeFalsePositive,
          limit: 100
        }),
        getAlertStats(filterUrlId ? { url_id: filterUrlId } : {}),
        getUrls()
      ])
      setAlerts(alertsRes.data)
      setStats(statsRes.data)
      setUrls(urlsRes.data)
    } catch (err) {
      alert('加载失败: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [filterUrlId, includeFalsePositive])

  const handleMarkFalsePositive = async (alertId, isFalsePositive) => {
    try {
      await markFalsePositive(alertId, isFalsePositive)
      loadData()
    } catch (err) {
      alert('操作失败: ' + err.message)
    }
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-xl font-semibold text-gray-800">告警中心</h2>
          <p className="text-sm text-gray-500 mt-1">查看所有页面变化告警记录</p>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="text-sm text-gray-500">总告警数</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">{stats.total || 0}</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="text-sm text-gray-500">已通知</div>
            <div className="text-2xl font-bold text-green-600 mt-1">{stats.notified_count || 0}</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="text-sm text-gray-500">误报标记</div>
            <div className="text-2xl font-bold text-yellow-600 mt-1">{stats.false_positives || 0}</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="text-sm text-gray-500">平均差异度</div>
            <div className="text-2xl font-bold text-blue-600 mt-1">
              {stats.avg_overall_score ? Math.round(stats.avg_overall_score * 100) : 0}%
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
        <div className="flex flex-wrap gap-4 items-center">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">筛选URL</label>
            <select
              value={filterUrlId}
              onChange={(e) => setFilterUrlId(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">全部URL</option>
              {urls.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={includeFalsePositive}
                onChange={(e) => setIncludeFalsePositive(e.target.checked)}
                className="rounded border-gray-300"
              />
              包含已标记误报
            </label>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">加载中...</div>
      ) : alerts.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center text-gray-500">
          暂无告警记录
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {alerts.map(alert => (
            <AlertCard
              key={alert.id}
              alert={alert}
              onMarkFalsePositive={handleMarkFalsePositive}
            />
          ))}
        </div>
      )}
    </div>
  )
}

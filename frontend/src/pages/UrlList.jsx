import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { getUrls, addUrl, deleteUrl, triggerScreenshot } from '../api.js'

const FREQUENCY_LABELS = {
  hourly: '每小时',
  daily: '每天',
  weekly: '每周',
  monthly: '每月'
}

export default function UrlList() {
  const [urls, setUrls] = useState([])
  const [showAddForm, setShowAddForm] = useState(false)
  const [formData, setFormData] = useState({ url: '', name: '', frequency: 'daily' })
  const [loading, setLoading] = useState(false)
  const [screenshottingId, setScreenshottingId] = useState(null)
  const navigate = useNavigate()

  const loadUrls = async () => {
    try {
      const res = await getUrls()
      setUrls(res.data)
    } catch (err) {
      alert('加载失败: ' + err.message)
    }
  }

  useEffect(() => {
    loadUrls()
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!formData.url || !formData.name) {
      alert('请填写完整信息')
      return
    }
    setLoading(true)
    try {
      await addUrl(formData)
      setShowAddForm(false)
      setFormData({ url: '', name: '', frequency: 'daily' })
      loadUrls()
    } catch (err) {
      alert('添加失败: ' + (err.response?.data?.error || err.message))
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id, name) => {
    if (!confirm(`确定删除 "${name}" 及其所有截图吗？`)) return
    try {
      await deleteUrl(id)
      loadUrls()
    } catch (err) {
      alert('删除失败: ' + err.message)
    }
  }

  const handleScreenshot = async (id) => {
    setScreenshottingId(id)
    try {
      await triggerScreenshot(id)
      loadUrls()
      alert('截图完成')
    } catch (err) {
      alert('截图失败: ' + (err.response?.data?.error || err.message))
    } finally {
      setScreenshottingId(null)
    }
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold text-gray-800">监控URL列表</h2>
        <button
          onClick={() => setShowAddForm(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
        >
          + 添加URL
        </button>
      </div>

      {showAddForm && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          <h3 className="text-lg font-medium text-gray-800 mb-4">添加新URL</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">名称</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="例如: 百度首页"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">URL</label>
              <input
                type="url"
                value={formData.url}
                onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                placeholder="https://example.com"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">截图频率</label>
              <select
                value={formData.frequency}
                onChange={(e) => setFormData({ ...formData, frequency: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="hourly">每小时</option>
                <option value="daily">每天</option>
                <option value="weekly">每周</option>
                <option value="monthly">每月</option>
              </select>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={loading}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? '添加中...' : '添加'}
              </button>
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200"
              >
                取消
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="grid gap-4">
        {urls.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center text-gray-500">
            暂无监控URL，点击右上角添加
          </div>
        ) : (
          urls.map((item) => (
            <div
              key={item.id}
              className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:shadow-md transition-shadow"
            >
              <div className="flex justify-between items-start">
                <div className="flex-1 cursor-pointer" onClick={() => navigate(`/url/${item.id}`)}>
                  <h3 className="text-lg font-medium text-gray-900 hover:text-blue-600">
                    {item.name}
                  </h3>
                  <p className="text-sm text-gray-500 mt-1 truncate">{item.url}</p>
                  <div className="flex items-center gap-4 mt-3 text-sm">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                      {FREQUENCY_LABELS[item.frequency]}
                    </span>
                    <span className="text-gray-500">
                      截图数: <span className="font-medium text-gray-700">{item.screenshot_count}</span>
                    </span>
                    {item.last_screenshot_at && (
                      <span className="text-gray-500">
                        上次截图: {dayjs(item.last_screenshot_at).format('YYYY-MM-DD HH:mm')}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 ml-4">
                  <button
                    onClick={() => handleScreenshot(item.id)}
                    disabled={screenshottingId === item.id}
                    className="bg-green-50 text-green-700 px-3 py-1.5 rounded-lg text-sm hover:bg-green-100 disabled:opacity-50"
                  >
                    {screenshottingId === item.id ? '截图中...' : '立即截图'}
                  </button>
                  <button
                    onClick={() => handleDelete(item.id, item.name)}
                    className="bg-red-50 text-red-700 px-3 py-1.5 rounded-lg text-sm hover:bg-red-100"
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

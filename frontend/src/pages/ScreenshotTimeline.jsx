import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { getUrl, getScreenshots, deleteScreenshot, getDiffHistory } from '../api.js'
import ImageCompare from '../components/ImageCompare.jsx'
import AlertRulePanel from '../components/AlertRulePanel.jsx'

function getScreenshotUrl(filePath) {
  const idx = filePath.indexOf('screenshots')
  if (idx === -1) return ''
  return '/' + filePath.slice(idx).replace(/\\/g, '/')
}

export default function ScreenshotTimeline() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [urlInfo, setUrlInfo] = useState(null)
  const [screenshots, setScreenshots] = useState([])
  const [compareMode, setCompareMode] = useState(false)
  const [compareSelection, setCompareSelection] = useState([])
  const [showCompare, setShowCompare] = useState(false)
  const [previewImage, setPreviewImage] = useState(null)
  const [showAlertSettings, setShowAlertSettings] = useState(false)
  const [diffHistory, setDiffHistory] = useState([])
  const [activeTab, setActiveTab] = useState('screenshots')

  const firstCompareId = compareSelection[0] || null
  const secondCompareId = compareSelection[1] || null

  const loadData = async () => {
    try {
      const [urlRes, shotsRes, diffRes] = await Promise.all([
        getUrl(id),
        getScreenshots(id),
        getDiffHistory(id, 20)
      ])
      setUrlInfo(urlRes.data)
      setScreenshots(shotsRes.data)
      setDiffHistory(diffRes.data)
    } catch (err) {
      alert('加载失败: ' + err.message)
    }
  }

  useEffect(() => {
    setCompareSelection([])
    setShowCompare(false)
    setCompareMode(false)
    setPreviewImage(null)
    setShowAlertSettings(false)
    loadData()
  }, [id])

  const handleDelete = async (shot) => {
    if (!confirm(`确定删除此截图 (${dayjs(shot.created_at).format('YYYY-MM-DD HH:mm')})？`)) return
    try {
      await deleteScreenshot(shot.id)
      setCompareSelection(prev => prev.filter(id => id !== shot.id))
      loadData()
    } catch (err) {
      alert('删除失败: ' + err.message)
    }
  }

  const handleSelectCompare = (shotId) => {
    setCompareSelection(prev => {
      const idx = prev.indexOf(shotId)
      if (idx !== -1) {
        return prev.filter(id => id !== shotId)
      }
      if (prev.length === 0) {
        return [shotId]
      }
      if (prev.length === 1) {
        return [prev[0], shotId]
      }
      return [prev[1], shotId]
    })
  }

  const resetCompareSelection = () => {
    setCompareSelection([])
    setShowCompare(false)
    setCompareMode(false)
  }

  const startCompare = () => {
    if (compareSelection.length < 2) {
      alert('请选择两张截图进行对比')
      return
    }
    setShowCompare(true)
  }

  const groupedByDate = screenshots.reduce((acc, shot) => {
    const date = dayjs(shot.created_at).format('YYYY-MM-DD')
    if (!acc[date]) acc[date] = []
    acc[date].push(shot)
    return acc
  }, {})

  const firstShot = firstCompareId ? screenshots.find(s => s.id === firstCompareId) : null
  const secondShot = secondCompareId ? screenshots.find(s => s.id === secondCompareId) : null

  const orderedShots = firstShot && secondShot
    ? dayjs(firstShot.created_at).isBefore(secondShot.created_at)
      ? [firstShot, secondShot]
      : [secondShot, firstShot]
    : null

  if (showAlertSettings) {
    return (
      <div>
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={() => setShowAlertSettings(false)}
            className="text-gray-600 hover:text-gray-900 flex items-center gap-1"
          >
            ← 返回
          </button>
        </div>
        <div className="max-w-2xl">
          <AlertRulePanel
            urlId={parseInt(id)}
            urlName={urlInfo?.name || ''}
            onClose={() => setShowAlertSettings(false)}
          />
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => navigate('/')}
          className="text-gray-600 hover:text-gray-900 flex items-center gap-1"
        >
          ← 返回列表
        </button>
        <div className="h-6 w-px bg-gray-300"></div>
        <div className="flex-1">
          <h2 className="text-xl font-semibold text-gray-800">
            {urlInfo?.name || '加载中...'}
          </h2>
          <p className="text-sm text-gray-500 mt-0.5 truncate">{urlInfo?.url}</p>
        </div>
        <button
          onClick={() => setShowAlertSettings(true)}
          className="bg-purple-50 text-purple-700 px-4 py-2 rounded-lg text-sm hover:bg-purple-100"
        >
          告警设置
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6 overflow-hidden">
        <div className="flex border-b border-gray-100">
          <button
            onClick={() => setActiveTab('screenshots')}
            className={`px-6 py-3 text-sm font-medium transition-colors ${
              activeTab === 'screenshots'
                ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            截图时间线
          </button>
          <button
            onClick={() => setActiveTab('diff')}
            className={`px-6 py-3 text-sm font-medium transition-colors ${
              activeTab === 'diff'
                ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            差异历史
          </button>
        </div>

        {activeTab === 'screenshots' && (
          <div className="p-4">
            <div className="flex justify-between items-center">
              <div className="text-sm text-gray-600">
                共 <span className="font-medium text-gray-900">{screenshots.length}</span> 张截图
              </div>
              {compareMode ? (
                <div className="flex gap-2">
                  <span className="text-sm text-gray-500 py-1.5">
                    已选: {compareSelection.length} / 2
                    {compareSelection.length === 2 && ' (再点将替换较早的那张)'}
                  </span>
                  <button
                    onClick={startCompare}
                    disabled={compareSelection.length < 2}
                    className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
                  >
                    开始对比
                  </button>
                  <button
                    onClick={resetCompareSelection}
                    className="bg-gray-100 text-gray-700 px-4 py-1.5 rounded-lg text-sm hover:bg-gray-200"
                  >
                    取消
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    if (screenshots.length < 2) {
                      alert('至少需要两张截图才能对比')
                      return
                    }
                    setCompareSelection([])
                    setShowCompare(false)
                    setCompareMode(true)
                  }}
                  className="bg-blue-50 text-blue-700 px-4 py-1.5 rounded-lg text-sm hover:bg-blue-100"
                >
                  对比模式
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {activeTab === 'screenshots' && (
        screenshots.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center text-gray-500">
            暂无截图，等待首次执行或返回列表点击"立即截图"
          </div>
        ) : (
          <div className="space-y-8">
            {Object.entries(groupedByDate).map(([date, shots]) => (
              <div key={date}>
                <div className="flex items-center gap-3 mb-4">
                  <div className="text-lg font-semibold text-gray-800">{date}</div>
                  <div className="flex-1 h-px bg-gray-200"></div>
                  <div className="text-sm text-gray-500">{shots.length} 张</div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {shots.map((shot) => {
                    const isFirst = firstCompareId === shot.id
                    const isSecond = secondCompareId === shot.id
                    const imgUrl = getScreenshotUrl(shot.file_path)

                    return (
                      <div
                        key={shot.id}
                        className={`bg-white rounded-xl shadow-sm border-2 overflow-hidden transition-all ${
                          isFirst || isSecond
                            ? 'border-blue-500 ring-2 ring-blue-200'
                            : 'border-gray-200 hover:shadow-md'
                        } ${compareMode ? 'cursor-pointer' : ''}`}
                        onClick={() => compareMode && handleSelectCompare(shot.id)}
                      >
                        <div
                          className="relative bg-gray-100 overflow-hidden"
                          style={{ aspectRatio: '16/9' }}
                          onClick={(e) => {
                            if (!compareMode) {
                              e.stopPropagation()
                              setPreviewImage({ src: imgUrl, time: shot.created_at })
                            }
                          }}
                        >
                          <img
                            src={imgUrl}
                            alt={`screenshot-${shot.id}`}
                            className="w-full h-full object-cover object-top"
                            loading="lazy"
                          />
                          {(isFirst || isSecond) && (
                            <div className="absolute top-2 left-2 bg-blue-600 text-white text-xs font-medium px-2 py-0.5 rounded">
                              {isFirst ? '已选 1' : '已选 2'}
                            </div>
                          )}
                        </div>
                        <div className="p-3">
                          <div className="text-sm text-gray-700 font-medium">
                            {dayjs(shot.created_at).format('HH:mm:ss')}
                          </div>
                          {!compareMode && (
                            <div className="mt-2 flex gap-2">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setPreviewImage({ src: imgUrl, time: shot.created_at })
                                }}
                                className="flex-1 text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded hover:bg-gray-200"
                              >
                                查看大图
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleDelete(shot)
                                }}
                                className="text-xs bg-red-50 text-red-700 px-2 py-1 rounded hover:bg-red-100"
                              >
                                删除
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {activeTab === 'diff' && (
        diffHistory.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center text-gray-500">
            暂无差异对比记录
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">对比时间</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">总体差异</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">布局</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">内容</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">样式</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {diffHistory.map((item, idx) => (
                    <tr key={item.id || idx} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {dayjs(item.created_at).format('YYYY-MM-DD HH:mm:ss')}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-red-500 rounded-full"
                              style={{ width: `${Math.min(100, item.overall_score * 100 * 3)}%` }}
                            ></div>
                          </div>
                          <span className="text-sm font-medium text-gray-700">
                            {Math.round(item.overall_score * 100)}%
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{Math.round(item.layout_score * 100)}%</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{Math.round(item.content_score * 100)}%</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{Math.round(item.style_score * 100)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {previewImage && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex flex-col"
          onClick={() => setPreviewImage(null)}
        >
          <div className="bg-gray-900 px-6 py-4 flex justify-between items-center">
            <h3 className="text-white">
              {dayjs(previewImage.time).format('YYYY-MM-DD HH:mm:ss')}
            </h3>
            <button className="text-white hover:text-gray-300 text-2xl leading-none">×</button>
          </div>
          <div className="flex-1 overflow-auto flex items-center justify-center p-6">
            <img
              src={previewImage.src}
              alt="preview"
              className="max-w-full max-h-full object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}

      {showCompare && orderedShots && (
        <ImageCompare
          beforeImage={getScreenshotUrl(orderedShots[0].file_path)}
          afterImage={getScreenshotUrl(orderedShots[1].file_path)}
          beforeLabel={dayjs(orderedShots[0].created_at).format('YYYY-MM-DD HH:mm:ss')}
          afterLabel={dayjs(orderedShots[1].created_at).format('YYYY-MM-DD HH:mm:ss')}
          onClose={resetCompareSelection}
        />
      )}
    </div>
  )
}

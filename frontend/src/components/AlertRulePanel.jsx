import { useState, useEffect } from 'react'
import {
  getAlertRule,
  updateAlertRule,
  getThresholdStats,
  resetLearning,
  triggerLearning
} from '../api.js'

function ThresholdSlider({ label, value, onChange, min = 0.01, max = 0.5, step = 0.01, description }) {
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <label className="text-sm font-medium text-gray-700">{label}</label>
        <span className="text-sm font-semibold text-blue-600">{Math.round(value * 100)}%</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
      />
      {description && (
        <p className="text-xs text-gray-500 mt-1">{description}</p>
      )}
    </div>
  )
}

export default function AlertRulePanel({ urlId, urlName, onClose }) {
  const [rule, setRule] = useState(null)
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const loadData = async () => {
    setLoading(true)
    try {
      const [ruleRes, statsRes] = await Promise.all([
        getAlertRule(urlId),
        getThresholdStats(urlId)
      ])
      setRule(ruleRes.data)
      setStats(statsRes.data)
    } catch (err) {
      alert('加载失败: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [urlId])

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateAlertRule(urlId, {
        enabled: rule.enabled,
        overall_threshold: rule.overall_threshold,
        layout_threshold: rule.layout_threshold,
        content_threshold: rule.content_threshold,
        style_threshold: rule.style_threshold,
        notify_in_app: rule.notify_in_app,
        notify_email: rule.notify_email,
        email_address: rule.email_address,
        cooldown_minutes: rule.cooldown_minutes,
        auto_learn: rule.auto_learn
      })
      alert('保存成功')
    } catch (err) {
      alert('保存失败: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleResetLearning = async () => {
    if (!confirm('确定重置学习数据吗？所有累积的统计将被清空。')) return
    try {
      await resetLearning(urlId)
      loadData()
    } catch (err) {
      alert('操作失败: ' + err.message)
    }
  }

  const handleTriggerLearning = async () => {
    try {
      const res = await triggerLearning(urlId)
      if (res.data.learned && res.data.thresholdsAdjusted) {
        alert(`学习完成，阈值已调整:\n${res.data.adjustments?.join('\n') || ''}`)
      } else if (res.data.learned) {
        alert('学习完成，当前阈值无需调整')
      } else {
        alert(`无法学习: ${res.data.reason || '数据不足'}`)
      }
      loadData()
    } catch (err) {
      alert('操作失败: ' + err.message)
    }
  }

  const updateField = (field, value) => {
    setRule(prev => ({ ...prev, [field]: value }))
  }

  if (loading || !rule) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="text-center text-gray-500">加载中...</div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200">
      <div className="p-5 border-b border-gray-100">
        <div className="flex justify-between items-center">
          <div>
            <h3 className="text-lg font-semibold text-gray-800">告警规则设置</h3>
            <p className="text-sm text-gray-500 mt-0.5">{urlName}</p>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div className="p-5 space-y-5">
        <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
          <div>
            <div className="font-medium text-gray-800">启用告警</div>
            <div className="text-sm text-gray-500">关闭后将不再检测此URL的页面变化</div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={!!rule.enabled}
              onChange={(e) => updateField('enabled', e.target.checked ? 1 : 0)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-100 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
          </label>
        </div>

        <div className="space-y-4">
          <ThresholdSlider
            label="总体差异阈值"
            value={rule.overall_threshold}
            onChange={(v) => updateField('overall_threshold', v)}
            description="任何单一维度超过阈值都会触发告警"
          />
          <ThresholdSlider
            label="布局变化阈值"
            value={rule.layout_threshold}
            onChange={(v) => updateField('layout_threshold', v)}
            description="检测页面结构、模块位置的变化"
          />
          <ThresholdSlider
            label="内容变化阈值"
            value={rule.content_threshold}
            onChange={(v) => updateField('content_threshold', v)}
            description="检测文字、图片等内容的增删"
          />
          <ThresholdSlider
            label="样式变化阈值"
            value={rule.style_threshold}
            onChange={(v) => updateField('style_threshold', v)}
            description="检测颜色、字体、间距等样式调整"
          />
        </div>

        <div className="border-t border-gray-100 pt-4">
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
          >
            {showAdvanced ? '收起' : '展开'}高级设置
            <span className={`transform transition-transform ${showAdvanced ? 'rotate-180' : ''}`}>▼</span>
          </button>
        </div>

        {showAdvanced && (
          <div className="space-y-5 pt-2">
            <div>
              <div className="font-medium text-gray-800 mb-2">通知方式</div>
              <div className="space-y-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!rule.notify_in_app}
                    onChange={(e) => updateField('notify_in_app', e.target.checked ? 1 : 0)}
                    className="rounded border-gray-300"
                  />
                  <div>
                    <div className="text-sm font-medium text-gray-700">站内消息</div>
                    <div className="text-xs text-gray-500">在告警中心显示通知</div>
                  </div>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!rule.notify_email}
                    onChange={(e) => updateField('notify_email', e.target.checked ? 1 : 0)}
                    className="rounded border-gray-300"
                  />
                  <div>
                    <div className="text-sm font-medium text-gray-700">邮件通知</div>
                    <div className="text-xs text-gray-500">发送邮件到指定邮箱</div>
                  </div>
                </label>
                {!!rule.notify_email && (
                  <div className="ml-7">
                    <label className="block text-sm text-gray-600 mb-1">邮箱地址</label>
                    <input
                      type="email"
                      value={rule.email_address || ''}
                      onChange={(e) => updateField('email_address', e.target.value)}
                      placeholder="example@email.com"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                告警冷却时间（分钟）
              </label>
              <input
                type="number"
                min="1"
                value={rule.cooldown_minutes}
                onChange={(e) => updateField('cooldown_minutes', parseInt(e.target.value) || 60)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">冷却期内不会重复发送告警</p>
            </div>

            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <div>
                <div className="font-medium text-gray-800">自动学习阈值</div>
                <div className="text-sm text-gray-500">根据历史数据自动调整阈值，减少误报</div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!rule.auto_learn}
                  onChange={(e) => updateField('auto_learn', e.target.checked ? 1 : 0)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-100 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>

            {stats && (
              <div className="p-4 bg-gray-50 rounded-lg">
                <div className="font-medium text-gray-800 mb-3">学习统计</div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-gray-500">总对比次数</div>
                    <div className="font-semibold text-gray-800">{stats.total_comparisons}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">告警次数</div>
                    <div className="font-semibold text-gray-800">{stats.alert_count}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">误报次数</div>
                    <div className="font-semibold text-yellow-600">{stats.false_positive_count}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">平均总体差异</div>
                    <div className="font-semibold text-blue-600">
                      {Math.round((stats.avg_overall_score || 0) * 100)}%
                    </div>
                  </div>
                </div>
                {stats.last_learned_at && (
                  <div className="text-xs text-gray-500 mt-3">
                    上次学习: {new Date(stats.last_learned_at).toLocaleString('zh-CN')}
                  </div>
                )}
                <div className="flex gap-2 mt-4">
                  <button
                    onClick={handleTriggerLearning}
                    className="flex-1 text-xs bg-blue-50 text-blue-700 px-3 py-2 rounded-lg hover:bg-blue-100"
                  >
                    立即学习
                  </button>
                  <button
                    onClick={handleResetLearning}
                    className="flex-1 text-xs bg-gray-100 text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-200"
                  >
                    重置学习
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 bg-blue-600 text-white py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
          >
            {saving ? '保存中...' : '保存设置'}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="flex-1 bg-gray-100 text-gray-700 py-2.5 rounded-lg hover:bg-gray-200 font-medium"
            >
              取消
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

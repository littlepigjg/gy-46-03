import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 30000
})

export const getUrls = () => api.get('/urls')
export const addUrl = (data) => api.post('/urls', data)
export const deleteUrl = (id) => api.delete(`/urls/${id}`)
export const updateUrl = (id, data) => api.put(`/urls/${id}`, data)
export const getUrl = (id) => api.get(`/urls/${id}`)
export const getScreenshots = (urlId) => api.get(`/urls/${urlId}/screenshots`)
export const deleteScreenshot = (id) => api.delete(`/screenshots/${id}`)
export const triggerScreenshot = (urlId) => api.post(`/urls/${urlId}/screenshot`)

export const getAlertRule = (urlId) => api.get(`/urls/${urlId}/alert-rule`)
export const updateAlertRule = (urlId, data) => api.put(`/urls/${urlId}/alert-rule`, data)
export const getAlerts = (params) => api.get('/alerts', { params })
export const getAlertStats = (params) => api.get('/alerts/stats', { params })
export const markFalsePositive = (alertId, isFalsePositive = true) =>
  api.put(`/alerts/${alertId}/false-positive`, { is_false_positive: isFalsePositive })
export const getDiffHistory = (urlId, limit) =>
  api.get(`/urls/${urlId}/diff-history`, { params: { limit } })
export const getThresholdStats = (urlId) => api.get(`/urls/${urlId}/threshold-stats`)
export const resetLearning = (urlId) => api.post(`/urls/${urlId}/reset-learning`)
export const triggerLearning = (urlId) => api.post(`/urls/${urlId}/trigger-learning`)
export const compareImages = (data) => api.post('/compare-images', data)

export default api

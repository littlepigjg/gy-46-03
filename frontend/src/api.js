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

export default api

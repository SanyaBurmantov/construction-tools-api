import { getRequestURL, getRouterParam, proxyRequest } from 'h3'

export default defineEventHandler((event) => {
  const config = useRuntimeConfig()
  const path = getRouterParam(event, 'path') || ''
  const requestUrl = getRequestURL(event)
  const baseUrl = String(config.apiBaseServer).replace(/\/$/, '')
  const target = `${baseUrl}/${path}${requestUrl.search}`

  return proxyRequest(event, target)
})

import type { ShapeRequestBody, ShapeResult, UploadResponse } from './types'

async function readError(response: Response): Promise<string> {
  try {
    const data = await response.json()
    if (data && typeof data.detail === 'string') return data.detail
  } catch {
    /* fall through */
  }
  return `请求失败（HTTP ${response.status}）`
}

export async function uploadFont(file: Blob, filename: string): Promise<UploadResponse> {
  const form = new FormData()
  form.append('file', file, filename)
  const response = await fetch('/api/fonts', { method: 'POST', body: form })
  if (!response.ok) throw new Error(await readError(response))
  return response.json()
}

export async function shapeText(body: ShapeRequestBody): Promise<ShapeResult> {
  const response = await fetch('/api/shape', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!response.ok) throw new Error(await readError(response))
  return response.json()
}

export async function loadSampleFont(): Promise<{ blob: Blob; name: string }> {
  const response = await fetch('/sample/amiri-regular.ttf')
  if (!response.ok) throw new Error('样本字体无法下载')
  return { blob: await response.blob(), name: 'amiri-regular.ttf' }
}

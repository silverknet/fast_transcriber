import type { SongMap } from '$lib/songmap/types'

export type AnalyzeRequest = {
  filename: string
  mimeType: string
  sizeBytes: number
}

export type AnalyzeSuccess = {
  ok: true
  status: 'complete'
  message: string
  request: AnalyzeRequest
  songMap: SongMap
}

export type AnalyzeFailure = {
  ok: false
  error: string
}

export type AnalyzeResponse = AnalyzeSuccess | AnalyzeFailure

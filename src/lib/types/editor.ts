import type { TimeRange } from './timeline'

export type DetailMode =
  | 'idle'
  | 'maybe-seek'
  | 'create-selection'
  | 'move-selection'
  | 'resize-selection-left'
  | 'resize-selection-right'

export type MinimapMode =
  | 'idle'
  | 'drag-viewport'
  | 'resize-viewport-left'
  | 'resize-viewport-right'

export type DetailSession = {
  downClientX: number
  downClientY: number
  pointerTravelMax: number
  anchorTime: number
  selectionAtDown: TimeRange
  onSelectionBody: boolean
}

export type MinimapSession = {
  downClientX: number
  viewAtDown: TimeRange
}

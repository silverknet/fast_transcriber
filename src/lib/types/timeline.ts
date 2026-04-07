/**
 * Editor / UI time ranges only. Persistent bars and beats live in `$lib/songmap`.
 */
export type TimeRange = {
  start: number
  end: number
}

export type Viewport = TimeRange
export type Selection = TimeRange

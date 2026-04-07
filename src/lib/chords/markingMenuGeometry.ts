/**
 * Pointer geometry for radial marking menus (screen space: +y is down).
 * Six 60° wedges; sector 0 is centered on +x (right), advancing clockwise.
 */

export function angleRad(dx: number, dy: number): number {
  return Math.atan2(dy, dx)
}

export function distance(dx: number, dy: number): number {
  return Math.hypot(dx, dy)
}

/** Angle in radians, normalized to [0, 2π). */
export function normalizeAngleRad(a: number): number {
  const t = a % (Math.PI * 2)
  return t < 0 ? t + Math.PI * 2 : t
}

/**
 * Wedge index 0..5 for six harmonic families (stable layout).
 * 0=right (tonic), 1=down-right (special), 2=down (subdominant),
 * 3=left (dominant), 4=up-left (borrowed), 5=up-right (secondary dominant).
 */
export function familySectorIndex6(dx: number, dy: number): number {
  const deg = (angleRad(dx, dy) * 180) / Math.PI
  const shifted = ((deg + 30 + 360) % 360) / 60
  return Math.min(5, Math.floor(shifted))
}

/** Center angle (radians) of family sector `index` (0..5), for placing ring nodes. */
export function familyCenterRad(sectorIndex: number): number {
  return (sectorIndex * Math.PI) / 3
}

/** Absolute angles (radians) for `count` items in an arc centered on `centerRad`. */
export function itemAnglesRadial(centerRad: number, count: number, spreadRad = 0.35): number[] {
  if (count <= 0) return []
  if (count === 1) return [centerRad]
  const half = ((count - 1) * spreadRad) / 2
  return Array.from({ length: count }, (_, i) => centerRad - half + i * spreadRad)
}

/** Shortest signed angular distance in [-π, π]. */
export function angleDeltaRad(a: number, b: number): number {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return d
}

/** Index of item whose angle is closest to `pointerAngleRad`. */
export function closestItemIndex(pointerAngleRad: number, itemAnglesRad: number[]): number {
  if (itemAnglesRad.length === 0) return -1
  let best = 0
  let bestAbs = Infinity
  for (let i = 0; i < itemAnglesRad.length; i++) {
    const ad = Math.abs(angleDeltaRad(itemAnglesRad[i]!, pointerAngleRad))
    if (ad < bestAbs) {
      bestAbs = ad
      best = i
    }
  }
  return best
}

/** 12 bass pitch classes placed starting at angle 0 (right), every 30°. */
export function bassNoteAngleRad(pc: number): number {
  return (pc * Math.PI) / 6
}

export function closestBassPc(pointerAngleRad: number): number {
  let best = 0
  let bestAbs = Infinity
  for (let pc = 0; pc < 12; pc++) {
    const ad = Math.abs(angleDeltaRad(bassNoteAngleRad(pc), pointerAngleRad))
    if (ad < bestAbs) {
      bestAbs = ad
      best = pc
    }
  }
  return best
}

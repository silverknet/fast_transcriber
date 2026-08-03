import type { LiveAudioShadowPlan } from './audioConfigValidator'

export type LiveAudioShadowDiagnostic = Readonly<{
  generationId: string
  projectId: string
  songId: string
  disposition: LiveAudioShadowPlan['configurationDisposition']
  main: LiveAudioShadowPlan['main']
  performers: LiveAudioShadowPlan['performers']
  admittedSources: LiveAudioShadowPlan['admittedSources']
  admittedSourceIds: readonly string[]
  excludedSources: LiveAudioShadowPlan['excludedSources']
  click: LiveAudioShadowPlan['click']
  cueTracks: LiveAudioShadowPlan['cueTracks']
  issues: LiveAudioShadowPlan['issues']
  evidence: Readonly<{
    xr18ControlConnected: boolean
    xr18AudioRouteVerified: false
  }>
}>

/** A stable, serializable diagnostics projection. It does not mutate or activate anything. */
export function liveAudioShadowDiagnostic(
  plan: LiveAudioShadowPlan,
): LiveAudioShadowDiagnostic {
  return {
    generationId: plan.generationId,
    projectId: plan.projectId,
    songId: plan.songId,
    disposition: plan.configurationDisposition,
    main: plan.main,
    performers: plan.performers,
    admittedSources: plan.admittedSources,
    admittedSourceIds: plan.admittedSources.map((source) => source.id),
    excludedSources: plan.excludedSources,
    click: plan.click,
    cueTracks: plan.cueTracks,
    issues: plan.issues,
    evidence: {
      xr18ControlConnected: plan.xr18ControlConnected,
      xr18AudioRouteVerified: plan.xr18AudioRouteVerified,
    },
  }
}

export function formatLiveAudioShadowDiagnostic(
  plan: LiveAudioShadowPlan,
): string {
  return JSON.stringify(liveAudioShadowDiagnostic(plan), null, 2)
}

/**
 * Opt-in development hook. No production route imports this function; a caller
 * must explicitly provide the plan it wants to compare with current behavior.
 */
export function logLiveAudioShadowDiagnostic(
  plan: LiveAudioShadowPlan,
  sink: (message: string) => void = console.debug,
): void {
  sink(`[live-audio-shadow]\n${formatLiveAudioShadowDiagnostic(plan)}`)
}

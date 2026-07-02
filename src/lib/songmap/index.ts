export { SONGMAP_FORMAT_VERSION, SONGMAP_VERSION_CHANGELOG } from './version'
export type {
  Accidental,
  AudioReference,
  AudioSource,
  Bar,
  Beat,
  BeatSource,
  ChordSymbol,
  CueAnchor,
  CueEvent,
  CueEventKind,
  CueEventSource,
  CueMode,
  CueSettings,
  CueTrack,
  CueTrackExport,
  HarmonyEvent,
  Meter,
  NoteName,
  Section,
  SectionKind,
  SongKey,
  SongKeyMode,
  SongMap,
  SongMapAnalysisFragment,
  SongMapAppInfo,
  SongMapTimeline,
  SongMapV1,
  SongMapV2,
  SongMetadata,
} from './types'
export { canonicalizeSongMapForSerialize, serializeSongMap } from './serialize'
export type { SerializeSongMapOptions } from './serialize'
export { parseSongMap, SongMapParseError } from './parse'
export type { ParseSongMapOptions } from './parse'
export { validateSongMap } from './validate'
export type { ValidationResult } from './validate'
export { isSongMapV1, isSongMapV2, assertSongMap } from './guards'
export { defaultCueSettings, emptySongMetadata, DEFAULT_METER } from './defaults'
export {
  createDefaultCueTrack,
  cueTrackHasSharedData,
  DEFAULT_CUE_TRACK_ID,
  generateCueTrackFromSections,
  generatedCountKey,
  generatedSectionKey,
  getPrimaryCueTrack,
} from './cueTracks'
export {
  decodeSmapFile,
  downloadBlob,
  downloadUint8ArrayAsFile,
  encodeSmapFile,
  exportRestorableBundle,
  exportRestorableStateAsSmapBlob,
  exportSongMapJson,
  looksLikeSmapFile,
  parseImportedProjectFile,
  parseSongMapJsonString,
  parseSongProjectFromUtf8Text,
  restorableStateFromJsonAndBlob,
  safeExportBasename,
  sha256HexOfBlob,
  smapFileDataToRestorableState,
  songProjectFromRestorableState,
  SMAP_BLOB_TYPE,
  SMAP_FILE_VERSION,
  SMAP_FLAG_HAS_AUDIO,
  SMAP_HEADER_BYTE_LENGTH,
  SONG_PROJECT_FORMAT_VERSION,
  withAudioSha256,
} from './persist'
export type { ExportBundle, ParsedSongMapJson, SongProject, SmapFileData } from './persist'
export {
  audioSessionFromMapAndBlob,
  mergeAudioReferenceFromSession,
  restorableSongState,
} from './session'
export type { RestorableSongState } from './session'
export {
  createEmptySongMap,
  createSongMapFromAudioSession,
  newId,
} from './factory'
export type {
  CreateEmptySongMapOptions,
  CreateSongMapFromAudioSessionOptions,
  IdFactory,
} from './factory'
export { sortBarsByIndex, sortBeatsByTime } from './normalize'
export { mergeAnalysisIntoSongMap } from './merge'
export { upsertHarmonyAtBeat, clearHarmonyAtBeat, beatHarmonySpan } from './harmonyEdit'
export {
  addBarAtEnd,
  addBarAtStart,
  applyBarGridAction,
  evenBeatTimes,
  MAX_BEATS_PER_BAR,
  mergeBarWithPrevious,
  MIN_BEATS_PER_BAR,
  redistributeBeatsEvenly,
  removeBarAtEnd,
  removeBarAtStart,
  setBarBoundary,
  setBarBeatCount,
  splitBarAtMidpoint,
} from './timelineEdit'
export type {
  BarGridAction,
  TimelineEditResult,
  IdFactory as TimelineEditIdFactory,
} from './timelineEdit'
export {
  defaultSectionLabel,
  SECTION_KIND_OPTIONS,
  setSectionForBarRange,
} from './sectionEdit'

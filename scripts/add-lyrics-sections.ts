/**
 * Add lyrics + sections to every song's "AI chords" draft (keeping the bass
 * chords). Lyrics come from transcribing the VOCALS stem with faster-whisper
 * large-v3-turbo — the words are what's actually sung, word-timed by Whisper,
 * so no external lyrics source (and no alignment) is needed. Sections are
 * derived from line repetition (fuzzy chorus detection).
 *
 * Cloud-only push, in place on the existing AI draft (no new draft ids), so no
 * duplicates. Resumable: a song whose AI draft already has lyrics is skipped,
 * and each transcription is cached under /tmp/lyrics-cache so a re-run is cheap.
 *
 * Usage: vite-node add-lyrics-sections.ts [folderSubstringFilter]
 */
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { parseSongMap } from '../src/lib/songmap/parse'
import { validateSongMap } from '../src/lib/songmap/validate'
import { toCollabSongMap } from '../src/lib/songmap/collab'
import { defaultSectionLabel } from '../src/lib/songmap/sectionEdit'
import type { LyricWord, Section, SectionKind, SongDraft, SongMap } from '../src/lib/songmap/types'
function env(k:string){const raw=fs.readFileSync(new URL('../.env',import.meta.url),'utf8');for(const l of raw.split('\n')){const t=l.trim();if(!t||t.startsWith('#'))continue;const i=t.indexOf('=');if(t.slice(0,i).trim()===k)return t.slice(i+1).trim().replace(/^["']|["']$/g,'')}throw new Error(k)}
const supa=createClient(env('PUBLIC_SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false}})
const HOME=process.env.HOME!
const PY=`${HOME}/Library/Application Support/barbro-desktop/python/lyrics-venv/bin/python3`
const MODELDIR=`${HOME}/Library/Application Support/barbro-desktop/python/lyrics/models`
const PROJ='/Users/martin/Documents/Barbro projects/test1234'
const filter=(process.argv[2]&&!process.argv[2].startsWith('--'))?process.argv[2]:''
const force=process.argv.includes('--force')
const CACHE='/tmp/lyrics-cache'; fs.mkdirSync(CACHE,{recursive:true})
/** Full-mix audio fallback when a song has no (usable) vocals stem. */
function mixAudio(folder:string):string|null{const dir=path.join(PROJ,folder,'audio');if(!fs.existsSync(dir))return null
  const a=fs.readdirSync(dir).filter(f=>/\.(wav|flac|mp3|m4a|ogg)$/i.test(f));return a.length?path.join(dir,a[0]!):null}

const LANG:[string,string][]=[
  ['love never','en'],['tame her','en'],['when we were young','en'],['dangerous','en'],
  ['dance with somebody','en'],['valerie','en'],['calleth','en'],
  ['sommartider','sv'],['diggiloo','sv'],['dum av dig','sv'],['leva livet','sv'],
  ['tur att vi lever','sv'],['och med du','sv'],['hell yeah','sv'],['alltid gratis','sv'],['ramlar','sv'],
]
const langFor=(t:string)=>LANG.find(([s])=>t.toLowerCase().includes(s))?.[1]??'en'

type Seg={text:string;start:number;end:number;words:{text:string;start:number;end:number}[]}
// Whisper hallucinates subtitle/credit lines on ambiguous (poorly-separated)
// audio — "Textning.nu", "www.btistudios.com", "Svensktextning.nu" etc. Drop them.
const GARBAGE=/textning|btistudios|svensktextning|amara|undertext|captions?|subtitles?|www\.|https?:\/\/|\.(nu|com|org)\b/i
function transcribe(vox:string,lang:string,cacheKey:string):Seg[]{
  const cp=path.join(CACHE,cacheKey+'.json')
  if(fs.existsSync(cp))return JSON.parse(fs.readFileSync(cp,'utf8'))
  const out=execFileSync(PY,['scripts/transcribe_lines.py',vox],{
    input:JSON.stringify({modelDir:MODELDIR,model:'mobiuslabsgmbh/faster-whisper-large-v3-turbo',language:lang}),
    maxBuffer:64*1024*1024,encoding:'utf8',timeout:400000})
  const segs=(JSON.parse(out).segments as Seg[]);fs.writeFileSync(cp,JSON.stringify(segs));return segs}
const norm=(s:string)=>s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu,'').replace(/\s+/g,' ').trim()

function build(sm:SongMap,segs:Seg[]){
  const words:LyricWord[]=[]
  segs.forEach((seg,li)=>{for(const w of seg.words)words.push({text:w.text,startSec:w.start,endSec:Math.max(w.end,w.start+0.05),line:li,aligned:true})})
  for(let i=1;i<words.length;i++){if(words[i]!.startSec<words[i-1]!.startSec)words[i]!.startSec=words[i-1]!.startSec;if(words[i]!.endSec<=words[i]!.startSec)words[i]!.endSec=words[i]!.startSec+0.05}
  const sourceText=segs.map(s=>s.text.trim()).join('\n')
  const bars=[...sm.timeline.bars].sort((a,b)=>a.index-b.index)
  const barAt=(t:number)=>{const b=bars.find(x=>t>=x.startSec&&t<x.endSec)??(t<bars[0]!.startSec?bars[0]!:bars[bars.length-1]!);return b.index}
  const L=segs.map((s)=>({start:s.start,end:s.end,ws:new Set(norm(s.text).split(' ').filter(w=>w.length>=2))}))
  const sim=(i:number,j:number)=>{const a=L[i]!.ws,b=L[j]!.ws;if(!a.size||!b.size)return 0;let x=0;for(const w of a)if(b.has(w))x++;return x/(a.size+b.size-x)}
  const repeats=L.map((_,i)=>L.some((__,j)=>Math.abs(i-j)>=2&&sim(i,j)>=0.5))
  const runs:{rep:boolean;s:number;e:number}[]=[]
  L.forEach((l,i)=>{const last=runs[runs.length-1];if(last&&last.rep===repeats[i])last.e=l.end;else runs.push({rep:repeats[i]!,s:l.start,e:l.end})})
  let secs:{kind:SectionKind;startBar:number;endBar:number}[]=[]
  const firstBar=barAt(L[0]!.start)
  if(firstBar>0)secs.push({kind:'intro',startBar:0,endBar:firstBar-1})
  for(const r of runs)secs.push({kind:r.rep?'chorus':'verse',startBar:barAt(r.s),endBar:barAt(r.e)})
  const lastBar=bars[bars.length-1]!.index
  if(secs[secs.length-1]!.endBar<lastBar)secs.push({kind:'outro',startBar:secs[secs.length-1]!.endBar+1,endBar:lastBar})
  secs.sort((a,b)=>a.startBar-b.startBar)
  secs=secs.filter((s,i)=>i===0||s.startBar>secs[i-1]!.startBar)
  for(let i=0;i<secs.length;i++)secs[i]!.endBar=i<secs.length-1?Math.max(secs[i]!.startBar,secs[i+1]!.startBar-1):Math.max(secs[i]!.endBar,secs[i]!.startBar)
  const folded:typeof secs=[]
  for(const s of secs){if(folded.length&&s.endBar-s.startBar+1<3)folded[folded.length-1]!.endBar=s.endBar;else folded.push({...s})}
  const mergedS:typeof secs=[]
  for(const s of folded){const last=mergedS[mergedS.length-1];if(last&&last.kind===s.kind)last.endBar=s.endBar;else mergedS.push({...s})}
  const sections:Section[]=mergedS.map((s)=>({id:crypto.randomUUID(),kind:s.kind,label:defaultSectionLabel(s.kind),barRange:{startBarIndex:s.startBar,endBarIndex:s.endBar}}))
  return {words,sourceText,sections}
}

function processSong(folder:string,cloudRow:any){
  const sm=parseSongMap(JSON.stringify(cloudRow.song_map))
  const title=sm.metadata.title
  const activeIsAI=(sm.activeDraftName??'').startsWith('AI chords')
  const storedIdx=(sm.drafts??[]).findIndex(d=>d.name.startsWith('AI chords'))
  if(!activeIsAI && storedIdx<0) return `SKIP ${title}: no AI draft`
  const existingLyrics=activeIsAI?sm.lyrics:sm.drafts![storedIdx]!.lyrics
  if(!force && existingLyrics?.words?.length) return `skip ${title}: already has lyrics`
  const key=folder.replace(/[^\w]/g,'_')
  const vox=path.join(PROJ,folder,'stems','best','vocals.wav')
  const source=fs.existsSync(vox)?vox:mixAudio(folder)
  if(!source) return `SKIP ${title}: no vocals stem or mix audio`
  let segs=transcribe(source,langFor(title),key).filter(s=>!GARBAGE.test(s.text))
  // Poor vocal separation (or a missing stem) yields near-nothing — fall back
  // to the full mix, which large-v3-turbo transcribes even under instruments.
  if(segs.length<6){const mix=mixAudio(folder);if(mix&&mix!==source)segs=transcribe(mix,langFor(title),key+'_mix').filter(s=>!GARBAGE.test(s.text))}
  // Too few clean lines = separation too poor to transcribe (mostly hallucinated).
  // Don't ship junk: clear any previously-pushed low-quality lyrics, flag for manual.
  if(segs.length<5){
    if(!existingLyrics?.words?.length) return `SKIP ${title}: too few clean lines (${segs.length}) — needs manual lyrics`
    let cleared:SongMap
    if(activeIsAI) cleared={...sm,lyrics:undefined,sections:[]}
    else{const nd=[...sm.drafts!];nd[storedIdx]={...nd[storedIdx]!,lyrics:undefined,sections:[]} as SongDraft;cleared={...sm,drafts:nd}}
    return {title,next:cleared,words:0,lines:0,sections:0,rev:cloudRow.revision,note:'cleared low-quality lyrics — needs manual'}
  }
  const {words,sourceText,sections}=build(sm,segs)
  const lyrics={words,sourceText,transcriberVersion:1,alignedAt:new Date().toISOString()}
  let next:SongMap
  if(activeIsAI) next={...sm,lyrics,sections}
  else{const nd=[...sm.drafts!];nd[storedIdx]={...nd[storedIdx]!,lyrics,sections} as SongDraft;next={...sm,drafts:nd}}
  const v=validateSongMap(next);if(!v.ok) return `FAIL ${title}: ${v.errors[0]}`
  return {title,next,words:words.length,lines:segs.length,sections:sections.length,rev:cloudRow.revision}
}

const man=JSON.parse(fs.readFileSync(path.join(PROJ,'barbro.project.json'),'utf8'))
const {data:rows}=await supa.from('cloud_songs').select('id,revision,song_map')
for(const s of man.songs){ if(filter && !s.folder.includes(filter)) continue
  try{
    // match cloud row by title from the disk song map
    const disk=parseSongMap(JSON.stringify((()=>{const raw=fs.readFileSync(path.join(PROJ,s.folder,'song.smap'));const o=JSON.parse(raw.subarray(raw.indexOf(0x7b)).toString('utf8').replace(/\0+$/,''));return o.songMap??o})()))
    const cloudRow=rows!.find(r=>(r.song_map?.metadata?.title??'')===disk.metadata.title)
    if(!cloudRow){console.log(`SKIP ${disk.metadata.title}: no cloud row`);continue}
    const r=processSong(s.folder,cloudRow)
    if(typeof r==='string'){console.log(r);continue}
    await supa.from('cloud_songs').update({song_map:toCollabSongMap(r.next),revision:r.rev+1}).eq('id',cloudRow.id)
    const note=(r as any).note as string|undefined
    console.log(`${note?'CLR ':'OK  '} ${r.title.padEnd(28)} ${note ?? `${r.lines} lines / ${r.words} words, ${r.sections} sections`}`)
  }catch(e:any){console.log(`ERR  ${s.folder}: ${String(e.message).slice(0,120)}`)} }
process.exit(0)

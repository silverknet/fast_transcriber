/**
 * Batch: bass-driven chords for every song. New "AI chords" draft, preserves
 * every existing draft. Re-runnable: an existing "AI chords" draft is replaced,
 * not duplicated.
 *
 * Key detection: the chords of a song come from ONE 7-note scale, and relative
 * major/minor share that scale (and therefore the same diatonic triads). So we
 * don't guess a mode — we find the major-scale root R whose scale best CONTAINS
 * the observed bass roots (out-of-scale mass penalised, KK as a tiebreak) and
 * map every root through the fixed major-diatonic pattern. The friendly label
 * (relative minor when its root carries more bass mass) is cosmetic only.
 *
 * Usage: vite-node ai-bass-chords.ts [folderSubstringFilter]
 */
import fs from 'node:fs'; import crypto from 'node:crypto'; import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { parseSongMap } from '../src/lib/songmap/parse'
import { addDraftAndActivate, listDrafts, switchToDraft, deleteDraft } from '../src/lib/songmap/drafts'
import { parseChordText } from '../src/lib/chords/parseChordText'
import { validateSongMap } from '../src/lib/songmap/validate'
import { toCollabSongMap } from '../src/lib/songmap/collab'
import type { HarmonyEvent, SongMap } from '../src/lib/songmap/types'
function env(k:string){const raw=fs.readFileSync(new URL('../.env',import.meta.url),'utf8');for(const line of raw.split('\n')){const l=line.trim();if(!l||l.startsWith('#'))continue;const i=l.indexOf('=');if(i<0)continue;if(l.slice(0,i).trim()===k)return l.slice(i+1).trim().replace(/^["']|["']$/g,'')}throw new Error(k)}
const supa=createClient(env('PUBLIC_SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false}})
const uuid=()=>crypto.randomUUID()
const PROJ='/Users/martin/Documents/Barbro projects/test1234'
const filter=process.argv[2]||''
const NAMES=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']

function loadWav(p:string){const buf=fs.readFileSync(p);let q=12,fmt:any={},dO=0,dL=0
  while(q<buf.length-8){const id=buf.toString('ascii',q,q+4),sz=buf.readUInt32LE(q+4);if(id==='fmt ')fmt={ch:buf.readUInt16LE(q+10),fs:buf.readUInt32LE(q+12)};if(id==='data'){dO=q+8;dL=sz;break}q+=8+sz+(sz&1)}
  const {ch,fs:sr}=fmt,n=Math.floor(dL/2),mono=new Float64Array(Math.floor(n/ch));for(let k=0,j=0;k<n;k+=ch,j++){let s=0;for(let c=0;c<ch;c++)s+=buf.readInt16LE(dO+(k+c)*2);mono[j]=s/ch/32768};return {mono,sr}}
const rmsWin=(w:any,t:number,d:number)=>{const s=Math.floor(t*w.sr),e=Math.min(w.mono.length,s+Math.floor(d*w.sr));let a=0;for(let k=s;k<e;k++)a+=w.mono[k]*w.mono[k];return Math.sqrt(a/Math.max(1,e-s))}
function bassPC(w:any,t:number){const s=Math.floor((t+0.02)*w.sr),e=s+Math.floor(0.11*w.sr);if(e>=w.mono.length)return null
  const x=w.mono.slice(s,e);let rms=0;for(const v of x)rms+=v*v;rms=Math.sqrt(rms/x.length);if(rms<0.004)return null
  let m=0;for(const v of x)m+=v;m/=x.length;for(let k=0;k<x.length;k++)x[k]=(x[k]-m)*(0.5-0.5*Math.cos(2*Math.PI*k/(x.length-1)))
  const lo=Math.floor(w.sr/330),hi=Math.floor(w.sr/38);let bl=lo,bv=-Infinity
  for(let lag=lo;lag<hi;lag++){let a=0;for(let k=0;k+lag<x.length;k++)a+=x[k]*x[k+lag];if(a>bv){bv=a;bl=lag}}
  const midi=Math.round(69+12*Math.log2((w.sr/bl)/440));return ((midi%12)+12)%12}

const MAJP=[6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88]
function corr(a:number[],b:number[]){const n=a.length,ma=a.reduce((x,y)=>x+y)/n,mb=b.reduce((x,y)=>x+y)/n;let nu=0,da=0,db=0;for(let i=0;i<n;i++){nu+=(a[i]-ma)*(b[i]-mb);da+=(a[i]-ma)**2;db+=(b[i]-mb)**2}return da&&db?nu/Math.sqrt(da*db):0}
/** major-scale root R whose scale best contains the bass-root histogram */
function detectScaleRoot(hist:number[]){const total=hist.reduce((a,b)=>a+b,0)||1;let best={R:0,s:-1e9}
  for(let R=0;R<12;R++){const scale=[0,2,4,5,7,9,11].map(d=>(R+d)%12);let inM=0;for(const pc of scale)inM+=hist[pc]
    const s=(inM-1.6*(total-inM))/total+0.2*corr(hist,hist.map((_,i)=>MAJP[((i-R)%12+12)%12]))
    if(s>best.s)best={R,s}}
  return best.R}
/** diatonic triad for a bass PC within the major scale rooted at R */
function diatonicChord(pc:number,R:number){
  const rel=((pc-R)%12+12)%12
  const T:Record<number,string>={0:'',2:'m',4:'m',5:'',7:'',9:'m',11:'dim'}
  const scale=Object.keys(T).map(Number);let best=scale[0]!,bd=99
  for(const s of scale){const d=Math.min((rel-s+12)%12,(s-rel+12)%12);if(d<bd){bd=d;best=s}}
  return NAMES[(R+best)%12]!+T[best]!}

/** Remove an existing "AI chords" draft (active or stored) so a re-run replaces it. */
function stripAiDraft(base:SongMap):SongMap{
  const ai=listDrafts(base).find(d=>d.name==='AI chords');if(!ai)return base
  let m=base
  if(ai.active){const other=listDrafts(base).find(d=>!d.active);if(!other)return base
    const sw=switchToDraft(m,other.id,uuid);if(!sw.ok)return base;m=sw.map
    const stored=listDrafts(m).find(d=>d.name==='AI chords'&&!d.active);if(stored)m=deleteDraft(m,stored.id)}
  else m=deleteDraft(m,ai.id)
  return m}

async function processSong(folder:string, cloudRows:any[]){
  const raw=fs.readFileSync(path.join(PROJ,folder,'song.smap'))
  const disk=parseSongMap(JSON.stringify((()=>{const o=JSON.parse(raw.subarray(raw.indexOf(0x7b)).toString('utf8').replace(/\0+$/,''));return o.songMap??o})()))
  const title=disk.metadata.title
  const cloudRow=cloudRows.find(r=>(r.song_map?.metadata?.title??'')===title)
  if(!cloudRow) return `SKIP ${title}: no cloud row`
  const cloud=parseSongMap(JSON.stringify(cloudRow.song_map))
  const bassPath=path.join(PROJ,folder,'stems','best','bass.wav')
  if(!fs.existsSync(bassPath)) return `SKIP ${title}: no bass stem`
  // Grids must agree to reference cloud beats. When they don't, the cloud copy
  // is stale (never analysed, or an older half-time grid) — rebuild from the
  // current disk analysis, but ONLY if the cloud has no real work to clobber.
  let base:SongMap; let rebuilt=''
  if(cloud.timeline.beats.map(b=>b.id).join()===disk.timeline.beats.map(b=>b.id).join()) base=stripAiDraft(cloud)
  else {
    const cloudTrivial=cloud.harmony.length===0 && cloud.sections.length===0 && (cloud.drafts??[]).every(d=>d.harmony.length===0 && d.sections.length===0)
    if(!cloudTrivial || disk.timeline.beats.length===0) return `SKIP ${title}: beat grid mismatch, cloud has content`
    base=stripAiDraft(disk); rebuilt=' [rebuilt from disk analysis]'
  }

  const bars=[...base.timeline.bars].sort((a,b)=>a.index-b.index)
  const beats=[...base.timeline.beats].sort((a,b)=>a.timeSec-b.timeSec)
  const downbeat=(barId:string)=>base.timeline.beats.filter(b=>b.barId===barId).sort((a,b)=>a.indexInBar-b.indexInBar)[0]
  const bass=loadWav(bassPath)
  const gtrPath=path.join(PROJ,folder,'stems','best','other.wav')
  const gtr=fs.existsSync(gtrPath)?loadWav(gtrPath):null

  const perBeatPC=beats.map(be=>bassPC(bass,be.timeSec))
  const hist=new Array(12).fill(0);for(const p of perBeatPC)if(p!=null)hist[p]++
  const R=detectScaleRoot(hist)
  const relm=(R+9)%12
  const labelPc=hist[R]>=hist[relm]?R:relm, labelMode=hist[R]>=hist[relm]?'major':'minor'
  const keyStr=`${NAMES[labelPc]} ${labelMode}`

  const bassE=bars.map(bar=>rmsWin(bass,bar.startSec,bar.endSec-bar.startSec))
  const gtrE=gtr?bars.map(bar=>rmsWin(gtr,bar.startSec,bar.endSec-bar.startSec)):bassE.map(()=>1)
  const med=(a:number[])=>{const s=[...a].sort((x,y)=>x-y);return s[Math.floor(s.length/2)]!}
  const bMed=med(bassE),gMed=med(gtrE)
  const perBar=new Map<number,string|null>();const breaks:number[]=[]
  for(let k=0;k<bars.length;k++){const bar=bars[k]!
    if(bassE[k]!<bMed*0.28 && gtrE[k]!<gMed*0.28){perBar.set(bar.index,null);breaks.push(bar.index);continue}
    const cs=beats.map((be,j)=>[be,perBeatPC[j]] as const).filter(([be])=>be.barId===bar.id).map(([,p])=>p).filter(p=>p!=null) as number[]
    if(!cs.length)continue;const cnt:Record<number,number>={};for(const p of cs)cnt[p]=(cnt[p]||0)+1
    const pc=Number(Object.entries(cnt).sort((a,b)=>b[1]-a[1])[0]![0]);perBar.set(bar.index,diatonicChord(pc,R))}

  const harmony:HarmonyEvent[]=[];let prev:string|null=null
  for(const bar of bars){const c=perBar.get(bar.index);if(c===undefined)continue;if(c===null){prev=null;continue};if(c===prev)continue;prev=c
    const db=downbeat(bar.id);if(!db)continue;const p=parseChordText(c);if(!p.ok)continue
    harmony.push({id:uuid(),barId:bar.id,beatId:db.id,startSec:db.timeSec,endSec:db.timeSec+0.5,chord:p.chord})}
  for(let k=0;k<harmony.length;k++){const sb=bars.find(b=>b.id===harmony[k]!.barId)!.index
    let end=harmony[k+1]?harmony[k+1]!.startSec:bars[bars.length-1]!.endSec
    for(const br of breaks)if(br>sb){const bb=bars.find(b=>b.index===br);if(bb&&bb.startSec<end){end=bb.startSec;break}}
    harmony[k]!.endSec=Math.max(end,harmony[k]!.startSec+0.3)}
  if(!harmony.length) return `SKIP ${title}: no chords detected`

  const withKey:SongMap={...base,metadata:{...base.metadata,keyDetail:{root:NAMES[labelPc]!.replace('#','') as any,accidental:NAMES[labelPc]!.includes('#')?'sharp':undefined,mode:labelMode as any}}}
  const next=addDraftAndActivate(withKey,{sections:base.sections.length?base.sections.map(s=>({...s,id:uuid(),barRange:{...s.barRange}})):[],harmony,lyrics:base.lyrics},'AI chords',uuid)
  const v=validateSongMap(next);if(!v.ok) return `FAIL ${title}: ${v.errors[0]}`
  await supa.from('cloud_songs').update({song_map:toCollabSongMap(next),revision:cloudRow.revision+1}).eq('id',cloudRow.id)
  const tally:Record<string,number>={};for(const h of harmony)tally[h.chord.displayRaw]=(tally[h.chord.displayRaw]||0)+1
  const top=Object.entries(tally).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([c,n])=>`${c}×${n}`).join(' ')
  return `OK   ${title.padEnd(28)} key ${keyStr.padEnd(9)} ${harmony.length} chords, ${breaks.length} breaks | ${top}${rebuilt}`
}

const man=JSON.parse(fs.readFileSync(path.join(PROJ,'barbro.project.json'),'utf8'))
const {data:cloudRows}=await supa.from('cloud_songs').select('id, revision, song_map')
for(const s of man.songs){ if(filter && !s.folder.includes(filter)) continue
  try{ console.log(await processSong(s.folder, cloudRows!)) }catch(e:any){ console.log(`ERR  ${s.folder}: ${e.message}`) } }
process.exit(0)

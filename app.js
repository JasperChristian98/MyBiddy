/* My Biddy Aunt — referee-first static application, no backend required. */
'use strict';
const $ = id => document.getElementById(id);
const show = (id, visible) => $(id).classList.toggle('hidden', !visible);
const safe = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const num = value => value === '' || value == null ? null : (Number.isFinite(+value) ? +value : null);
const norm = value => String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const fmt = number => Number(number || 0).toLocaleString('en-GB');
const storageGet = (name, otherwise) => {try { const value=localStorage.getItem(name); return value===null?otherwise:JSON.parse(value); } catch {return otherwise;}};
const storageSet = (name, value) => {try {localStorage.setItem(name,JSON.stringify(value));} catch { /* Private mode still works for one session. */ }};
const sessionGet = (name, otherwise) => {try { const value=sessionStorage.getItem(name); return value===null?otherwise:JSON.parse(value); } catch {return otherwise;}};
const sessionSet = (name, value) => {try {sessionStorage.setItem(name,JSON.stringify(value));} catch {}};
const sessionRemove = name => {try {sessionStorage.removeItem(name);} catch {}};
const GAME_SESSION_KEY='mba_game_v4';
let toastTimeout;
function toast(message) { const t=$('toast');t.textContent=message;show('toast',true);clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>show('toast',false),3200); }

const PRESETS = {
  familiar:{top:100,minApps:350,minClubs:3,yearFrom:1992,yearTo:null,position:'',rank:'senior',minPL:null},
  regular:{top:250,minApps:250,minClubs:3,yearFrom:1992,yearTo:null,position:'',rank:'senior',minPL:null},
  wide:{top:500,minApps:100,minClubs:3,yearFrom:1992,yearTo:null,position:'',rank:'senior',minPL:null},
  all:{top:0,minApps:0,minClubs:3,yearFrom:null,yearTo:null,position:'',rank:'senior',minPL:null}
};
const savedPool = storageGet('mba_pool_v3',PRESETS.regular);
const state = {
  database:[],byId:new Map(),ready:false,isDemo:false,hasPL:false,
  queue:storageGet('mba_queue_v3',[]),pool:{...PRESETS.regular,...(savedPool && typeof savedPool==='object'?savedPool:{})},
  active:false,names:[],scores:[],target:10,round:0,starter:0,turn:0,
  current:null,currentSource:'random',bid:0,bidder:null,challenger:null,proposal:1,
  accepted:[],seen:new Set(),selectedDetail:null,explorerPage:1,phase:'setup',roundResult:null,bidHistory:[],gameHistory:[]
};
if(!Array.isArray(state.queue))state.queue=[];
state.queue=state.queue.map(String);


function saveGameSession(){
  if(!state.active){sessionRemove(GAME_SESSION_KEY);return;}
  sessionSet(GAME_SESSION_KEY,{
    version:4,active:state.active,names:state.names,scores:state.scores,target:state.target,
    round:state.round,starter:state.starter,turn:state.turn,currentId:state.current?.id||null,
    currentSource:state.currentSource,bid:state.bid,bidder:state.bidder,challenger:state.challenger,
    proposal:state.proposal,accepted:state.accepted,seen:[...state.seen],phase:state.phase,
    roundResult:state.roundResult,bidHistory:state.bidHistory,gameHistory:state.gameHistory
  });
}
function renderRestoredPhase(){
  if(!state.active||!state.current)return false;
  show('setup',false);show('game',true);switchView('desk');
  $('roundLabel').textContent=`ROUND ${state.round}`;$('targetLabel').textContent=`First to ${state.target} points`;
  $('playerSource').textContent=state.currentSource==='queued'?'FROM THE QUEUE':'RANDOM POOL';
  $('footballer').textContent=state.current.name;
  $('footballerMeta').textContent=[state.current.position||'Position unknown',state.current.first_year&&state.current.last_year?`${state.current.first_year}–${state.current.last_year}`:'Career years unavailable',`${state.current.eligible_club_count} valid clubs`].join(' · ');
  $('queueNext').textContent=state.queue.length?`${state.queue.length} queued next`:'';
  $('starter').textContent=`${state.names[state.starter]} opens the bidding`;
  show('noPlayer',false);show('bidding',false);show('challenge',false);show('result',false);show('finished',false);
  $('skipBtn').disabled=false;
  if(state.bid>0&&state.bidder!==null)$('lastBid').innerHTML=`<strong>${safe(state.names[state.bidder])}</strong> bids <strong>${state.bid} club${state.bid===1?'':'s'}</strong>`;
  else $('lastBid').textContent='No bids yet.';
  if(state.phase==='challenge'){
    show('challenge',true);$('challengeTitle').textContent=`${state.names[state.bidder]} must name ${state.bid} clubs`;
    $('challengeHelp').textContent=`${state.names[state.challenger]} challenged. As each correct club is named, click it below. A repeat counts as a mistake.`;
    $('wikiLink').href=state.current.wikipedia_url||'#';renderClubs();
  } else if(state.phase==='result'&&state.roundResult){
    renderRoundResult(state.roundResult.success,state.roundResult.winners,false);
  } else if(state.phase==='finished'){
    const leaders=state.roundResult?.champions||getLeaders();finish(leaders,Boolean(state.roundResult?.early),false);
  } else {show('bidding',true);updateBid();}
  scorebar();return true;
}
function restoreGameSession(){
  const saved=sessionGet(GAME_SESSION_KEY,null);
  if(!saved||!saved.active||!Array.isArray(saved.names)||!Array.isArray(saved.scores))return false;
  const current=saved.currentId?state.byId.get(String(saved.currentId)):null;
  if(saved.currentId&&!current){sessionRemove(GAME_SESSION_KEY);return false;}
  state.active=true;state.names=saved.names;state.scores=saved.scores;state.target=saved.target||10;
  state.round=saved.round||1;state.starter=saved.starter||0;state.turn=saved.turn||0;state.current=current;
  state.currentSource=saved.currentSource||'random';state.bid=saved.bid||0;state.bidder=saved.bidder??null;
  state.challenger=saved.challenger??null;state.proposal=saved.proposal||1;state.accepted=Array.isArray(saved.accepted)?saved.accepted:[];
  state.seen=new Set(Array.isArray(saved.seen)?saved.seen:[]);state.phase=saved.phase||'bidding';state.roundResult=saved.roundResult||null;state.bidHistory=Array.isArray(saved.bidHistory)?saved.bidHistory:[];state.gameHistory=Array.isArray(saved.gameHistory)?saved.gameHistory:[];
  return renderRestoredPhase();
}
function getLeaders(){
  const high=Math.max(...state.scores);return state.names.filter((_,i)=>state.scores[i]===high);
}

function calcMetrics(p) {
  const clubs=Array.isArray(p.eligible_clubs)?p.eligible_clubs:[];
  const spells=Array.isArray(p.raw_spells)?p.raw_spells:[];
  let years=spells.flatMap(s=>[s.start_year,s.end_year]).filter(Number.isInteger);
  if(!years.length)years=clubs.flatMap(c=>[c.first_year,c.last_year]).filter(Number.isInteger);
  const firstYear=years.length?Math.min(...years):null;
  const lastYear=years.length?Math.max(...years):null;
  return {
    ...p,id:String(p.id || p.wikipedia_title || p.name),
    eligible_clubs:clubs,eligible_club_count:clubs.length,
    first_year:firstYear,last_year:lastYear,
    career_years:firstYear!==null && lastYear!==null?lastYear-firstYear+1:null,
    senior_appearances:clubs.reduce((n,c)=>n+(Number(c.league_appearances)||0),0),
    pl_appearances:Number.isInteger(p.pl_appearances)?p.pl_appearances:null,
    searchName:norm(p.name),searchClubs:norm(clubs.map(c=>c.name).join(' | '))
  };
}
function queueValid(){state.queue=state.queue.filter((id,i,all)=>state.byId.has(String(id)) && all.indexOf(id)===i);storageSet('mba_queue_v3',state.queue);}
async function loadDatabase(path='./data/players.json',demonstration=false){
  try{
    const response=await fetch(path,{cache:'no-cache'});
    if(!response.ok)throw new Error('HTTP '+response.status);
    const data=await response.json();
    if(!Array.isArray(data.players))throw new Error('Missing players array');
    state.database=data.players.map(calcMetrics);
    state.byId=new Map(state.database.map(p=>[p.id,p]));
    state.ready=true;state.isDemo=demonstration || data.generated_at==='sample';
    state.hasPL=state.database.some(p=>p.pl_appearances!==null);
    if(!state.hasPL){state.pool.rank='senior';state.pool.minPL=null;}
    if(state.isDemo){state.pool={...PRESETS.all};}
    queueValid();
    $('datasetStatus').textContent=`${fmt(state.database.length)} footballers loaded${state.isDemo?' — FICTIONAL DEMO DATA, not real footballers':''}.`;
    $('startBtn').disabled=!state.database.some(p=>p.eligible_club_count>=3);
    show('demoBtn',false);
    const plOption=$('poolRank').querySelector('option[value="pl"]');
    plOption.disabled=!state.hasPL;
    $('poolMinPL').disabled=!state.hasPL;
    $('poolMinPL').placeholder=state.hasPL?'Optional':'PL statistics not imported';
    applyPoolInputs();renderQueue();updatePoolPreview();searchExplorer();restoreGameSession();
    if(state.isDemo)toast('Fictional demo loaded. Copy your scraped players.json into data/ for the real game.');
  }catch(err){
    state.ready=false;$('startBtn').disabled=true;
    $('datasetStatus').textContent='Could not load data/players.json ('+err.message+'). Copy your existing scraped file into data/, then refresh; or try the demo.';
    show('demoBtn',true);
  }
}
$('demoBtn').addEventListener('click',()=>loadDatabase('./data/players.demo.json',true));

function positionMatches(position,filter){
  if(!filter)return true;
  const pos=norm(position);
  const synonyms={defender:/defend|back|sweeper/,midfielder:/midfield|winger/,forward:/forward|striker|winger|attack/,striker:/striker|forward|centre forward/,goalkeeper:/goalkeep|keeper/,winger:/winger|wide midfield|outside forward/};
  return (synonyms[filter]||new RegExp(filter)).test(pos);
}
function getPool() {
  const q=state.pool;
  let players=state.database.filter(p=>{
    if(p.eligible_club_count<q.minClubs || p.senior_appearances<q.minApps)return false;
    if(!positionMatches(p.position,q.position))return false;
    if(q.yearFrom!==null && (p.last_year===null || p.last_year<q.yearFrom))return false;
    if(q.yearTo!==null && (p.first_year===null || p.first_year>q.yearTo))return false;
    if(q.minPL!==null && (p.pl_appearances===null || p.pl_appearances<q.minPL))return false;
    if(q.rank==='pl' && p.pl_appearances===null)return false;
    return true;
  });
  players.sort((a,b)=>((q.rank==='pl'?b.pl_appearances:b.senior_appearances)-(q.rank==='pl'?a.pl_appearances:a.senior_appearances)) || a.name.localeCompare(b.name));
  return q.top>0?players.slice(0,q.top):players;
}
function applyPoolInputs(){
  const q=state.pool;
  const values={poolRank:q.rank,poolTop:q.top,poolMinApps:q.minApps,poolMinPL:q.minPL,poolMinClubs:q.minClubs,poolPosition:q.position,poolYearFrom:q.yearFrom,poolYearTo:q.yearTo};
  Object.entries(values).forEach(([id,v])=>$(id).value=v===null?'':String(v));
  document.querySelectorAll('[data-preset]').forEach(b=>b.classList.toggle('active',Object.keys(PRESETS[b.dataset.preset]).every(k=>PRESETS[b.dataset.preset][k]===q[k])));
}
function readPoolInputs(){
  state.pool={top:Math.max(0,num($('poolTop').value)||0),minApps:Math.max(0,num($('poolMinApps').value)||0),minPL:num($('poolMinPL').value),minClubs:Math.max(2,num($('poolMinClubs').value)||2),position:$('poolPosition').value,yearFrom:num($('poolYearFrom').value),yearTo:num($('poolYearTo').value),rank:$('poolRank').value};
  storageSet('mba_pool_v3',state.pool);
  applyPoolInputs();updatePoolPreview();
}
function updatePoolPreview(){
  const q=state.pool;
  if(!state.ready){$('poolCount').textContent='—';$('deskPoolSummary').textContent='Loading footballers…';return;}
  const pool=getPool();const metric=q.rank==='pl'?'verified PL appearances':'senior league appearances';
  $('poolCount').textContent=fmt(pool.length)+' eligible';
  $('poolNote').textContent=`Random draws from ${q.top?'top '+fmt(q.top):'all'} matching by ${metric}. ${q.minApps} minimum senior league appearances; ${q.minClubs}+ clubs.${pool.length?'':' Try loosening your filters.'}`;
  $('deskPoolSummary').textContent=`${fmt(pool.length)} potential random picks · ${q.top?'Top '+fmt(q.top):'All'} by ${metric}`;
  $('deskQueuePreview').textContent=state.queue.length?state.queue.slice(0,3).map(id=>state.byId.get(id)?.name||'Unknown').join(' → ')+(state.queue.length>3?` · +${state.queue.length-3} more`:''):'Queue empty — random pool will be used.';
}
Object.entries(PRESETS).forEach(([key,preset])=>document.querySelector(`[data-preset="${key}"]`).addEventListener('click',()=>{state.pool={...preset};storageSet('mba_pool_v3',state.pool);applyPoolInputs();updatePoolPreview();}));
['poolRank','poolTop','poolMinApps','poolMinPL','poolMinClubs','poolPosition','poolYearFrom','poolYearTo'].forEach(id=>$(id).addEventListener('input',readPoolInputs));

function saveQueue(){storageSet('mba_queue_v3',state.queue);renderQueue();updatePoolPreview();if(state.active)saveGameSession();}
function addQueue(id,front=false){
  id=String(id);if(!state.byId.has(id))return toast('That player is not in the loaded database.');
  const was=state.queue.includes(id);
  if(was){if(!front)return toast('Already queued. Use “Play next” to move them up.');state.queue=state.queue.filter(x=>x!==id);}
  if(front)state.queue.unshift(id);else state.queue.push(id);
  saveQueue();toast(`${state.byId.get(id).name} ${front?'will play next':'added to the queue'}.`);
}
function renderQueue(){
  $('queueBadge').textContent=state.queue.length;
  $('queueItems').innerHTML=state.queue.length?state.queue.map((id,i)=>{
    const p=state.byId.get(id);if(!p)return '';
    return `<div class="queue-entry"><span class="queue-num">${i+1}</span><div><strong>${safe(p.name)}</strong><small>${safe(p.position||'Position unknown')} · ${p.eligible_club_count} clubs</small></div><div class="queue-controls"><button data-action="up" data-index="${i}" ${i===0?'disabled':''} title="Move up" aria-label="Move ${safe(p.name)} up">↑</button><button data-action="down" data-index="${i}" ${i===state.queue.length-1?'disabled':''} title="Move down" aria-label="Move ${safe(p.name)} down">↓</button><button data-action="remove" data-index="${i}" title="Remove" aria-label="Remove ${safe(p.name)}">✕</button></div></div>`;
  }).join(''):'<p class="muted">Nothing queued. Use Player Explorer or quick search to prepare the next few rounds.</p>';
}
$('queueItems').addEventListener('click',event=>{
  const b=event.target.closest('button[data-action]');if(!b)return;
  const i=Number(b.dataset.index),action=b.dataset.action;
  if(action==='remove')state.queue.splice(i,1);
  if(action==='up' && i>0)[state.queue[i-1],state.queue[i]]=[state.queue[i],state.queue[i-1]];
  if(action==='down' && i<state.queue.length-1)[state.queue[i+1],state.queue[i]]=[state.queue[i],state.queue[i+1]];
  saveQueue();
});
$('clearQueue').addEventListener('click',()=>{if(state.queue.length && confirm('Clear every player in the queue?')){state.queue=[];saveQueue();}});
function quickSearch(){
  const query=norm($('queueSearch').value.trim());
  if(query.length<2 || !state.ready){$('quickResults').innerHTML='';return;}
  const hits=state.database.filter(p=>p.searchName.includes(query)||p.searchClubs.includes(query)).sort((a,b)=>b.senior_appearances-a.senior_appearances).slice(0,8);
  $('quickResults').innerHTML=hits.length?hits.map(p=>`<div class="quick-entry"><div><strong>${safe(p.name)}</strong><small>${fmt(p.senior_appearances)} senior league apps · ${p.eligible_club_count} clubs</small></div><div class="actions"><button type="button" class="small" data-enqueue="${safe(p.id)}">+ Queue</button><button type="button" class="small primary" data-front="${safe(p.id)}">Play next ↑</button></div></div>`).join(''):'<p class="muted">No matches.</p>';
}
$('queueSearch').addEventListener('input',quickSearch);
$('quickResults').addEventListener('click',event=>{const target=event.target.closest('button');if(!target)return;if(target.dataset.enqueue)addQueue(target.dataset.enqueue);if(target.dataset.front)addQueue(target.dataset.front,true);});

let view='desk';
function switchView(next){
  view=next;
  show('deskView',next==='desk');show('explorerView',next==='explorer');show('poolView',next==='pool');
  ['desk','explorer','pool'].forEach(name=>$(name+'Tab').classList.toggle('active',name===next));
  if(next==='explorer')searchExplorer();if(next==='pool'){renderQueue();updatePoolPreview();}
  window.scrollTo({top:0,behavior:'smooth'});
}
['desk','explorer','pool'].forEach(name=>$(name+'Tab').addEventListener('click',()=>switchView(name)));
document.querySelectorAll('[data-open-pool]').forEach(b=>b.addEventListener('click',()=>switchView('pool')));
$('browseExplorer').addEventListener('click',()=>switchView('explorer'));
$('backToDesk').addEventListener('click',()=>switchView('desk'));

function scorebar(){
  $('scorebar').innerHTML=state.names.map((name,i)=>`<div class="score-chip ${state.bidder===null && i===state.turn && !$('bidding').classList.contains('hidden')?'active':''}"><span>${safe(name)}</span><strong>${state.scores[i]}</strong></div>`).join('');
}
function nextCandidate(avoidId=null){
  while(state.queue.length){
    const id=state.queue.shift();saveQueue();const p=state.byId.get(id);
    if(p && p.eligible_club_count>=1 && id!==avoidId)return {player:p,source:'queued'};
  }
  const pool=getPool();if(!pool.length)return null;
  let unseen=pool.filter(p=>!state.seen.has(p.id) && p.id!==avoidId);
  if(!unseen.length){ // Recycle only when necessary, never return a freshly skipped player.
    pool.forEach(p=>state.seen.delete(p.id));
    unseen=pool.filter(p=>p.id!==avoidId);
    if(!unseen.length)return null;
    toast('Everyone in this pool has appeared; starting a fresh cycle.');
  }
  return {player:unseen[Math.floor(Math.random()*unseen.length)],source:'random'};
}
function resetBids(){state.bid=0;state.bidder=null;state.challenger=null;state.proposal=1;state.accepted=[];state.turn=state.starter;state.phase='bidding';state.roundResult=null;state.bidHistory=[];}
function drawRoundPlayer(avoidId=null){
  resetBids();
  show('challenge',false);show('result',false);show('finished',false);
  $('lastBid').textContent='No bids yet.';
  const next=nextCandidate(avoidId);
  if(!next){
    state.current=null;show('bidding',false);show('noPlayer',true);$('footballer').textContent='No matching player';$('footballerMeta').textContent='Adjust the pool or queue a footballer.';$('playerSource').textContent='NO MATCH';$('starter').textContent='No points awarded.';$('skipBtn').disabled=true;saveGameSession();return;
  }
  state.current=next.player;state.currentSource=next.source;
  state.seen.add(state.current.id);
  show('noPlayer',false);show('bidding',true);$('skipBtn').disabled=false;
  $('playerSource').textContent=next.source==='queued'?'FROM THE QUEUE':'RANDOM POOL';
  $('footballer').textContent=state.current.name;
  $('footballerMeta').textContent=[state.current.position||'Position unknown',state.current.first_year&&state.current.last_year?`${state.current.first_year}–${state.current.last_year}`:'Career years unavailable',`${state.current.eligible_club_count} valid clubs`].join(' · ');
  $('queueNext').textContent=state.queue.length?`${state.queue.length} queued next`:'';
  $('starter').textContent=`${state.names[state.starter]} opens the bidding`;
  updateBid();saveGameSession();
}
function startRound(){state.round+=1;state.starter=(state.round-1)%state.names.length;$('roundLabel').textContent=`ROUND ${state.round}`;$('targetLabel').textContent=`First to ${state.target} points`;drawRoundPlayer();scorebar();}
$('addPlayerBtn').addEventListener('click',()=>{
  const list=$('playerNameList');
  if(list.children.length>=6)return;
  const row=document.createElement('div');
  row.className='player-name-row';
  row.innerHTML='<span class="player-number" aria-hidden="true"></span><input class="player-name-input" type="text" maxlength="32" autocomplete="off"><button class="remove-player" type="button">×</button>';
  list.appendChild(row);
  updatePlayerNameControls();
  const input=row.querySelector('input');
  input.focus();
  input.select();
});
$('playerNameList').addEventListener('click',event=>{
  const removeButton=event.target.closest('.remove-player');
  const list=$('playerNameList');
  if(!removeButton||list.children.length<=2)return;
  removeButton.closest('.player-name-row').remove();
  updatePlayerNameControls();
});
function updatePlayerNameControls(){
  const rows=[...$('playerNameList').querySelectorAll('.player-name-row')];
  rows.forEach((row,index)=>{
    const number=String(index+1).padStart(2,'0');
    const input=row.querySelector('input');
    const removeButton=row.querySelector('.remove-player');
    row.querySelector('.player-number').textContent=number;
    input.setAttribute('aria-label',`Player ${index+1} name`);
    removeButton.disabled=rows.length<=2;
    removeButton.setAttribute('aria-label',`Remove player ${index+1}`);
    removeButton.title=`Remove player ${index+1}`;
  });
  $('playerNameCount').textContent=`${rows.length} of 6 players`;
  $('addPlayerBtn').disabled=rows.length>=6;
}
updatePlayerNameControls();
$('startBtn').addEventListener('click',()=>{
  const names=[...$('playerNameList').querySelectorAll('.player-name-input')].map(input=>input.value.trim()).filter(Boolean);
  const target=Number($('targetPoints').value);
  if(names.length<2 || names.length>6)return alert('Enter between 2 and 6 player names.');
  if(new Set(names.map(norm)).size!==names.length)return alert('Player names must be different.');
  if(!Number.isInteger(target)||target<1||target>100)return alert('Set a target between 1 and 100 points.');
  if(!state.ready)return alert('Load your database first.');
  state.active=true;state.names=names;state.scores=names.map(()=>0);state.target=target;state.round=0;state.seen=new Set();state.phase='bidding';state.roundResult=null;state.bidHistory=[];state.gameHistory=[];
  show('setup',false);show('game',true);switchView('desk');startRound();
});
function updateBid(){
  const max=state.current?.eligible_club_count||0;
  const canRaise=state.bid<max;
  if(canRaise)state.proposal=Math.min(max,Math.max(state.bid+1,state.proposal));
  else state.proposal=max;
  $('bidNumber').textContent=state.proposal;
  const limitEl=$('bidLimit');
  if(limitEl)limitEl.textContent=max?`Maximum possible bid: ${max} club${max===1?'':'s'}.`:'';
  $('turn').textContent=`${state.names[state.turn]}'s turn`;
  $('challengeBtn').disabled=state.bid===0;
  $('challengeBtn').textContent=state.bid?`Challenge ${state.names[state.bidder]}`:'Call their bluff';
  $('plus').disabled=!canRaise||state.proposal>=max;
  $('minus').disabled=!canRaise||state.proposal<=state.bid+1;
  $('bidBtn').disabled=!canRaise||state.proposal<=state.bid||state.proposal>max;
  if(!canRaise&&state.bid>0)$('turn').textContent=`${state.names[state.turn]}'s turn — maximum bid reached`;
  scorebar();saveGameSession();
}
$('minus').addEventListener('click',()=>{state.proposal=Math.max(state.bid+1,state.proposal-1);updateBid();});
$('plus').addEventListener('click',()=>{const max=state.current?.eligible_club_count||0;state.proposal=Math.min(max,state.proposal+1);updateBid();});
$('bidBtn').addEventListener('click',()=>{
  if(state.proposal<=state.bid || !state.current || state.proposal>state.current.eligible_club_count)return;
  state.bid=state.proposal;state.bidder=state.turn;state.bidHistory.push({playerIndex:state.bidder,player:state.names[state.bidder],bid:state.bid,at:new Date().toISOString()});
  $('lastBid').innerHTML=`<strong>${safe(state.names[state.bidder])}</strong> bids <strong>${state.bid} club${state.bid===1?'':'s'}</strong>`;
  state.turn=(state.turn+1)%state.names.length;state.proposal=state.bid+1;updateBid();
});
$('challengeBtn').addEventListener('click',()=>{
  if(state.bidder===null)return;
  state.challenger=state.turn;state.phase='challenge';show('bidding',false);show('challenge',true);
  $('challengeTitle').textContent=`${state.names[state.bidder]} must name ${state.bid} clubs`;
  $('challengeHelp').textContent=`${state.names[state.challenger]} challenged. As each correct club is named, click it below. A repeat counts as a mistake.`;
  $('wikiLink').href=state.current.wikipedia_url||'#';$('clubSearch').value='';renderClubs();saveGameSession();$('clubSearch').focus();
});
function renderClubs(){
  if(!state.current)return;
  const filter=norm($('clubSearch').value.trim());
  const clubs=state.current.eligible_clubs.map((c,index)=>({...c,index})).sort((a,b)=>a.name.localeCompare(b.name));
  const filtered=clubs.filter(c=>norm(c.name).includes(filter));
  $('clubTiles').innerHTML=filtered.length?filtered.map(c=>{
    const ticked=state.accepted.includes(c.index);
    return `<button type="button" class="club-tile ${ticked?'ticked':''}" data-club="${c.index}" ${ticked?'disabled':''} aria-label="${ticked?'Already named: ':'Accept club: '}${safe(c.name)}"><strong>${ticked?'✓ ':''}${safe(c.name)}</strong><small>${c.first_year||'?'}–${c.last_year||'?'} · ${fmt(c.league_appearances)} league apps${c.loan_spells?' · loan':''}</small></button>`;
  }).join(''):'<p class="muted">No matching valid club. If they said something else, press Wrong club.</p>';
  $('progressFill').style.width=`${state.bid?100*state.accepted.length/state.bid:0}%`;
  $('progressText').textContent=`${state.accepted.length} / ${state.bid} clubs accepted`;
  $('namedClubs').innerHTML=state.accepted.length?state.accepted.map((index,i)=>`<span class="accepted">✓ ${i+1}. ${safe(state.current.eligible_clubs[index].name)}</span>`).join(''):'None yet.';
  $('undoBtn').disabled=state.accepted.length===0;
}
$('clubSearch').addEventListener('input',renderClubs);
$('clubTiles').addEventListener('click',event=>{
  const button=event.target.closest('button[data-club]');if(!button || !state.current)return;
  const index=Number(button.dataset.club);
  if(state.accepted.includes(index))return;
  state.accepted.push(index);$('clubSearch').value='';renderClubs();saveGameSession();
  if(state.accepted.length===state.bid)endRound(true);
});
$('undoBtn').addEventListener('click',()=>{state.accepted.pop();renderClubs();saveGameSession();});
$('wrongBtn').addEventListener('click',()=>{if(confirm(`Mark ${state.names[state.bidder]}'s bid incorrect? Everyone else receives 1 point.`))endRound(false);});
$('skipBtn').addEventListener('click',()=>{
  if(!state.current)return;
  if((state.bid>0 || !$('challenge').classList.contains('hidden')) && !confirm('Skip this footballer? The current bidding is cancelled and nobody scores.'))return;
  const skipped=state.current.id;drawRoundPlayer(skipped);toast('Player skipped — same round and opening bidder, no points awarded.');
});
$('drawAgain').addEventListener('click',drawRoundPlayer);
function renderRoundResult(success,winners,awardPoints=true){
  show('challenge',false);show('bidding',false);show('result',true);$('skipBtn').disabled=true;
  if(awardPoints)winners.forEach(i=>state.scores[i]++);
  $('resultBanner').className='result-banner '+(success?'correct':'wrong');
  $('resultBanner').textContent=success?`${state.names[state.bidder]} nailed it!`:`BIDDY AUNT! ${state.names[state.bidder]} failed.`;
  $('resultExplanation').textContent=success?`${state.bid} clubs correctly named. ${state.names[state.bidder]} gets 1 point.`:`${state.accepted.length} correct club(s) before the mistake. Every other player receives 1 point.`;
  $('roundAwards').innerHTML=winners.map(i=>`<span class="award">+1 ${safe(state.names[i])}</span>`).join('');
  $('allAnswers').innerHTML=state.current.eligible_clubs.map(c=>`<div class="answer-row"><strong>${safe(c.name)}</strong><small>${c.first_year||'?'}–${c.last_year||'?'} · ${fmt(c.league_appearances)} apps</small></div>`).join('');
  const champions=state.names.filter((_,i)=>state.scores[i]>=state.target);
  $('nextBtn').textContent=champions.length?'See final scores →':'Next round →';
  $('nextBtn').onclick=()=>champions.length?finish(champions,false):startRound();
  scorebar();
}
function endRound(success){
  const winners=state.names.map((_,i)=>i).filter(i=>success?i===state.bidder:i!==state.bidder);
  state.phase='result';state.roundResult={success,winners};state.gameHistory.push({round:state.round,footballerId:state.current?.id||null,footballer:state.current?.name||null,source:state.currentSource,bids:[...state.bidHistory],bid:state.bid,bidderIndex:state.bidder,bidder:state.bidder===null?null:state.names[state.bidder],challengerIndex:state.challenger,challenger:state.challenger===null?null:state.names[state.challenger],acceptedClubs:state.accepted.map(i=>state.current?.eligible_clubs?.[i]?.name).filter(Boolean),success,winnerIndexes:winners,winners:winners.map(i=>state.names[i]),scoresAfter:state.scores.map((score,i)=>score+(winners.includes(i)?1:0)),at:new Date().toISOString()});
  renderRoundResult(success,winners,true);saveGameSession();
}
function finish(champions,early=false,persist=true){
  state.phase='finished';state.roundResult={...(state.roundResult||{}),champions,early};
  show('bidding',false);show('challenge',false);show('result',false);show('finished',true);$('skipBtn').disabled=true;
  $('winnerTitle').textContent=champions.length===1?`${champions[0]} ${early?'leads at full time':'wins'}!`:`${early?'Leaders':'Joint winners'}: ${champions.join(' & ')}`;
  $('winnerDesc').textContent=`${early?'Game ended early. ':'Target: '+state.target+'. '}${state.names.map((n,i)=>`${n}: ${state.scores[i]}`).join(' · ')}`;
  if(persist)saveGameSession();
}
$('endGameBtn').addEventListener('click',()=>{
  if(!state.active)return;
  if(!confirm('End the game now? The current scores will be final.'))return;
  finish(getLeaders(),true);
});
$('restartBtn').addEventListener('click',()=>{state.active=false;state.names=[];state.current=null;state.round=0;state.phase='setup';state.roundResult=null;state.bidHistory=[];state.gameHistory=[];sessionRemove(GAME_SESSION_KEY);show('game',false);show('setup',true);$('skipBtn').disabled=true;switchView('desk');});

/* The Explorer deliberately uses the same loaded database and queue as the desk. */
function explorerFilter(){
  const name=norm($('searchName').value.trim()),club=norm($('searchClub').value.trim());
  const position=$('searchPosition').value,from=num($('yearFrom').value),to=num($('yearTo').value);
  const minApps=num($('minApps').value),maxApps=num($('maxApps').value),minClubs=num($('minClubs').value);
  const field={appearances:'senior_appearances',pl_appearances:'pl_appearances',first_year:'first_year',last_year:'last_year',career_years:'career_years',clubs:'eligible_club_count',name:'name'}[$('sortPlayers').value]||'senior_appearances';
  const desc=$('sortOrder').value==='desc';
  return state.database.filter(p=>{
    if(name&&!p.searchName.includes(name))return false;
    if(club&&!p.searchClubs.includes(club))return false;
    if(!positionMatches(p.position,position))return false;
    if(from!==null&&(p.last_year===null||p.last_year<from))return false;
    if(to!==null&&(p.first_year===null||p.first_year>to))return false;
    if(minApps!==null&&p.senior_appearances<minApps)return false;
    if(maxApps!==null&&p.senior_appearances>maxApps)return false;
    if(minClubs!==null&&p.eligible_club_count<minClubs)return false;
    return true;
  }).sort((a,b)=>{
    const x=a[field],y=b[field];
    if(x==null||y==null)return x==null?(y==null?0:1):-1;
    const cmp=field==='name'?x.localeCompare(y):x-y;
    return (desc?-cmp:cmp)||a.name.localeCompare(b.name);
  });
}
function searchExplorer(){
  if(!state.ready){$('explorerCount').textContent='Load the player database first.';return;}
  const results=explorerFilter(),pages=Math.max(1,Math.ceil(results.length/25));
  state.explorerPage=Math.max(1,Math.min(state.explorerPage,pages));
  const page=results.slice((state.explorerPage-1)*25,state.explorerPage*25);
  $('explorerCount').textContent=`${fmt(results.length)} matching players. ${state.hasPL?'Some records include separate PL appearance figures.':'PL-only appearance figures have not been imported; senior apps cover all qualifying clubs.'}`;
  $('playerRows').innerHTML=page.length?page.map(p=>`<tr><td><button class="text-button" data-detail="${safe(p.id)}">${safe(p.name)}</button><div class="mini-clubs">${safe(p.eligible_clubs.map(c=>c.name).join(' · '))}</div></td><td>${safe(p.position||'—')}</td><td>${p.first_year||'?'}–${p.last_year||'?'}</td><td>${fmt(p.senior_appearances)}</td><td>${p.pl_appearances===null?'—':fmt(p.pl_appearances)}</td><td>${p.eligible_club_count}</td><td><button type="button" class="table-button primary" data-queue="${safe(p.id)}">+ Queue</button></td></tr>`).join(''):'<tr><td colspan="7">No results. Try widening your filters.</td></tr>';
  $('pageLabel').textContent=`Page ${state.explorerPage} / ${pages}`;
  $('prevPage').disabled=state.explorerPage<=1;$('nextPage').disabled=state.explorerPage>=pages;
}
$('playerRows').addEventListener('click',event=>{
  const b=event.target.closest('button');if(!b)return;
  if(b.dataset.queue)addQueue(b.dataset.queue);if(b.dataset.detail)openDetail(b.dataset.detail);
});
function openDetail(id){
  const p=state.byId.get(id);if(!p)return;
  state.selectedDetail=p;show('playerDetail',true);
  $('detailName').textContent=p.name;
  $('detailMeta').textContent=`${p.position||'Unknown position'} · ${p.first_year||'?'}–${p.last_year||'?'} · ${fmt(p.senior_appearances)} senior league appearances · ${p.eligible_club_count} qualifying clubs`;
  $('detailClubs').innerHTML=p.eligible_clubs.map(c=>`<div class="answer-row"><strong>${safe(c.name)}</strong><small>${c.first_year||'?'}–${c.last_year||'?'} · ${fmt(c.league_appearances)} senior apps${c.loan_spells?' · loan spell':''}</small></div>`).join('');
  $('detailWiki').href=p.wikipedia_url||'#';$('pickConfirmation').textContent='';
  $('playerDetail').scrollIntoView({behavior:'smooth',block:'start'});
}
$('queuePlayer').addEventListener('click',()=>{if(state.selectedDetail){addQueue(state.selectedDetail.id);$('pickConfirmation').textContent='Player queued for a future round.';}});
$('queueNextPlayer').addEventListener('click',()=>{if(state.selectedDetail){addQueue(state.selectedDetail.id,true);$('pickConfirmation').textContent='Player will be used in the next round/draw.';}});
$('applyFilters').addEventListener('click',()=>{state.explorerPage=1;searchExplorer();});
$('resetFilters').addEventListener('click',()=>{['searchName','searchClub','searchPosition','yearFrom','yearTo','minApps','maxApps','minClubs'].forEach(id=>$(id).value='');$('sortPlayers').value='appearances';$('sortOrder').value='desc';state.explorerPage=1;searchExplorer();});
$('prevPage').addEventListener('click',()=>{state.explorerPage--;searchExplorer();});
$('nextPage').addEventListener('click',()=>{state.explorerPage++;searchExplorer();});
['searchName','searchClub'].forEach(id=>$(id).addEventListener('input',()=>{state.explorerPage=1;searchExplorer();}));
['searchPosition','yearFrom','yearTo','minApps','maxApps','minClubs','sortPlayers','sortOrder'].forEach(id=>$(id).addEventListener('change',()=>{state.explorerPage=1;searchExplorer();}));

applyPoolInputs();renderQueue();loadDatabase();

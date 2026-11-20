import { createHash } from 'node:crypto';
import type { GroupBy, Report, Row } from './report.js';

/**
 * `report --web`: an interactive, self-contained HTML report opened from a local file.
 * Everything is inline (styles, data, script); the page's CSP forbids any network request,
 * so it renders with Wi-Fi off and uploads nothing. The only outbound things are links a
 * person chooses to click (the team sign-up, "Post on X").
 */

export const HTML_CTA_URL = 'https://app.spendbyteam.com/register?src=cli&cmp=html';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Compact row tuple for the embedded data: [key, cost, requests, sessions, tokens, [in, out, cw, cr], topModel, startedAt, project, startedBefore]. */
function pack(row: Row): unknown[] {
  return [
    row.key,
    Math.round(row.cost * 10000) / 10000,
    row.requests,
    row.sessions,
    row.tokens,
    [row.split.input, row.split.output, row.split.cacheWrite, row.split.cacheRead],
    row.topModel.replace(/^claude-/, ''),
    row.startedAt ?? null,
    row.project ?? null,
    row.startedBeforeWindow ? 1 : 0,
  ];
}

export function reportData(r: Report, opts: { version?: string; generatedAt?: Date } = {}) {
  const views = r.views ?? ({ [r.by]: r.rows } as Partial<Record<GroupBy, Row[]>>);
  return {
    from: r.from,
    to: r.to,
    by: r.by,
    generated: (opts.generatedAt ?? new Date()).toISOString(),
    version: opts.version ?? null,
    total: r.total,
    retention: r.retention ?? null,
    unpriced: r.unpriced,
    views: Object.fromEntries(Object.entries(views).map(([k, rows]) => [k, (rows ?? []).map(pack)])),
  };
}

const STYLE = `:root{color-scheme:light;--bg:#f6f6f4;--card:#fcfcfb;--ink:#0b0b0b;--ink2:#52514e;--ink3:#8a8984;--rule:#e6e5e0;--grid:#ecebe7;--accent:#6250d6;--accent-soft:#eceaff;--warn:#fff6e0;--warnb:#efd9a3;
--s1:#2a78d6;--s2:#eb6834;--s3:#1baf7a;--s4:#eda100;--s5:#e87ba4;--other:#b9b8b2}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#111110;--card:#1a1a19;--ink:#f0efec;--ink2:#c3c2b7;--ink3:#8f8e86;--rule:#2c2c2a;--grid:#262624;--accent:#9085e9;--accent-soft:#25213f;--warn:#2a2413;--warnb:#5b4b1e;
--s1:#3987e5;--s2:#d95926;--s3:#199e70;--s4:#c98500;--s5:#d55181;--other:#5d5c57}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:1120px;margin:0 auto;padding:28px 16px 56px}
.num{font-variant-numeric:tabular-nums}
header.top{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-end;justify-content:space-between;margin-bottom:20px}
h1{font-size:1.4rem;letter-spacing:-.01em;margin:0}
.sub{color:var(--ink2);margin:4px 0 0;font-size:.88rem}
.actions{display:flex;gap:8px;flex-wrap:wrap;position:relative}
button,.btn{font:inherit;font-weight:600;font-size:.85rem;border-radius:999px;padding:8px 14px;border:1px solid var(--rule);background:var(--card);color:var(--ink);cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:6px}
button:hover{border-color:var(--ink3)}
.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.menu{position:absolute;right:0;top:42px;background:var(--card);border:1px solid var(--rule);border-radius:12px;padding:6px;min-width:200px;box-shadow:0 8px 24px rgba(0,0,0,.12);z-index:5;display:none}
.menu.open{display:block}
.menu button{width:100%;border:0;border-radius:8px;justify-content:flex-start;font-weight:500}
.menu button:hover{background:var(--bg)}
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--ink);color:var(--bg);padding:8px 14px;border-radius:999px;font-size:.85rem;opacity:0;transition:opacity .2s;pointer-events:none}
.toast.show{opacity:1}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:14px}
.kpi{background:var(--card);border:1px solid var(--rule);border-radius:14px;padding:14px 16px;min-width:0}
.kpi .v{font-size:1.45rem;font-weight:650;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kpi .l{color:var(--ink2);font-size:.78rem}
.kpi .h{color:var(--ink3);font-size:.75rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.note{background:var(--warn);border:1px solid var(--warnb);border-radius:12px;padding:10px 14px;margin-bottom:14px;font-size:.87rem}
.grid2{display:grid;grid-template-columns:2fr 1fr;gap:10px;margin-bottom:14px}
@media (max-width:820px){.grid2{grid-template-columns:1fr}}
.panel{background:var(--card);border:1px solid var(--rule);border-radius:16px;padding:16px;min-width:0}
.panel h2{font-size:.82rem;text-transform:uppercase;letter-spacing:.05em;color:var(--ink2);margin:0 0 12px;font-weight:650}
.chart{position:relative}
.chart svg{display:block;width:100%;height:auto;overflow:visible}
.tip{position:absolute;pointer-events:none;background:var(--ink);color:var(--bg);font-size:.78rem;padding:6px 9px;border-radius:8px;white-space:nowrap;transform:translate(-50%,-110%);display:none;z-index:3}
.stack{display:flex;height:14px;border-radius:4px;overflow:hidden;gap:2px;margin:6px 0 12px}
.stack span{display:block;height:100%}
.legend{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.legend li{display:grid;grid-template-columns:10px 1fr auto auto;gap:8px;align-items:center;font-size:.84rem}
.legend i{width:10px;height:10px;border-radius:3px;display:block}
.legend .p{color:var(--ink3);min-width:38px;text-align:right}
.tabs{display:flex;gap:4px;flex-wrap:wrap;border-bottom:1px solid var(--rule);margin:-4px -4px 12px;padding:0 4px}
.tabs button{border:0;border-radius:0;background:none;padding:10px 12px;color:var(--ink2);border-bottom:2px solid transparent;margin-bottom:-1px}
.tabs button[aria-selected=true]{color:var(--ink);border-bottom-color:var(--accent)}
.tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
.tools input{font:inherit;flex:1;min-width:180px;padding:8px 12px;border:1px solid var(--rule);border-radius:999px;background:var(--bg);color:var(--ink)}
.tools .count{color:var(--ink3);font-size:.82rem}
.tablewrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;table-layout:fixed}
th,td{padding:9px 10px;border-bottom:1px solid var(--rule);text-align:left;vertical-align:middle}
th{font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;color:var(--ink2);font-weight:650;cursor:pointer;user-select:none;white-space:nowrap}
th.n,td.n{text-align:right}
th[aria-sort=ascending]::after{content:" ↑"}th[aria-sort=descending]::after{content:" ↓"}
td.k{overflow:hidden}
td.k .t{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
td.k small{display:block;color:var(--ink3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bar{height:4px;background:var(--accent-soft);border-radius:2px;margin-top:5px}
.bar span{display:block;height:100%;background:var(--accent);border-radius:2px}
tfoot td{font-weight:650;border-top:2px solid var(--ink);border-bottom:0}
.pager{display:flex;gap:8px;align-items:center;justify-content:flex-end;margin-top:10px;color:var(--ink2);font-size:.84rem}
.pager button[disabled]{opacity:.4;cursor:default}
.cta{margin-top:14px;display:flex;flex-wrap:wrap;gap:16px;align-items:center;justify-content:space-between;background:var(--accent-soft);border:1px solid var(--rule);border-radius:16px;padding:18px 20px}
.cta p{margin:0;max-width:640px}.cta p span{color:var(--ink2)}
footer{color:var(--ink3);font-size:.78rem;margin-top:18px}footer a{color:inherit}
code{font:.85em ui-monospace,SFMono-Regular,Menlo,monospace}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
@media print{
  @page{margin:12mm}
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  :root{color-scheme:light;--bg:#fff;--card:#fff;--ink:#000;--ink2:#2b2b2b;--ink3:#4a4a4a;--rule:#cfcfcf;--grid:#e3e3e3;--accent:#5a46d0;--accent-soft:#e6e2ff;--warn:#fff6e0;--warnb:#e2c47c;
    --s1:#2a78d6;--s2:#eb6834;--s3:#1baf7a;--s4:#eda100;--s5:#e87ba4;--other:#9a9993}
  body{background:#fff;color:#000;font-size:10.5pt}
  main{padding:0;max-width:none}
  .no-print,.tools,.pager,.tabs,.menu,.tip,.toast,.cta .btn{display:none!important}
  .panel,.kpi,.cta,.note{break-inside:avoid;border-color:var(--rule)}
  .kpi{padding:10px 12px}.kpi .v{font-size:15pt}.kpi .l{font-size:8.5pt}.kpi .h{font-size:8pt;white-space:normal}
  .grid2{grid-template-columns:2fr 1fr}
  .panel h2{color:#000}
  .legend li{font-size:9pt}
  table{table-layout:fixed;width:100%}
  th:first-child{width:44%}
  .tablewrap{overflow:visible}
  thead{display:table-header-group}tfoot{display:table-row-group}
  tr{break-inside:avoid}
  th{font-size:8pt;color:#000;padding:6px 8px}
  td{padding:4px 8px;font-size:9pt;line-height:1.3}
  td.k .bar{height:3px;margin-top:2px}
  .panel{padding:12px}
  .print-title{display:block!important;font-size:10pt;font-weight:650;color:#000;margin:0 0 8px}
  .cta{background:#fff}
}
.print-title{display:none}
`;

const BODY = (cta: string) => `<main>
  <header class="top">
    <div>
      <h1>Claude Code spend on this machine</h1>
      <p class="sub" id="sub"></p>
    </div>
    <div class="actions no-print">
      <button type="button" id="pdf" title="Opens the print dialog; choose “Save as PDF”">Save as PDF</button>
      <button type="button" id="names" aria-pressed="false">Hide names</button>
      <button type="button" id="csv">Export CSV</button>
      <button type="button" id="share" aria-haspopup="true" aria-expanded="false">Share ▾</button>
      <div class="menu" id="menu" role="menu">
        <button type="button" role="menuitem" data-share="copy">Copy summary</button>
        <button type="button" role="menuitem" data-share="x">Post on X</button>
      </div>
      <a class="btn primary" href="${cta}">See it for your team</a>
    </div>
  </header>

  <section class="kpis" id="kpis" aria-label="Summary"></section>
  <div id="note"></div>

  <div class="grid2">
    <section class="panel">
      <h2>Cost per day</h2>
      <div class="chart" id="daily"><div class="tip" id="tip"></div></div>
    </section>
    <section class="panel">
      <h2>By model</h2>
      <div id="models"></div>
      <h2 style="margin-top:18px">Where the tokens went</h2>
      <div id="mix"></div>
    </section>
  </div>

  <section class="panel">
    <p class="print-title" id="ptitle"></p>
    <div class="tabs" role="tablist" id="tabs"></div>
    <div class="tools">
      <input type="search" id="q" placeholder="Filter…" aria-label="Filter rows">
      <span class="count num" id="count"></span>
    </div>
    <div class="tablewrap"><table class="num" id="tbl"><thead></thead><tbody></tbody><tfoot></tfoot></table></div>
    <div class="pager" id="pager"></div>
  </section>

  <section class="cta">
    <p><strong>This is one machine.</strong><br><span>See it for your whole team, per project and client, with budgets, alerts and client-ready PDF reports. Free for up to 3 developers.</span></p>
    <a class="btn primary" href="${cta}">See it for your team</a>
  </section>
  <footer id="foot"></footer>
  <div class="toast" id="toast" role="status"></div>
</main>`;

/** The report UI as one function of the data. Shared by the local file and the web page. */
const APP = `function render(D){
const $=id=>document.getElementById(id);
const el=(tag,attrs,kids)=>{const e=document.createElement(tag);for(const k in attrs||{}){if(k==='text')e.textContent=attrs[k];else if(k==='style')e.style.cssText=attrs[k];else e.setAttribute(k,attrs[k]);}(kids||[]).forEach(c=>c&&e.appendChild(c));return e;};
const usd=n=>'$'+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const usd0=n=>n>=1000?'$'+Math.round(n).toLocaleString('en-US'):usd(n);
const cmp=n=>n>=1e9?(n/1e9).toFixed(1)+'B':n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(1)+'K':String(n);
const pct=x=>(x*100>=10?Math.round(x*100):(x*100).toFixed(1))+'%';
const NAMES={project:'Projects',model:'Models',agent:'Agents',branch:'Branches',day:'Days',session:'Sessions'};
const ONE={project:'Project',model:'Model',agent:'Agent',branch:'Branch',day:'Day',session:'Session'};
const V=D.views, T=D.total;
const row=a=>({key:a[0],cost:a[1],requests:a[2],sessions:a[3],tokens:a[4],split:a[5],model:a[6],started:a[7],project:a[8],before:a[9]});
const views={};for(const k in V)views[k]=V[k].map(row);
/* Names: shown by default; "Hide names" swaps projects, branches and subagent types for Project 1, Branch 2, Agent 3… (by cost).
   Shared text (summary, post on X) always uses the hidden names. */
let hideNames=false;
const ALIAS={project:new Map(),branch:new Map(),agent:new Map()};const AL={project:'Project',branch:'Branch',agent:'Agent'};
/* Custom subagent names can say as much as a project name; the main session needs no alias. */
['project','branch','agent'].forEach(k=>(views[k]||[]).filter(r=>!(k==='agent'&&r.key==='Main session')).sort((a,b)=>b.cost-a.cost).forEach((r,i)=>ALIAS[k].set(r.key,AL[k]+' '+(i+1))));
const aliasOf=(k,name)=>ALIAS[k].get(name)||(k==='agent'&&name==='Main session'?name:AL[k]);
const nm=(k,name,force)=>(hideNames||force)&&AL[k]?aliasOf(k,name):name;

/* ---- header + KPIs ---- */
const dayCount=D.from?Math.round((Date.parse(D.to)-Date.parse(D.from))/864e5)+1:0;
$('sub').textContent=(D.from?D.from+' → '+D.to+' · '+dayCount+' days':'No usage found')+' · at API list prices. On a Pro, Max or Team seat you pay a flat fee; this is what the same tokens would cost on the API.';
$('ptitle').textContent='Claude Code spend · '+(D.from?D.from+' → '+D.to:'');
const sum=(rows,i)=>rows.reduce((n,r)=>n+r.split[i],0);
const all=views.model||views[D.by]||[];
const inTok=sum(all,0),outTok=sum(all,1),cw=sum(all,2),cr=sum(all,3);
const cacheShare=(inTok+cw+cr)>0?cr/(inTok+cw+cr):0;
const top=(k)=>(views[k]||[]).slice().sort((a,b)=>b.cost-a.cost)[0];
const tp=top('project'),tm=top('model');
const activeDays=(views.day||[]).filter(r=>r.cost>0).length;
const kpis=[
  [usd0(T.cost),'Total cost',D.from?usd(T.cost/Math.max(1,dayCount))+' a day'+(views.day?' · '+activeDays+' of '+dayCount+' days active':''):''],
  [String(T.sessions),'Sessions',T.sessions?usd(T.cost/T.sessions)+' per session':''],
  [cmp(T.tokens),'Tokens',T.requests.toLocaleString('en-US')+' requests'],
  [pct(cacheShare),'Read from cache','of input-side tokens'],
  [tp?pct(tp.cost/T.cost):'–','Top project',tp?{project:tp.key}:''],
  [tm?pct(tm.cost/T.cost):'–','Top model',tm?tm.key.replace(/^claude-/,''):''],
];
function drawKpis(){$('kpis').replaceChildren();kpis.forEach(([v,l,h0])=>{const h=h0&&h0.project!==undefined?nm('project',h0.project):h0;$('kpis').appendChild(el('div',{class:'kpi'},[el('div',{class:'v num',text:v,title:v}),el('div',{class:'l',text:l}),el('div',{class:'h',text:h,title:h})]));});}
drawKpis();

if(D.mode==='web'){const a=el('aside',{class:'note'});a.appendChild(el('strong',{text:'Nothing is stored. '}));a.appendChild(document.createTextNode('These numbers came in the link (after #, which never reaches a server) and were removed from the address bar. Close or reload and they are gone. Use “Hide names” before a screenshot or PDF; shared text always hides them.'));$('note').appendChild(a);}
const R=D.retention;
if(R&&R.days<=90){const a=el('aside',{class:'note'});a.appendChild(el('strong',{text:'Heads-up: '}));
a.appendChild(document.createTextNode('Claude Code deletes these logs after '+R.days+' days ('+(R.source==='default'?'by default':R.source==='managed'?'set by your organization':'set in your settings.json')+')'+(R.oldestLog?', so the oldest log left on this machine is from '+R.oldestLog:'')+'.'));
if(R.source!=='managed'){a.appendChild(document.createTextNode(' To keep them, add '));a.appendChild(el('code',{text:'"cleanupPeriodDays": 3650'}));a.appendChild(document.createTextNode(' to '));a.appendChild(el('code',{text:'~/.claude/settings.json'}));a.appendChild(document.createTextNode('.'));}
$('note').appendChild(a);}

/* ---- daily chart (inline SVG, one series, hover tooltip) ---- */
(function(){
  const box=$('daily');
  if(!views.day||!D.from){box.appendChild(el('p',{class:'sub',text:'No daily data.'}));return;}
  const byDay=new Map(views.day.map(r=>[r.key,r]));
  const days=[];for(let t=Date.parse(D.from);t<=Date.parse(D.to);t+=864e5){const k=new Date(t).toISOString().slice(0,10);days.push({k,r:byDay.get(k)});}
  const W=640,H=250,L=48,B=24,TP=8,n=days.length,max=Math.max(1,...days.map(d=>d.r?d.r.cost:0));
  const step=niceStep(max/3),top=Math.ceil(max/step)*step,bw=(W-L)/n,gap=Math.min(2,bw*.25);
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 '+W+' '+H);svg.setAttribute('role','img');
  svg.setAttribute('aria-label','Cost per day, '+D.from+' to '+D.to+'; highest '+usd(max));
  const S=(t,a)=>{const e=document.createElementNS(ns,t);for(const k in a)e.setAttribute(k,a[k]);return e;};
  const y=v=>TP+(H-B-TP)*(1-v/top);
  for(let v=0;v<=top+1e-9;v+=step){svg.appendChild(S('line',{x1:L,x2:W,y1:y(v),y2:y(v),stroke:'var(--grid)','stroke-width':1}));const t=S('text',{x:L-8,y:y(v)+4,'text-anchor':'end','font-size':11,fill:'var(--ink3)'});t.textContent='$'+Math.round(v).toLocaleString('en-US');svg.appendChild(t);}
  const every=Math.ceil(n/8);
  days.forEach((d,i)=>{const x=L+i*bw,c=d.r?d.r.cost:0,h=(H-B-TP)*(c/top);
    if(c>0){const w=Math.max(1,bw-gap),r=Math.min(4,w/2,h);
      svg.appendChild(S('path',{d:'M'+(x+gap/2)+','+(H-B)+'v'+(-(h-r))+'q0,'+(-r)+' '+r+','+(-r)+'h'+(w-2*r)+'q'+r+',0 '+r+','+r+'v'+(h-r)+'z',fill:'var(--accent)'}));}
    if(i%every===0){const t=S('text',{x:x+bw/2,y:H-6,'text-anchor':'middle','font-size':11,fill:'var(--ink3)'});t.textContent=d.k.slice(5);svg.appendChild(t);}
    const hit=S('rect',{x:x,y:TP,width:bw,height:H-B-TP,fill:'transparent'});
    hit.addEventListener('mousemove',ev=>{const tip=$('tip'),rb=box.getBoundingClientRect();tip.textContent=d.k+' · '+usd(c)+(d.r?' · '+d.r.sessions+' sessions':'');tip.style.display='block';tip.style.left=(ev.clientX-rb.left)+'px';tip.style.top=(ev.clientY-rb.top)+'px';});
    hit.addEventListener('mouseleave',()=>{$('tip').style.display='none';});
    svg.appendChild(hit);});
  box.appendChild(svg);
  function niceStep(x){const p=Math.pow(10,Math.floor(Math.log10(x||1))),m=x/p;return (m<=1?1:m<=2?2:m<=5?5:10)*p;}
})();

/* ---- model share + token mix (100% stacks, legend always shown) ---- */
const COLORS=['var(--s1)','var(--s2)','var(--s3)','var(--s4)','var(--s5)'];
function stack(target,items){
  const tot=items.reduce((n,i)=>n+i.v,0)||1,bar=el('div',{class:'stack',role:'img','aria-label':items.map(i=>i.label+' '+pct(i.v/tot)).join(', ')}),ul=el('ul',{class:'legend'});
  items.forEach(i=>{if(i.v<=0)return;bar.appendChild(el('span',{style:'flex:'+i.v+' 0 0;background:'+i.c,title:i.label+' · '+pct(i.v/tot)}));
    ul.appendChild(el('li',{},[el('i',{style:'background:'+i.c}),el('span',{text:i.label}),el('span',{class:'num',text:i.fmt(i.v)}),el('span',{class:'p num',text:pct(i.v/tot)})]));});
  target.appendChild(bar);target.appendChild(ul);
}
(function(){
  const m=(views.model||[]).slice().sort((a,b)=>b.cost-a.cost),head=m.slice(0,4),rest=m.slice(4);
  const items=head.map((r,i)=>({label:r.key.replace(/^claude-/,''),v:r.cost,c:COLORS[i],fmt:usd0}));
  if(rest.length)items.push({label:'Other ('+rest.length+')',v:rest.reduce((n,r)=>n+r.cost,0),c:'var(--other)',fmt:usd0});
  stack($('models'),items);
  stack($('mix'),[{label:'Cache reads',v:cr,c:COLORS[0],fmt:cmp},{label:'Cache writes',v:cw,c:COLORS[1],fmt:cmp},{label:'Input',v:inTok,c:COLORS[2],fmt:cmp},{label:'Output',v:outTok,c:COLORS[3],fmt:cmp}]);
})();

/* ---- table: tabs, filter, sort, pagination ---- */
const PAGE=25,PRINT_ROWS=40;let tab=V[D.by]?D.by:Object.keys(V)[0],q='',sortK='cost',sortDir=-1,page=0,printing=false;
const COLS={
  default:[['key','',0],['cost','Cost',1],['share','Share',1],['sessions','Sessions',1],['tokens','Tokens',1],['model','Model',0]],
  session:[['started','Started',0],['cost','Cost',1],['requests','Turns',1],['tokens','Tokens',1],['cache','Cache read',1],['model','Model',0]],
};
const cols=()=>tab==='session'?COLS.session:COLS.default;
Object.keys(NAMES).filter(k=>V[k]).forEach(k=>{const b=el('button',{type:'button',role:'tab','aria-selected':String(k===tab),text:NAMES[k]+' ('+((D.counts&&D.counts[k])||V[k].length)+')'});b.onclick=()=>{tab=k;page=0;q='';$('q').value='';sortK=k==='day'?'key':'cost';sortDir=k==='day'?1:-1;[...$('tabs').children].forEach(c=>c.setAttribute('aria-selected',String(c===b)));draw();};$('tabs').appendChild(b);});
$('q').addEventListener('input',e=>{q=e.target.value.trim().toLowerCase();page=0;draw();});
const val=(r,k)=>k==='share'?r.cost:k==='cache'?r.split[3]/Math.max(1,r.split[0]+r.split[2]+r.split[3]):k==='started'?(r.started||''):r[k];
function rowsNow(){
  let rows=views[tab]||[];
  if(q)rows=rows.filter(r=>(nm(tab,r.key)+' '+(r.project?nm('project',r.project):'')+' '+r.model).toLowerCase().includes(q));
  return rows.slice().sort((a,b)=>{const x=val(a,sortK),y=val(b,sortK);return (typeof x==='string'?x.localeCompare(y):x-y)*sortDir;});
}
function draw(){
  const tbl=$('tbl'),C=cols(),rows=rowsNow(),pages=Math.max(1,Math.ceil(rows.length/PAGE));page=Math.min(page,pages-1);
  const shown=printing?rows.slice(0,PRINT_ROWS):rows.slice(page*PAGE,page*PAGE+PAGE);
  const head=el('tr');C.forEach(([k,label,num],i)=>{const th=el('th',{class:num?'n':'',text:i===0&&!label?ONE[tab]:label,style:i===0?'width:44%':''});if(k===sortK)th.setAttribute('aria-sort',sortDir>0?'ascending':'descending');th.onclick=()=>{if(sortK===k)sortDir=-sortDir;else{sortK=k;sortDir=num?-1:1;}draw();};head.appendChild(th);});
  tbl.tHead.replaceChildren(head);
  const body=document.createDocumentFragment(),max=Math.max(...(views[tab]||[]).map(r=>r.cost),1e-9);
  shown.forEach(r=>{const tr=el('tr');C.forEach(([k,,num],i)=>{let td;
    if(i===0){td=el('td',{class:'k'});const label=tab==='session'?(r.before?'≤ ':'')+(r.started||'').slice(0,16).replace('T',' '):nm(tab,r.key);td.appendChild(el('span',{class:'t',text:label,title:label}));if(tab==='session'&&r.project){const pn=nm('project',r.project);td.appendChild(el('small',{text:pn,title:pn}));}td.appendChild(el('div',{class:'bar'},[el('span',{style:'width:'+Math.max(.5,r.cost/max*100).toFixed(1)+'%'})]));}
    else{const v=k==='cost'?usd(r.cost):k==='share'?pct(T.cost?r.cost/T.cost:0):k==='tokens'?cmp(r.tokens):k==='cache'?pct(val(r,'cache')):k==='model'?(tab==='model'?'':r.model):String(r[k]);td=el('td',{class:num?'n':'',text:v});}
    tr.appendChild(td);});body.appendChild(tr);});
  if(printing&&rows.length>PRINT_ROWS){const rest=rows.slice(PRINT_ROWS),rc=rest.reduce((n,r)=>n+r.cost,0);
    body.appendChild(el('tr',{},[el('td',{class:'k',text:'… '+rest.length+' more '+NAMES[tab].toLowerCase()}),el('td',{class:'n',text:usd(rc)}),el('td',{class:'n',text:tab==='session'?'':pct(T.cost?rc/T.cost:0)}),el('td'),el('td'),el('td')]));}
  if(!shown.length)body.appendChild(el('tr',{},[el('td',{colspan:'6',text:q?'No rows match “'+q+'”.':'No data.'})]));
  tbl.tBodies[0].replaceChildren(body);
  const fc=rows.reduce((n,r)=>n+r.cost,0),ft=rows.reduce((n,r)=>n+r.tokens,0);
  const cells=tab==='session'
    ?[q?'Filtered total':'Total',usd(fc),String(rows.reduce((n,r)=>n+r.requests,0)),cmp(ft),'','']
    :[q?'Filtered total':'Total',usd(fc),pct(T.cost?fc/T.cost:0),q?'':String(T.sessions),cmp(ft),''];
  const f=el('tr',{},cells.map((t,i)=>el('td',{class:i&&i<5?'n':'',text:t})));
  tbl.tFoot.replaceChildren(f);
  const full=(D.counts&&D.counts[tab])||(views[tab]||[]).length;
  $('count').textContent=rows.length+' of '+(views[tab]||[]).length+' '+NAMES[tab].toLowerCase()+(full>(views[tab]||[]).length?' (top '+(views[tab]||[]).length+' of '+full+' in this link)':'');
  const pg=$('pager');pg.replaceChildren();
  if(rows.length>PAGE){const prev=el('button',{type:'button',text:'← Prev'}),next=el('button',{type:'button',text:'Next →'});prev.disabled=page===0;next.disabled=page>=pages-1;prev.onclick=()=>{page--;draw();};next.onclick=()=>{page++;draw();};
    pg.appendChild(el('span',{class:'num',text:(page*PAGE+1)+'–'+Math.min(rows.length,(page+1)*PAGE)+' of '+rows.length}));pg.appendChild(prev);pg.appendChild(next);}
}
draw();

/* ---- PDF, CSV, share ---- */
window.addEventListener('beforeprint',()=>{printing=true;draw();});
window.addEventListener('afterprint',()=>{printing=false;draw();});
$('pdf').onclick=()=>window.print();
$('csv').onclick=()=>{const C=cols(),q2=s=>'"'+String(s).replace(/"/g,'""')+'"';
  const lines=[[ONE[tab],'Cost USD','Requests','Sessions','Tokens','Input','Output','Cache write','Cache read','Model'].map(q2).join(',')].concat(rowsNow().map(r=>[tab==='session'?r.started:nm(tab,r.key),r.cost.toFixed(4),r.requests,r.sessions,r.tokens,...r.split,r.model].map(q2).join(',')));
  const a=el('a',{href:URL.createObjectURL(new Blob([lines.join('\\n')],{type:'text/csv'})),download:'claude-code-'+tab+'-'+(D.to||'report')+'.csv'});document.body.appendChild(a);a.click();a.remove();toast('CSV saved');};
const menu=$('menu');$('share').onclick=e=>{e.stopPropagation();const o=menu.classList.toggle('open');$('share').setAttribute('aria-expanded',String(o));};
document.addEventListener('click',()=>{menu.classList.remove('open');$('share').setAttribute('aria-expanded','false');});
function summary(){const tops=(views.project||[]).slice().sort((a,b)=>b.cost-a.cost).slice(0,3).map(r=>'- '+nm('project',r.key,true)+': '+usd(r.cost)).join('\\n');
  return 'My Claude Code usage, '+D.from+' → '+D.to+': '+usd(T.cost)+' at API prices, '+T.sessions+' sessions, '+cmp(T.tokens)+' tokens ('+pct(cacheShare)+' from cache).'+(tops?'\\nTop projects:\\n'+tops:'')+'\\n\\nMeasured offline with npx spendbyteam report';}
menu.addEventListener('click',e=>{const k=e.target.getAttribute('data-share');if(!k)return;
  if(k==='copy'){navigator.clipboard.writeText(summary()).then(()=>toast('Summary copied'),()=>toast('Copy failed'));}
  if(k==='x'){const t='My Claude Code usage over '+dayCount+' days: '+usd(T.cost)+' at API prices, '+T.sessions+' sessions, '+pct(cacheShare)+' read from cache.\\n\\nMeasured offline with npx spendbyteam report';window.open('https://x.com/intent/post?text='+encodeURIComponent(t),'_blank','noopener');}});
function toast(t){const e=$('toast');e.textContent=t;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),1600);}

$('names').onclick=()=>{hideNames=!hideNames;$('names').setAttribute('aria-pressed',String(hideNames));$('names').textContent=hideNames?'Show names':'Hide names';drawKpis();draw();};
const f=$('foot');
if(D.mode==='web'){f.appendChild(document.createTextNode('Made with '));f.appendChild(el('code',{text:'npx spendbyteam report'}));f.appendChild(document.createTextNode(' on '+D.generated.slice(0,16).replace('T',' ')+' UTC. The numbers travel in the part of the link after #, which browsers never send to a server, so nothing was stored; reloading or closing this page discards them. '));}
else{f.appendChild(document.createTextNode('Generated on this machine by '));f.appendChild(el('code',{text:'npx spendbyteam report'+(D.version?' '+D.version:'')}));f.appendChild(document.createTextNode(' at '+D.generated.slice(0,16).replace('T',' ')+' UTC. Nothing was uploaded; this page makes no network requests. '));}
f.appendChild(el('a',{href:'https://github.com/spendbyteam/cli',text:'Source'}));
}`;

const LOCAL_CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:";

export function renderHtml(r: Report, opts: { version?: string; generatedAt?: Date } = {}): string {
  const data = JSON.stringify({ ...reportData(r, opts), mode: 'local' }).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const range = r.from ? `${r.from} → ${r.to}` : 'no usage found';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${LOCAL_CSP}">
<title>Claude Code spend · ${esc(range)}</title>
<style>
${STYLE}</style>
</head>
<body>
${BODY(HTML_CTA_URL)}
<script id="data" type="application/json">${data}</script>
<script>
${APP}
render(JSON.parse(document.getElementById('data').textContent));
</script>
</body>
</html>
`;
}

/* ------------------------------------------------------------------------------------------
 * Web view: spendbyteam.com/report#d=…
 * The numbers ride in the URL fragment, which browsers never send to a server, so the site
 * stores nothing. The page drops the fragment from the address bar as soon as it has read it,
 * so a reload or a copied URL shows nothing. Names can be hidden on the page (Hide names);
 * shared text always hides them.
 * ---------------------------------------------------------------------------------------- */

export const WEB_REPORT_URL = 'https://spendbyteam.com/report';
export const WEB_CTA_URL = 'https://app.spendbyteam.com/register?src=cli&cmp=web';
const WEB_MAX_ROWS = 150;

/** The link that opens this report on spendbyteam.com, with the numbers in its fragment (never sent to the server). */
export function webReportUrl(r: Report, opts: { generatedAt?: Date; deflate: (s: string) => Buffer }): string {
  const d = { ...reportData(r, { generatedAt: opts.generatedAt }), mode: 'web' };
  const counts = Object.fromEntries(Object.entries(d.views).map(([k, rows]) => [k, rows.length]));
  d.views = Object.fromEntries(Object.entries(d.views).map(([k, rows]) => [k, rows.slice(0, WEB_MAX_ROWS)]));
  return `${WEB_REPORT_URL}#d=${opts.deflate(JSON.stringify({ ...d, counts })).toString('base64url')}`;
}

const WEB_BOOT = `(async function(){
  var m=location.hash.match(/^#d=([A-Za-z0-9_-]+)$/);
  if(location.hash)history.replaceState(null,'',location.pathname);
  var empty=document.getElementById('empty'),app=document.getElementById('app');
  if(!m){empty.hidden=false;return;}
  try{
    var b=m[1].replace(/-/g,'+').replace(/_/g,'/');while(b.length%4)b+='=';
    var bin=atob(b),bytes=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
    var txt=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
    var D=JSON.parse(txt);if(!D||D.mode!=='web'||typeof D.views!=='object')throw new Error('bad');
    app.hidden=false;render(D);
  }catch(e){app.hidden=true;empty.hidden=false;}
})();`;

/** The static page served at spendbyteam.com/report (HTML + its script; the site's CSP forbids inline scripts). */
export function webShell(): { html: string; js: string } {
  const js = `// Generated from cli/src/html.ts (npm run web-shell). Do not edit by hand.\n${APP}\n${WEB_BOOT}\n`;
  // Cloudflare caches .js for hours; a content hash in the URL makes every change a new URL.
  const v = createHash('sha256').update(js).digest('hex').slice(0, 10);
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="referrer" content="no-referrer">
<title>Claude Code spend · SpendByTeam</title>
<style>
${STYLE}#empty{max-width:560px;margin:15vh auto;padding:0 16px;text-align:center}#empty h1{margin-bottom:8px}
</style>
</head>
<body>
<div id="empty" hidden>
  <h1>Nothing to show</h1>
  <p class="sub">This page shows a Claude Code cost report made with <code>npx spendbyteam report</code>, once. The numbers live only in the link and are discarded when you reload or close the page; nothing is stored on our side.</p>
  <p><a class="btn primary" href="https://github.com/spendbyteam/cli">Get the CLI</a></p>
</div>
<div id="app" hidden>
${BODY(WEB_CTA_URL)}
</div>
<script src="/report.js?v=${v}"></script>
</body>
</html>
`;
  return { html, js };
}

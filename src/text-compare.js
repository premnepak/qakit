// text-compare.js — QAKit v1.0.1
'use strict';
const TC_KEY = 'qakit_text_compare_workspace';
async function tcLoad() { try { const s = await chrome.storage.local.get(TC_KEY); return s[TC_KEY]||{}; } catch { return {}; } }
async function tcSave(p) { try { const c=await tcLoad(); await chrome.storage.local.set({[TC_KEY]:{...c,...p}}); } catch {} }
const esc = s => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

// ── Myers line diff ──────────────────────────────────────────────────
function lineDiff(a,b) {
  const n=a.length,m=b.length,max=n+m;
  if(!max) return [];
  const v={0:0},trace=[];
  for(let d=0;d<=max;d++){
    trace.push({...v});
    for(let k=-d;k<=d;k+=2){
      let x=(k===-d||(k!==d&&(v[k-1]||0)<(v[k+1]||0)))?(v[k+1]||0):(v[k-1]||0)+1;
      let y=x-k;
      while(x<n&&y<m&&a[x]===b[y]){x++;y++;}
      v[k]=x;
      if(x>=n&&y>=m){
        const ops=[];let xx=n,yy=m;
        for(let dd=d;dd>0;dd--){
          const vp=trace[dd];const kk=xx-yy;
          let pk=(kk===-dd||(kk!==dd&&(vp[kk-1]||0)<(vp[kk+1]||0)))?kk+1:kk-1;
          const px=vp[pk]||0,py=px-pk;
          while(xx>px&&yy>py){ops.push(['=',a[xx-1]]);xx--;yy--;}
          if(dd>0){xx===px?(ops.push(['+',b[yy-1]]),yy--):(ops.push(['-',a[xx-1]]),xx--);}
        }
        while(xx>0){ops.push(['=',a[xx-1]]);xx--;yy--;}
        return ops.reverse();
      }
    }
  }
  return [];
}

function wordHL(a,b){
  const aw=a.split(/(\s+)/),bw=b.split(/(\s+)/);
  const ops=lineDiff(aw,bw);
  let ah='',bh='';
  ops.forEach(([t,v])=>{
    const s=esc(v);
    if(t==='='){ah+=s;bh+=s;}
    else if(t==='-') ah+=`<span class="dh-w-del">${s}</span>`;
    else if(t==='+') bh+=`<span class="dh-w-add">${s}</span>`;
  });
  return[ah,bh];
}

// ── State ────────────────────────────────────────────────────────────
let lastFlat=[];
let liveTimer=null;
let isLive=true;
// Multi-line selection
let selectedOps=new Set(); // set of op indices selected

// ── Core compare ─────────────────────────────────────────────────────
function runCompare(){
  const lEl=document.getElementById('tcLeft');
  const rEl=document.getElementById('tcRight');
  const ignWs=document.getElementById('tcIgnoreWs').checked;
  const ignCase=document.getElementById('tcIgnoreCase').checked;
  const whl=document.getElementById('tcWordHl').checked;
  const rawA=lEl.value, rawB=rEl.value;
  if(!rawA.trim()&&!rawB.trim()){clearDiff();document.getElementById('tcStats').textContent='';return;}
  let aLines=rawA.split('\n'), bLines=rawB.split('\n');
  let aCmp=aLines, bCmp=bLines;
  if(ignWs||ignCase){
    const norm=s=>{let v=s;if(ignWs)v=v.replace(/\s+/g,' ').trim();if(ignCase)v=v.toLowerCase();return v;};
    aCmp=aLines.map(norm); bCmp=bLines.map(norm);
  }
  const ops=lineDiff(aCmp,bCmp);
  let aI=0,bI=0;
  const mapped=ops.map(([t])=>{
    if(t==='='){const r=['=',aLines[aI],bLines[bI]];aI++;bI++;return r;}
    if(t==='-'){const r=['-',aLines[aI],''];aI++;return r;}
    const r=['+','',bLines[bI]];bI++;return r;
  });
  const flat=[];let i=0;
  while(i<mapped.length){
    if(mapped[i][0]==='-'&&mapped[i+1]&&mapped[i+1][0]==='+'){
      flat.push(['~',mapped[i][1],mapped[i+1][2]]);i+=2;
    } else {flat.push(mapped[i]);i++;}
  }
  lastFlat=flat;
  selectedOps.clear();
  applyOverlays(flat,whl);
}

function applyOverlays(flat,whl){
  let lHtml='',rHtml='';
  let lLineNums='',rLineNums='';
  let aN=0,bN=0,added=0,removed=0,changed=0;
  const jumps=[];
  const miniMarkers=[];
  const lActionBtns=[];
  const rActionBtns=[];
  let lineIdx=0;

  // First pass: count total output lines for proportional minimap
  let totalLines=0;
  flat.forEach(([t])=>{
    if(t==='='||t==='-'||t==='+') totalLines++;
    else if(t==='~') totalLines++; // change = one line pair
  });

  flat.forEach((op,opIdx)=>{
    const[t,la,rb]=op;
    if(t==='='){
      aN++;bN++;
      lHtml+=`<span>${esc(la)}\n</span>`;
      rHtml+=`<span>${esc(rb)}\n</span>`;
      lLineNums+=aN+'\n'; rLineNums+=bN+'\n';
      lineIdx++;
    } else if(t==='-'){
      aN++;removed++;
      jumps.push({type:'removed',id:'L'+aN,opIdx});
      miniMarkers.push({pct:(lineIdx/Math.max(1,totalLines))*100,type:'removed',opIdx});
      lActionBtns.push({lineIdx,opIdx,dir:'→'});
      lHtml+=`<span class="dh-del" data-op="${opIdx}">${esc(la)}\n</span>`;
      rHtml+=`<span class="dh-eq" style="opacity:.25">\n</span>`;
      lLineNums+=aN+'\n'; rLineNums+='·\n';
      lineIdx++;
    } else if(t==='+'){
      bN++;added++;
      jumps.push({type:'added',id:'R'+bN,opIdx});
      miniMarkers.push({pct:(lineIdx/Math.max(1,totalLines))*100,type:'added',opIdx});
      rActionBtns.push({lineIdx,opIdx,dir:'←'});
      lHtml+=`<span class="dh-eq" style="opacity:.25">\n</span>`;
      rHtml+=`<span class="dh-add" data-op="${opIdx}">${esc(rb)}\n</span>`;
      lLineNums+='·\n'; rLineNums+=bN+'\n';
      lineIdx++;
    } else if(t==='~'){
      aN++;bN++;changed++;
      jumps.push({type:'changed',id:'L'+aN,opIdx});
      miniMarkers.push({pct:(lineIdx/Math.max(1,totalLines))*100,type:'changed',opIdx});
      lActionBtns.push({lineIdx,opIdx,dir:'→'});
      rActionBtns.push({lineIdx,opIdx,dir:'←'});
      let lBody=esc(la),rBody=esc(rb);
      if(whl){const[a,b]=wordHL(la,rb);lBody=a;rBody=b;}
      lHtml+=`<span class="dh-chg-l" data-op="${opIdx}">${lBody}\n</span>`;
      rHtml+=`<span class="dh-chg-r" data-op="${opIdx}">${rBody}\n</span>`;
      lLineNums+=aN+'\n'; rLineNums+=bN+'\n';
      lineIdx++;
    }
  });

  // Apply overlays
  const lOv=document.getElementById('tcLeftOverlay');
  const rOv=document.getElementById('tcRightOverlay');
  const lTa=document.getElementById('tcLeft');
  const rTa=document.getElementById('tcRight');
  if(lOv) lOv.innerHTML=lHtml;
  if(rOv) rOv.innerHTML=rHtml;
  lTa.classList.add('has-diff'); rTa.classList.add('has-diff');
  document.getElementById('tcLeftLines').textContent=lLineNums;
  document.getElementById('tcRightLines').textContent=rLineNums;

  // Render action buttons
  renderActionBtns('tcLeftActions', lActionBtns, 'L');
  renderActionBtns('tcRightActions', rActionBtns, 'R');

  // Minimap
  buildMinimap(miniMarkers, flat.length);

  // Jump strip
  buildJumpStrip(jumps);

  // Stats
  const stats=document.getElementById('tcStats');
  if(added===0&&removed===0&&changed===0){
    stats.innerHTML='<span style="color:#0a6e51">✓ Identical</span>';
  } else {
    stats.innerHTML=`<span class="added">+${added}</span> · <span class="removed">−${removed}</span> · <span class="changed">~${changed}</span>`;
  }
}

// ── Action buttons (copy-right/left per line) ────────────────────────
const LINE_HEIGHT_PX = 20; // 12.5px font × 1.6 lineHeight ≈ 20px
const TEXT_PADDING_TOP = 8;

function renderActionBtns(containerId, btns, side) {
  const col = document.getElementById(containerId);
  if (!col) return;
  col.innerHTML = '';
  col.style.position = 'relative';
  // mirror scroll from the textarea
  const ta = document.getElementById(side==='L' ? 'tcLeft' : 'tcRight');

  btns.forEach(({lineIdx, opIdx, dir}) => {
    const btn = document.createElement('button');
    btn.className = 'tc-action-btn';
    btn.textContent = dir;
    btn.dataset.opIdx = opIdx;
    btn.dataset.selected = '0';
    btn.title = dir === '→' ? 'Copy this line to right pane' : 'Copy this line to left pane';
    btn.style.top = (TEXT_PADDING_TOP + lineIdx * LINE_HEIGHT_PX) + 'px';

    btn.addEventListener('click', (e) => {
      if (e.shiftKey) {
        // Shift+click = multi-select
        if (selectedOps.has(opIdx)) selectedOps.delete(opIdx);
        else selectedOps.add(opIdx);
        btn.dataset.selected = selectedOps.has(opIdx) ? '1' : '0';
        btn.classList.toggle('selected', selectedOps.has(opIdx));
        updateSelectionBar();
      } else {
        // Single click = immediate copy
        selectedOps.clear();
        applyOp(opIdx, dir==='→' ? 'L→R' : 'R→L');
      }
    });
    col.appendChild(btn);
  });

  // Keep action column scroll in sync
  if (ta) {
    ta.addEventListener('scroll', () => {
      col.style.top = '-' + ta.scrollTop + 'px';
    }, { passive: true });
  }
}

// ── Minimap ──────────────────────────────────────────────────────────
function buildMinimap(markers, total) {
  const mm = document.getElementById('tcMinimap');
  if (!mm) return;
  if (!markers.length) { mm.innerHTML = ''; return; }
  mm.innerHTML = markers.map(m =>
    `<div class="tc-mini-tick ${m.type}" data-op="${m.opIdx}" style="top:${m.pct.toFixed(1)}%"></div>`
  ).join('') + '<div class="tc-mini-viewport" id="tcMiniVP"></div>';
  mm.querySelectorAll('.tc-mini-tick').forEach(t => {
    t.addEventListener('click', () => scrollToOp(parseInt(t.dataset.op)));
  });
  updateMiniViewport();
}
function updateMiniViewport() {
  const left = document.getElementById('tcLeft');
  const mm   = document.getElementById('tcMinimap');
  const vp   = document.getElementById('tcMiniVP');
  if (!left || !vp || !mm) return;
  const mmH   = mm.clientHeight;
  const total = left.scrollHeight;
  if (!mmH || total <= left.clientHeight) {
    vp.style.top='0px'; vp.style.height=mmH+'px'; return;
  }
  const topPx    = (left.scrollTop / total) * mmH;
  const heightPx = Math.max(4, (left.clientHeight / total) * mmH);
  vp.style.top    = topPx.toFixed(1) + 'px';
  vp.style.height = heightPx.toFixed(1) + 'px';
}
function scrollToOp(opIdx) {
  const span = document.querySelector(`[data-op="${opIdx}"]`);
  if (span) { span.scrollIntoView({behavior:'smooth',block:'center'}); }
}

// ── Jump strip ───────────────────────────────────────────────────────
function buildJumpStrip(jumps) {
  const strip = document.getElementById('tcJumpStrip');
  const el = document.getElementById('tcJumps');
  if (!jumps.length) { strip.classList.remove('active'); return; }
  strip.classList.add('active');
  el.innerHTML = jumps.slice(0,60).map(j =>
    `<span class="tc-jump ${j.type}" data-op="${j.opIdx}">${j.type==='removed'?'−':j.type==='added'?'+':'~'}${j.id}</span>`
  ).join('') + (jumps.length>60 ? ` <span style="color:#888">+${jumps.length-60} more</span>` : '');
  el.querySelectorAll('.tc-jump').forEach(btn => {
    btn.addEventListener('click', () => scrollToOp(parseInt(btn.dataset.op)));
  });
}

// ── Multi-line selection bar ─────────────────────────────────────────
function updateSelectionBar() {
  const bar = document.getElementById('tcSelectBar');
  const count = document.getElementById('tcSelectCount');
  if (!bar) return;
  if (selectedOps.size === 0) {
    bar.classList.remove('active');
    return;
  }
  bar.classList.add('active');
  count.textContent = selectedOps.size + ' line' + (selectedOps.size>1?'s':'')+' selected';
  // Position near bottom of viewport
  bar.style.bottom = '60px';
  bar.style.left = '50%';
  bar.style.transform = 'translateX(-50%)';
}

// ── Apply a single op copy ────────────────────────────────────────────
function applyOp(opIdx, dir) {
  const op = lastFlat[opIdx];
  if (!op) return;
  const lEl = document.getElementById('tcLeft');
  const rEl = document.getElementById('tcRight');
  let aLines = lEl.value.split('\n');
  let bLines = rEl.value.split('\n');
  // Compute line positions for this opIdx
  let aN=0, bN=0;
  for (let i=0; i<opIdx; i++) {
    const t=lastFlat[i][0];
    if(t==='='||t==='~'){aN++;bN++;}
    else if(t==='-') aN++;
    else if(t==='+') bN++;
  }
  const [t,la,rb] = op;
  if (dir==='L→R') {
    if (t==='-') bLines.splice(bN,0,la);
    else if (t==='~') bLines[bN]=la;
    else if (t==='+') bLines.splice(bN,1);
    rEl.value = bLines.join('\n');
  } else {
    if (t==='+') aLines.splice(aN,0,rb);
    else if (t==='~') aLines[aN]=rb;
    else if (t==='-') aLines.splice(aN,1);
    lEl.value = aLines.join('\n');
  }
  tcSave({ left: lEl.value, right: rEl.value });
  selectedOps.clear();
  document.getElementById('tcSelectBar')?.classList.remove('active');
  runCompare();
}

function applyMultiOps(dir) {
  if (!selectedOps.size) return;
  // Sort indices in reverse so splicing doesn't shift subsequent lines
  const sorted = [...selectedOps].sort((a,b) => dir==='L→R' ? b-a : b-a);
  const lEl = document.getElementById('tcLeft');
  const rEl = document.getElementById('tcRight');
  sorted.forEach(opIdx => {
    const op = lastFlat[opIdx];
    if (!op) return;
    let aLines = lEl.value.split('\n');
    let bLines = rEl.value.split('\n');
    let aN=0, bN=0;
    for (let i=0; i<opIdx; i++) {
      const t=lastFlat[i][0];
      if(t==='='||t==='~'){aN++;bN++;}
      else if(t==='-') aN++;
      else if(t==='+') bN++;
    }
    const [t,la,rb] = op;
    if (dir==='L→R') {
      if (t==='-') bLines.splice(bN,0,la);
      else if (t==='~') bLines[bN]=la;
      else if (t==='+') bLines.splice(bN,1);
      rEl.value = bLines.join('\n');
    } else {
      if (t==='+') aLines.splice(aN,0,rb);
      else if (t==='~') aLines[aN]=rb;
      else if (t==='-') aLines.splice(aN,1);
      lEl.value = aLines.join('\n');
    }
  });
  tcSave({ left: lEl.value, right: rEl.value });
  selectedOps.clear();
  document.getElementById('tcSelectBar')?.classList.remove('active');
  runCompare();
}

function clearDiff(){
  lastFlat=[]; selectedOps.clear();
  ['tcLeftOverlay','tcRightOverlay'].forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML='';});
  ['tcLeft','tcRight'].forEach(id=>{document.getElementById(id)?.classList.remove('has-diff');});
  ['tcLeftLines','tcRightLines'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent='';});
  ['tcLeftActions','tcRightActions'].forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML='';});
  const mm=document.getElementById('tcMinimap');if(mm)mm.innerHTML='';
  document.getElementById('tcJumpStrip')?.classList.remove('active');
  document.getElementById('tcSelectBar')?.classList.remove('active');
}

// ── Splitter ─────────────────────────────────────────────────────────
function setupSplitter(){
  const sp=document.getElementById('tcSplitter');
  const lp=document.getElementById('tcLeftPane');
  const rp=document.getElementById('tcRightPane');
  const body=document.querySelector('.tc-body');
  if(!sp||!lp||!rp||!body) return;
  let drag=false;
  sp.addEventListener('mousedown',e=>{drag=true;sp.classList.add('dragging');document.body.style.cssText='cursor:col-resize;user-select:none';e.preventDefault();});
  document.addEventListener('mousemove',e=>{
    if(!drag) return;
    const rect=body.getBoundingClientRect();
    const ratio=Math.max(15,Math.min(85,((e.clientX-rect.left)/(rect.width-5-14))*100));
    lp.style.flex=ratio+' 1 0'; rp.style.flex=(100-ratio)+' 1 0';
    tcSave({splitRatio:ratio});
  });
  document.addEventListener('mouseup',()=>{if(drag){drag=false;sp.classList.remove('dragging');document.body.style.cssText='';}});
}

// ── Live compare ─────────────────────────────────────────────────────
function scheduleLive(){
  if(!isLive) return;
  clearTimeout(liveTimer);
  liveTimer=setTimeout(()=>{
    const l=document.getElementById('tcLeft').value;
    const r=document.getElementById('tcRight').value;
    if(l.trim()||r.trim()) runCompare(); else clearDiff();
  },300);
}

// ── Init ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded',async()=>{
  const lEl=document.getElementById('tcLeft');
  const rEl=document.getElementById('tcRight');

  lEl.addEventListener('input',()=>{tcSave({left:lEl.value});scheduleLive();});
  rEl.addEventListener('input',()=>{tcSave({right:rEl.value});scheduleLive();});

  // Sync scroll between panes with lock to prevent infinite loop (Fix 56a)
  let scrollLock = false;
  function syncLeft(){
    const ov=document.getElementById('tcLeftOverlay');
    const ln=document.getElementById('tcLeftLines');
    if(ov){ov.scrollTop=lEl.scrollTop;ov.scrollLeft=lEl.scrollLeft;}
    if(ln)ln.scrollTop=lEl.scrollTop;
    if(!scrollLock){scrollLock=true;rEl.scrollTop=lEl.scrollTop;scrollLock=false;}
    updateMiniViewport();
  }
  function syncRight(){
    const ov=document.getElementById('tcRightOverlay');
    const ln=document.getElementById('tcRightLines');
    if(ov){ov.scrollTop=rEl.scrollTop;ov.scrollLeft=rEl.scrollLeft;}
    if(ln)ln.scrollTop=rEl.scrollTop;
    if(!scrollLock){scrollLock=true;lEl.scrollTop=rEl.scrollTop;scrollLock=false;}
    updateMiniViewport();
  }
  lEl.addEventListener('scroll',syncLeft,{passive:true});
  rEl.addEventListener('scroll',syncRight,{passive:true});

  document.getElementById('tcCompare').addEventListener('click',runCompare);
  document.getElementById('tcSwap').addEventListener('click',()=>{
    const tmp=lEl.value; lEl.value=rEl.value; rEl.value=tmp;
    tcSave({left:lEl.value,right:rEl.value});
    if(lastFlat.length) runCompare(); else clearDiff();
  });
  document.getElementById('tcClear').addEventListener('click',()=>{
    lEl.value=''; rEl.value='';
    tcSave({left:'',right:''});
    clearDiff(); document.getElementById('tcStats').textContent='';
  });

  const liveChk=document.getElementById('tcLive');
  liveChk.addEventListener('change',()=>{isLive=liveChk.checked;tcSave({live:isLive});});
  ['tcIgnoreWs','tcIgnoreCase','tcWordHl'].forEach(id=>{
    document.getElementById(id).addEventListener('change',()=>{if(lastFlat.length) runCompare();});
  });

  // Multi-select bar buttons
  document.getElementById('tcSelectCopyRight')?.addEventListener('click', () => applyMultiOps('L→R'));
  document.getElementById('tcSelectCopyLeft')?.addEventListener('click', () => applyMultiOps('R→L'));
  document.getElementById('tcSelectDismiss')?.addEventListener('click', () => {
    selectedOps.clear(); document.getElementById('tcSelectBar')?.classList.remove('active');
    document.querySelectorAll('.tc-action-btn.selected').forEach(b => b.classList.remove('selected'));
  });

  setupSplitter();

  // Restore
  const ws=await tcLoad();
  if(ws.left!=null) lEl.value=ws.left;
  if(ws.right!=null) rEl.value=ws.right;
  if(ws.live!=null){isLive=!!ws.live;liveChk.checked=isLive;}
  if(ws.splitRatio){
    document.getElementById('tcLeftPane').style.flex=ws.splitRatio+' 1 0';
    document.getElementById('tcRightPane').style.flex=(100-ws.splitRatio)+' 1 0';
  }
  if(lEl.value.trim()&&rEl.value.trim()) runCompare();
});

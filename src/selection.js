// Lasso selection module
// Assumes main.js defines global `canvas`, `particles`, and Particle objects with x,y,size,color.
(function(){
  const panel = document.getElementById('selectionPanel');
  const toggleBtn = document.getElementById('toggleSelectionPanel');
  const enableToggle = document.getElementById('enableSelectionToggle');
  const colorInput = document.getElementById('selectionColorInput');
  const clearBtn = document.getElementById('clearSelectionBtn');
  const applyBtn = document.getElementById('applySelectionBtn');
  const selectedCountLabel = document.getElementById('selectedCountLabel');
  if(!panel) return;

  // Ensure lasso is disabled by default on load
  if (enableToggle) enableToggle.checked = false;

  // Draggable behavior
  (function enableDrag(){
    const header = panel.querySelector('.panel-header');
    if(!header) return;
    let drag=false, offsetX=0, offsetY=0;
  const originalMaxHeight = panel.style.maxHeight || '340px';
  let lockedWidth = null; let lockedHeight = null;
    header.addEventListener('mousedown',e=>{
      if(e.target===toggleBtn) return;
      drag=true;
      const r=panel.getBoundingClientRect();
      // Mouse offset inside the panel to keep cursor anchored
      offsetX = e.clientX - r.left; offsetY = e.clientY - r.top;
      document.body.style.userSelect='none';
      // Neutralize centering and conflicting anchors; set explicit position
      panel.style.position = 'fixed';
      panel.style.left = r.left + 'px';
      panel.style.top = r.top + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.style.transform = '';
  // Do not hard lock width/height (fit-content). Keep height to prevent reflow if needed.
  lockedWidth = null; lockedHeight = r.height;
  panel.style.height = Math.round(lockedHeight) + 'px';
    });
    window.addEventListener('mousemove',e=>{
      if(!drag) return;
      // Desired top-left so cursor stays at same spot over the panel
      let nx = e.clientX - (offsetX||0); let ny = e.clientY - (offsetY||0);
      // Clamp within viewport bounds
      const W = window.innerWidth, H = window.innerHeight;
  const w = panel.offsetWidth; const h = panel.offsetHeight;
      nx = Math.max(6, Math.min(nx, W - w - 6));
      ny = Math.max(6, Math.min(ny, H - h - 6));
      panel.style.transform=''; // ensure no residual centering is applied
  panel.style.left= Math.round(nx) + 'px';
  panel.style.top= Math.round(ny) + 'px';
    });
    window.addEventListener('mouseup',()=>{
      if(!drag && lockedWidth===null) return; // nothing to do
      drag=false; document.body.style.userSelect='';
      // Restore sizing constraints
  // Restore sizing constraints
  panel.style.maxHeight = originalMaxHeight;
  panel.style.height = '';
  lockedWidth = lockedHeight = null;
    });
  })();

  toggleBtn?.addEventListener('click',()=>{
    const collapsed = panel.classList.toggle('collapsed');
    toggleBtn.textContent = collapsed ? '+' : '−';
  });

  // Lasso drawing canvas overlay
  const lassoCanvas=document.createElement('canvas');
  lassoCanvas.width=window.innerWidth; lassoCanvas.height=window.innerHeight;
  lassoCanvas.style.position='fixed';
  lassoCanvas.style.top='0'; lassoCanvas.style.left='0';
  lassoCanvas.style.pointerEvents='none';
  lassoCanvas.style.zIndex='12';
  document.body.appendChild(lassoCanvas);
  const lassoCtx=lassoCanvas.getContext('2d');
  window.addEventListener('resize',()=>{ lassoCanvas.width=window.innerWidth; lassoCanvas.height=window.innerHeight; });

  let lassoActive=false;
  let lassoPoints=[]; // {x,y}
  let selectedParticles=new Set();
  let hue=0;
  // Persistent highlight: no timeout; always show selected particles until cleared
  let highlightUntil = Infinity; // kept for API compatibility but unused as a timer
  let pausedBeforeSelection = null; // remember previous pause state
  let isMouseDown = false;
  let downPoint = null;
  const LASSO_MOVE_THRESHOLD = 6; // px movement before starting lasso

  function updatePauseButtonLabel(){
    const btn = document.getElementById('pauseBtn');
    if(!btn) return;
    btn.textContent = (typeof paused !== 'undefined' && paused) ? 'Resume' : 'Pause';
  }
  function disablePauseButton(){ const btn=document.getElementById('pauseBtn'); if(btn){ btn.disabled=true; btn.classList.add('disabled'); } }
  function enablePauseButton(){ const btn=document.getElementById('pauseBtn'); if(btn){ btn.disabled=false; btn.classList.remove('disabled'); } }
  function fullyCancelLassoAndSelection(resume=true){
    lassoActive=false; lassoPoints=[];
    selectedParticles.clear(); updateSelectedCount();
    lassoCtx.clearRect(0,0,lassoCanvas.width,lassoCanvas.height);
    if(resume && pausedBeforeSelection !== null && typeof paused!=='undefined'){
      paused = pausedBeforeSelection; pausedBeforeSelection=null; updatePauseButtonLabel();
    }
    enablePauseButton();
    if(enableToggle && enableToggle.checked){ enableToggle.checked=false; enableToggle.dispatchEvent(new Event('change')); }
  }

  function getCanvasCoords(e){
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function updateSelectedCount(){
    if(selectedCountLabel) selectedCountLabel.textContent='Selected: '+selectedParticles.size;
  }

  function drawLasso(){
    lassoCtx.clearRect(0,0,lassoCanvas.width,lassoCanvas.height);
    // Always draw highlight for current selection
    if(selectedParticles.size && Array.isArray(window.particles)){
      lassoCtx.save();
      lassoCtx.lineWidth = 2;
      lassoCtx.strokeStyle = 'rgba(255,255,255,0.85)';
      lassoCtx.shadowColor = 'rgba(255,255,255,0.6)';
      lassoCtx.shadowBlur = 8;
      for(const p of selectedParticles){
        lassoCtx.beginPath();
        lassoCtx.arc(p.x, p.y, p.size + 3, 0, Math.PI*2);
        lassoCtx.stroke();
      }
      lassoCtx.restore();
    }
    if(!lassoActive || lassoPoints.length<2) { requestAnimationFrame(drawLasso); return; }
    hue = (hue + 2) % 360;
    const grad = lassoCtx.createLinearGradient(0,0,lassoCanvas.width,0);
    for(let i=0;i<=6;i++){
      grad.addColorStop(i/6,`hsl(${(hue + i*60)%360} 100% 55%)`);
    }
    lassoCtx.save();
    lassoCtx.lineWidth=2.5;
    lassoCtx.strokeStyle=grad;
    lassoCtx.fillStyle='rgba(255,255,255,0.04)';
    lassoCtx.shadowColor=`hsl(${hue} 100% 60%)`;
    lassoCtx.shadowBlur=14;
    lassoCtx.beginPath();
  lassoCtx.moveTo(lassoPoints[0].x, lassoPoints[0].y);
  // Thinning points to reduce overdraw
  for(let i=1;i<lassoPoints.length;i+=2) lassoCtx.lineTo(lassoPoints[i].x, lassoPoints[i].y);
    // don't close yet; show open poly while drawing
    lassoCtx.stroke();
    lassoCtx.restore();
    requestAnimationFrame(drawLasso); // animate gradient
  }

  function pointInPoly(px,py,pts){
    // Ray casting
    let inside=false;
    for(let i=0,j=pts.length-1;i<pts.length;j=i++){
      const xi=pts[i].x, yi=pts[i].y;
      const xj=pts[j].x, yj=pts[j].y;
      const intersect=((yi>py)!==(yj>py)) && (px < (xj - xi)*(py - yi)/(yj - yi + 0.0000001) + xi);
      if(intersect) inside=!inside;
    }
    return inside;
  }

  function finalizeSelection(){
    if(lassoPoints.length<3) { lassoPoints=[]; return; }
    const poly = lassoPoints.slice();
    const newly = new Set();
    const source = Array.isArray(window.particles) ? window.particles : [];
    for(const p of source){
      if(pointInPoly(p.x,p.y,poly)) newly.add(p);
    }
  selectedParticles = newly; // replace (no additive logic yet)
  updateSelectedCount();
  }

  function applyColor(){
    const col=colorInput?.value || '#00ffff';
    selectedParticles.forEach(p=>{ p.color=col; });
  }

  // Expose selection API for type system integration
  window.selectionModule = {
    getSelectedParticles: ()=> Array.from(selectedParticles),
    clear: ()=> { selectedParticles.clear(); updateSelectedCount(); },
    applyColor: applyColor,
    onSelectionSummary: updateSelectedCount,
    setSelection: (arr)=>{ selectedParticles = new Set(arr.filter(p=>p)); updateSelectedCount(); }
  };

  canvas.addEventListener('mousedown', e=>{
    if(!enableToggle?.checked) return;
    if(e.button!==0) return; // only left
    const pt = getCanvasCoords(e);
    isMouseDown = true; downPoint = pt; // defer lasso start until movement
    // If currently in lasso, continue adding immediately
    if(lassoActive){ lassoPoints.push(pt); }
  });
  canvas.addEventListener('mousemove', e=>{
    if(!enableToggle?.checked) return;
    const pt = getCanvasCoords(e);
    if(isMouseDown && !lassoActive && downPoint){
      const dx = pt.x - downPoint.x; const dy = pt.y - downPoint.y;
      if(Math.hypot(dx,dy) >= LASSO_MOVE_THRESHOLD){
        // Start lasso now
        lassoActive = true;
        lassoPoints = [downPoint, pt];
        if(pausedBeforeSelection === null) pausedBeforeSelection = (typeof paused!=='undefined'? paused : false);
        if(typeof paused!=='undefined') paused = true;
  disablePauseButton();
        drawLasso();
      }
    } else if(lassoActive){
      lassoPoints.push(pt);
    }
  });
  window.addEventListener('mouseup', e=>{
    if(!enableToggle?.checked) { isMouseDown=false; return; }
    if(e.button!==0) { isMouseDown=false; return; }
    // Simple click (no lasso started) => deselect if empty space
    if(isMouseDown && !lassoActive && downPoint){
      let hit=false;
      const src = Array.isArray(window.particles)? window.particles : [];
      // quick radial check (use particle radius)
      for(let i=0;i<src.length;i++){
        const p = src[i];
        const dx = p.x - downPoint.x; const dy = p.y - downPoint.y;
        const r = p.size + 4;
        if(dx*dx + dy*dy <= r*r){ hit=true; break; }
      }
      if(!hit && selectedParticles.size){
        selectedParticles.clear(); updateSelectedCount(); highlightUntil=0;
      }
    }
    isMouseDown=false; downPoint=null;
  });
  canvas.addEventListener('dblclick', e=>{
    if(!enableToggle?.checked) return;
    if(!lassoActive) return;
    // finalize path
  if(lassoPoints.length>=3){
      // close path visually once
      lassoCtx.save();
      lassoCtx.lineWidth=3;
      lassoCtx.strokeStyle='rgba(255,255,255,0.9)';
      lassoCtx.beginPath();
      lassoCtx.moveTo(lassoPoints[0].x, lassoPoints[0].y);
      for(let i=1;i<lassoPoints.length;i++) lassoCtx.lineTo(lassoPoints[i].x, lassoPoints[i].y);
      lassoCtx.closePath();
      lassoCtx.stroke();
      lassoCtx.restore();
      finalizeSelection();
    }
    lassoActive=false; lassoPoints=[];
  // Do NOT restore pause here; remain paused until Apply is clicked
  });
  clearBtn?.addEventListener('click',()=>{ 
    selectedParticles.clear(); updateSelectedCount(); 
    // keep paused until Apply (design choice). If you want resume on clear, restore paused here.
  });
  applyBtn?.addEventListener('click',()=>{ 
    // If still drawing, finalize first
    if(lassoActive) { finalizeSelection(); lassoActive=false; lassoPoints=[]; }
    if(!selectedParticles.size){
      if(pausedBeforeSelection !== null && typeof paused!=='undefined'){ paused = pausedBeforeSelection; pausedBeforeSelection=null; }
  updatePauseButtonLabel(); enablePauseButton();
  if(enableToggle && enableToggle.checked){ enableToggle.checked=false; enableToggle.dispatchEvent(new Event('change')); }
      return;
    }
    // Create new type automatically
    if(window.typeSystem){
      // Map selected particles to indices
      const all = window.particles||[];
      const map = new Map(); all.forEach((p,i)=>map.set(p,i));
      const idxs=[]; selectedParticles.forEach(p=>{ const i=map.get(p); if(i!==undefined) idxs.push(i); });
      const defaultName = 'Type'+(window.typeSystem.getTypes().length+1);
      const name = prompt('New type name', defaultName) || defaultName;
      // Temporarily create color from selection color input if exists
      const colorInputEl = document.getElementById('selectionColorInput');
      const col = colorInputEl? colorInputEl.value : '#00ffff';
      // Create type manually using internal pattern (simulate newFromSel)
      // We'll call createFromSelection after setting selection to ensure internal logic works
      // Fallback: directly modify via exposed API not available; so replicate minimal logic if needed
      if(typeof window.typeSystem.createFromSelection === 'function'){
        // Temporarily override selection to only chosen particles (already is)
        window.typeSystem.createFromSelection();
        // Rename and recolor active type
        const active = window.typeSystem.getActiveType();
        // Active copy; need underlying DOM values
        const nameInput = document.getElementById('typeNameInput'); if(nameInput) nameInput.value = name;
        const typeColorInput = document.getElementById('typeColorInput'); if(typeColorInput) typeColorInput.value = col;
        const applyTypeBtn = document.getElementById('applyTypeChangesBtn'); applyTypeBtn?.click();
      }
    }
    // Clear selection visuals
    selectedParticles.clear(); updateSelectedCount(); lassoCtx.clearRect(0,0,lassoCanvas.width,lassoCanvas.height);
    // Resume
  if(pausedBeforeSelection !== null && typeof paused!=='undefined') { paused = pausedBeforeSelection; pausedBeforeSelection=null; }
  updatePauseButtonLabel();
  enablePauseButton();
  // Disable lasso tool after type creation
  if(enableToggle){ enableToggle.checked=false; enableToggle.dispatchEvent(new Event('change')); }
  });

  enableToggle?.addEventListener('change',()=>{
    if(!enableToggle.checked){
      // cancel lasso
  lassoActive=false; lassoPoints=[]; lassoCtx.clearRect(0,0,lassoCanvas.width,lassoCanvas.height);
  // keep paused until apply to maintain consistent behavior
      // If no active selection, allow pause button restoration
      if(!selectedParticles.size){ enablePauseButton(); if(pausedBeforeSelection!==null && typeof paused!=='undefined'){ paused = pausedBeforeSelection; pausedBeforeSelection=null; updatePauseButtonLabel(); } }
    }
  });

  // Defensive: if user presses global Pause/Resume during selection (should be disabled) but in case of race
  document.addEventListener('click', (e)=>{
    const btn = document.getElementById('pauseBtn');
    if(!btn) return;
    if(btn.disabled) {
      // Reassert paused state if selection active
      if(lassoActive || selectedParticles.size){ if(typeof paused!=='undefined') paused = true; updatePauseButtonLabel(); }
    }
  }, true);

})();


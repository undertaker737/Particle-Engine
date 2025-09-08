// Particle Type System (enhanced with gravityScale)
(function(){
  if(!window.particles) return;
  const listEl = document.getElementById('typeList');
  const newFromSelBtn = document.getElementById('newTypeFromSelectionBtn');
  const assignSelBtn = document.getElementById('assignSelectionBtn');
  const renameBtn = document.getElementById('renameTypeBtn');
  const deleteBtn = document.getElementById('deleteTypeBtn');
  const nameInput = document.getElementById('typeNameInput');
  const colorInput = document.getElementById('typeColorInput');
  const elastRange = document.getElementById('typeElasticRange');
  const elastValue = document.getElementById('typeElasticValue');
  const gravRange = document.getElementById('typeGravityRange');
  const gravValue = document.getElementById('typeGravityValue');
  const blobToggle = document.getElementById('typeBlobEligibleToggle');
  const applyBtn = document.getElementById('applyTypeChangesBtn');
  const revertBtn = document.getElementById('revertTypeChangesBtn');

  let types=[]; let activeTypeId=null; let nextTypeId=1; let lastParticlesRef=window.particles;

  function createType(opts){
    const id=nextTypeId++;
    const t={
      id,
      name: opts.name || ('Type'+id),
      color: opts.color || '#ffffff',
      elasticity: (typeof opts.elasticity==='number')? opts.elasticity:0.9,
      gravityScale: (typeof opts.gravityScale==='number')? opts.gravityScale:1,
      blobEligible: opts.blobEligible!==undefined? !!opts.blobEligible : true,
      particleIds: opts.particleIds? Array.from(opts.particleIds): []
    };
    types.push(t); return t;
  }
  function getType(id){ return types.find(t=>t.id===id); }
  function getActive(){ return getType(activeTypeId); }
  function ensureDefault(){ if(!types.length){ const all=window.particles||[]; const def=createType({name:'Default',color:all[0]?.color||'#ff0000',elasticity:all[0]?.elast||0.9,gravityScale:1,particleIds:all.map((_,i)=>i)}); activeTypeId=def.id; all.forEach((p,i)=>{ p.typeId=def.id; p.gravityScale=1; }); } }

  function refreshList(){ if(!listEl) return; listEl.innerHTML=''; for(const t of types){ const div=document.createElement('div'); div.className='type-item'+(t.id===activeTypeId?' active':''); div.dataset.id=t.id; const colorBox=document.createElement('div'); colorBox.className='type-color'; colorBox.style.background=t.color; const nameSpan=document.createElement('div'); nameSpan.className='type-name'; nameSpan.textContent=t.name; const countSpan=document.createElement('div'); countSpan.className='type-count'; countSpan.textContent=t.particleIds.length; div.appendChild(colorBox); div.appendChild(nameSpan); div.appendChild(countSpan); div.addEventListener('click',()=>{ activeTypeId=t.id; loadActiveIntoPanel(); refreshList(); }); listEl.appendChild(div);} }
  function loadActiveIntoPanel(){ const t=getActive(); if(!t) return; if(nameInput) nameInput.value=t.name; if(colorInput) colorInput.value=t.color; if(elastRange){ elastRange.value=t.elasticity; if(elastValue) elastValue.textContent=t.elasticity.toFixed(2);} if(gravRange){ gravRange.value=t.gravityScale; if(gravValue) gravValue.textContent=t.gravityScale.toFixed(2);} if(blobToggle) blobToggle.checked=t.blobEligible; }

  function applyPanelToType(){ const t=getActive(); if(!t) return; if(nameInput) t.name=nameInput.value.trim()||t.name; if(colorInput) t.color=colorInput.value; if(elastRange) t.elasticity=parseFloat(elastRange.value)||t.elasticity; if(gravRange) t.gravityScale=parseFloat(gravRange.value)||t.gravityScale; if(blobToggle) t.blobEligible=!!blobToggle.checked; t.particleIds.forEach(idx=>{ const p=window.particles[idx]; if(p){ p.color=t.color; p.elast=t.elasticity; p.gravityScale=t.gravityScale; }}); refreshList(); loadActiveIntoPanel(); }
  function revertPanel(){ loadActiveIntoPanel(); }
  function assignParticlesToType(indices,type){ if(!type) return; const idSet=new Set(indices); for(const t of types){ if(t===type) continue; if(!t.particleIds.length) continue; t.particleIds=t.particleIds.filter(i=>!idSet.has(i)); } const existing=new Set(type.particleIds); for(const i of indices) if(!existing.has(i)) type.particleIds.push(i); for(const i of indices){ const p=window.particles[i]; if(p){ p.typeId=type.id; p.color=type.color; p.elast=type.elasticity; p.gravityScale=type.gravityScale; }} refreshList(); }
  function indicesFromSelection(){ if(!window.selectionModule) return []; const sel=window.selectionModule.getSelectedParticles(); const all=window.particles||[]; const map=new Map(); all.forEach((p,i)=>map.set(p,i)); const out=[]; sel.forEach(p=>{ const idx=map.get(p); if(idx!==undefined) out.push(idx); }); return out; }
  function newTypeFromSelection(){ const idxs=indicesFromSelection(); const all=window.particles||[]; const sample=idxs.length? all[idxs[0]]:all[0]; const t=createType({ name:'Type'+(nextTypeId-1), color:sample?.color||'#ffffff', elasticity:sample?.elast||0.9, gravityScale: sample?.gravityScale||1, particleIds:idxs }); activeTypeId=t.id; assignParticlesToType(idxs,t); loadActiveIntoPanel(); refreshList(); }
  function assignSelection(){ const idxs=indicesFromSelection(); const t=getActive(); if(!t) return; assignParticlesToType(idxs,t); }
  function renameActive(){ const t=getActive(); if(!t) return; t.name=(prompt('New name for type',t.name)||t.name).trim(); if(nameInput) nameInput.value=t.name; refreshList(); loadActiveIntoPanel(); }
  function deleteActive(){ const t=getActive(); if(!t) return; if(t.id===1){ alert('Cannot delete Default type.'); return;} if(!confirm('Delete type '+t.name+'? Particles revert to Default.')) return; const def=getType(1); if(!def){ alert('Default type missing.'); return;} def.particleIds=[...new Set(def.particleIds.concat(t.particleIds))]; t.particleIds.forEach(i=>{ const p=window.particles[i]; if(p){ p.typeId=def.id; p.color=def.color; p.elast=def.elasticity; p.gravityScale=def.gravityScale; }}); types=types.filter(x=>x!==t); activeTypeId=def.id; refreshList(); loadActiveIntoPanel(); }

  newFromSelBtn?.addEventListener('click', newTypeFromSelection);
  assignSelBtn?.addEventListener('click', assignSelection);
  renameBtn?.addEventListener('click', renameActive);
  deleteBtn?.addEventListener('click', deleteActive);
  applyBtn?.addEventListener('click', applyPanelToType);
  revertBtn?.addEventListener('click', revertPanel);
  elastRange?.addEventListener('input',()=>{ if(elastValue) elastValue.textContent=parseFloat(elastRange.value).toFixed(2); });
  gravRange?.addEventListener('input',()=>{ if(gravValue) gravValue.textContent=parseFloat(gravRange.value).toFixed(2); });

  setInterval(()=>{ const all=window.particles||[]; if(all!==lastParticlesRef){ lastParticlesRef=all; const keepColor=all[0]?.color||'#ff0000'; const keepElast=all[0]?.elast||0.9; types=[]; activeTypeId=null; nextTypeId=1; createType({name:'Default',color:keepColor,elasticity:keepElast,gravityScale:1,particleIds:all.map((_,i)=>i)}); activeTypeId=1; all.forEach((p,i)=>{ p.typeId=1; p.gravityScale=1; }); refreshList(); loadActiveIntoPanel(); } ensureDefault(); const def=getType(1); for(let i=0;i<all.length;i++){ const p=all[i]; if(p.typeId===undefined){ const tgt=getActive()||def; p.typeId=tgt.id; tgt.particleIds.push(i); p.color=tgt.color; p.elast=tgt.elasticity; p.gravityScale=tgt.gravityScale; } } for(const t of types){ t.particleIds=t.particleIds.filter(i=>i<all.length); } refreshList(); },2000);

  ensureDefault(); loadActiveIntoPanel(); refreshList();
  function isParticleBlobEligible(p){ const t=getType(p?.typeId); return t? !!t.blobEligible : true; }
  window.typeSystem = { getTypes:()=>types.map(t=>({...t})), getActiveType:()=>({...getActive()}), assignSelection:assignSelection, createFromSelection:newTypeFromSelection, rebuild:()=>{ lastParticlesRef=null; }, isParticleBlobEligible };
})();

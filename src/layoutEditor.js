// Layout Editor: export/import/save/apply custom panel layouts
(function(){
  function collectLayout(){
    const map = [
      { id: 'controlPanel', label: 'control' },
      { id: 'zoomPanel', label: 'zoom' },
      { id: 'selectionPanel', label: 'selection' },
      { id: 'customBehaviorPanel', label: 'custom' }
    ];
    const out = {};
    map.forEach(p=>{
      const el = document.getElementById(p.id); if(!el) return;
      const cs = getComputedStyle(el);
      const body = el.querySelector('#customPanelBody, .panel-body');
      out[p.label] = {
        top: el.style.top || cs.top,
        left: el.style.left || cs.left,
        right: el.style.right || cs.right,
        bottom: el.style.bottom || cs.bottom,
        width: el.style.width || cs.width,
        maxHeight: el.style.maxHeight || cs.maxHeight,
        transform: el.style.transform || cs.transform,
        collapsed: el.classList.contains('collapsed') || (body ? getComputedStyle(body).display === 'none' : false)
      };
    });
    return out;
  }
  function applyLayoutObject(obj){
    const ids = { control: 'controlPanel', zoom: 'zoomPanel', selection: 'selectionPanel', custom: 'customBehaviorPanel' };
    const reset = (el)=>{ if(!el) return; el.style.position='fixed'; el.style.top=''; el.style.left=''; el.style.right=''; el.style.bottom=''; el.style.width=''; el.style.maxHeight=''; el.style.transform=''; };
    const setCollapsedUi = (panel, collapsed)=>{
      if(!panel) return;
      // Generic class for panels that use CSS
      if(collapsed) panel.classList.add('collapsed'); else panel.classList.remove('collapsed');
      // Update buttons and body visibility
      const genericBtn = panel.querySelector('.panel-header-buttons button[title="Collapse"], .panel-header-buttons button[title="Expand"]');
      if(genericBtn) genericBtn.textContent = collapsed? '+':'−';
      if(panel.id === 'customBehaviorPanel'){
        const body = panel.querySelector('#customPanelBody');
        const toggleBtn = panel.querySelector('#toggleCustomPanel');
        if(body){ body.style.display = collapsed? 'none' : 'flex'; }
        if(toggleBtn){ toggleBtn.textContent = collapsed? '+':'−'; }
      }
    };
    Object.keys(obj||{}).forEach(key=>{
      const el = document.getElementById(ids[key]); if(!el) return;
      reset(el);
      const o = obj[key]||{};
      // assign only string-like values
      ['top','left','right','bottom','width','maxHeight','transform'].forEach(k=>{ if(o[k]) el.style[k] = String(o[k]); });
      setCollapsedUi(el, !!o.collapsed);
    });
  }
  function saveCustomLayout(name, obj){
    try{
      const store = JSON.parse(localStorage.getItem('custom_layouts')||'{}');
      store[name] = obj; localStorage.setItem('custom_layouts', JSON.stringify(store));
    }catch(_){}
  }
  function listLayouts(){
    try{ return JSON.parse(localStorage.getItem('custom_layouts')||'{}'); }catch(_){ return {}; }
  }
  function getLayout(name){ const all=listLayouts(); return all[name]; }

  function openDialog(){
    const wrap = document.createElement('div');
    wrap.style.cssText='position:fixed;inset:0;z-index:2600;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;';
    const box = document.createElement('div');
    box.style.cssText='width:560px;max-width:92%;background:#101010;border:1px solid #2a2a2a;border-radius:16px;color:#ddd;box-shadow:0 10px 40px -8px #000,0 0 0 1px #000;padding:16px 16px;font:500 13px/1.5 Inter,system-ui,sans-serif;display:flex;flex-direction:column;gap:10px;';
    box.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;">'+
        '<div style="font-weight:600;font-size:14px;flex:1;">Layout Editor</div>'+
        '<button id="leClose" style="background:#222;border:1px solid #333;color:#bbb;border-radius:8px;padding:4px 10px;font-size:12px;cursor:pointer;">×</button>'+
      '</div>'+
      '<div style="display:flex;gap:8px;align-items:center;">'+
        '<button id="leCollect" style="background:#1c6cd6;border:1px solid #2f7fe4;color:#fff;border-radius:8px;padding:6px 10px;font-weight:600;">Collect Current</button>'+
        '<button id="leApply" style="background:#222;border:1px solid #333;color:#ddd;border-radius:8px;padding:6px 10px;">Apply JSON</button>'+
        '<button id="leSave" style="background:#222;border:1px solid #333;color:#ddd;border-radius:8px;padding:6px 10px;">Save As</button>'+
        '<button id="leUse" style="background:#0b62d6;border:1px solid #155fbb;color:#fff;border-radius:8px;padding:6px 10px;font-weight:600;">Use</button>'+
        '<button id="leCopy" style="background:#222;border:1px solid #333;color:#6fa2ff;border-radius:8px;padding:6px 10px;">Copy JSON</button>'+
      '</div>'+
  '<textarea id="leJson" spellcheck="false" style="width:100%;height:220px;background:#000;border:1px solid #2a2a2a;border-radius:10px;color:#e6e6e6;padding:10px;font-family:Consolas, monospace;font-size:12px;white-space:pre;"></textarea>'+
      '<div style="display:flex;gap:8px;align-items:center;">'+
        '<input id="leName" placeholder="layout name" style="flex:1;background:#000;border:1px solid #333;color:#eee;border-radius:8px;padding:6px 8px;font-size:12px;" />'+
        '<select id="leList" style="background:#000;border:1px solid #333;color:#eee;border-radius:8px;padding:6px 8px;font-size:12px;"></select>'+
      '</div>';
    wrap.appendChild(box); document.body.appendChild(wrap);

    const jsonArea = box.querySelector('#leJson');
    const nameInput = box.querySelector('#leName');
    const listSel = box.querySelector('#leList');

    function reloadList(){
      const all = listLayouts();
      listSel.innerHTML='';
      const opt0=document.createElement('option'); opt0.value=''; opt0.textContent='— saved layouts —'; listSel.appendChild(opt0);
      Object.keys(all).forEach(n=>{ const o=document.createElement('option'); o.value=n; o.textContent=n; listSel.appendChild(o); });
    }
    reloadList();

    box.querySelector('#leClose').addEventListener('click', ()=> wrap.remove());
    box.querySelector('#leCollect').addEventListener('click', ()=>{ jsonArea.value = JSON.stringify(collectLayout(), null, 2); });
    box.querySelector('#leCopy').addEventListener('click', ()=>{ try{ navigator.clipboard.writeText(jsonArea.value); }catch(_){ /* ignore */ } });
    box.querySelector('#leApply').addEventListener('click', ()=>{ try{ const obj=JSON.parse(jsonArea.value||'{}'); applyLayoutObject(obj); } catch(e){ alert('Invalid JSON: '+e.message); } });
    box.querySelector('#leSave').addEventListener('click', ()=>{ const n=(nameInput.value||'').trim(); if(!n){ alert('Enter a layout name'); return; } try{ const obj=JSON.parse(jsonArea.value||'{}'); saveCustomLayout(n, obj); reloadList(); alert('Saved "'+n+'"'); } catch(e){ alert('Invalid JSON: '+e.message); } });
    listSel.addEventListener('change', ()=>{ const n=listSel.value; if(!n) return; const obj=getLayout(n); if(obj){ jsonArea.value = JSON.stringify(obj, null, 2); } });
    box.querySelector('#leUse').addEventListener('click', ()=>{ const n=(nameInput.value||listSel.value||'').trim(); if(!n){ alert('Provide or select a name'); return; } const obj=getLayout(n); if(!obj){ alert('No saved layout named '+n); return; } applyLayoutObject(obj); try{ localStorage.setItem('ui_layout_mode','custom:'+n); }catch(_){ } alert('Applied layout '+n); });

    // Initial
    jsonArea.value = JSON.stringify(collectLayout(), null, 2);
  }

  // Expose
  window.LayoutEditor = {
    openDialog,
    listLayouts,
    getLayout,
    applySavedLayout: function(name){ const obj=getLayout(name); if(obj) applyLayoutObject(obj); }
  };

  // Gear button
  window.addEventListener('load', ()=>{
    const btn = document.getElementById('layoutEditorBtn');
    if(btn){ btn.addEventListener('click', ()=> openDialog()); }
  });
})();

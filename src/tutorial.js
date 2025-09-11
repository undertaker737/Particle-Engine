// Interactive guided tutorial system for the particle app
// Exposes window.AppTutorial.start()
(function(){
  class AppTutorial {
  constructor(options={}){
      this.steps = [];
      this.current = -1;
      this.active = false;
      this.opts = Object.assign({ allowSkip:true }, options);
      this._overlay = null; this._tooltip = null; this._arrow = null; this._maskSvg = null;
      this.tracks = {}; // name -> { steps, meta }
      this.currentTrack = null;
    this._focusRing = null; // spotlight ring element
    this._baseOverlayColor = 'rgba(0,0,0,0.55)';
  this._highlightInterval = null; // maintenance interval id
  this._currentHighlightTargets = [];
  this._eventsAttached = false;
  this._keyHandler = (e)=>{ if(!this.active) return; if(e.key==='ArrowRight'){ e.preventDefault(); this.next(); } else if(e.key==='ArrowLeft'){ e.preventDefault(); this.prev(); } else if(e.key==='Escape'){ e.preventDefault(); this.skip(); } };
  this._resizeHandler = ()=>{ if(this.active){ this._position(); this._reflowFocus(); } };
  this._scrollHandler = ()=>{ if(this.active) this._reflowFocus(); };
    }
    registerTrack(name, steps, meta={}){
      this.tracks[name] = { steps: steps.filter(Boolean), meta };
      return this;
    }
    listTracks(){ return Object.keys(this.tracks).map(k=> ({ name:k, meta:this.tracks[k].meta })); }
    startTrack(name, index=0){
      const t = this.tracks[name]; if(!t) return;
      this.currentTrack = name;
      this.define(t.steps);
      this.start(index);
    }
    define(steps){
      this.steps = steps.filter(Boolean);
      return this;
    }
    start(index=0){
      if(!this.steps.length) return;
      this.active = true; this.current = index;
      this._ensureUI();
  this._installGlobalNav();
  this._attachGlobalListeners();
      // Ensure lasso is disabled by default during tutorials
      try {
        const toggle = document.querySelector('#enableSelectionToggle');
        if(toggle && toggle.checked){ toggle.checked = false; toggle.dispatchEvent(new Event('change')); }
      } catch(_){}
      this._showStep();
    }
    next(){ if(this.current < this.steps.length-1){ this.current++; this._showStep(); } else { this.finish(); } }
    prev(){ if(this.current>0){ this.current--; this._showStep(); } }
    skip(){ this.finish(true); }
    finish(skipped=false){
      this.active=false; this.current=-1;
      if(this._overlay){ this._overlay.remove(); this._overlay=null; }
      if(this._tooltip){ this._tooltip.remove(); this._tooltip=null; }
      if(this._arrow){ this._arrow.remove(); this._arrow=null; }
    if(this._focusRing){ this._focusRing.remove(); this._focusRing=null; }
  if(this._highlightInterval){ clearInterval(this._highlightInterval); this._highlightInterval=null; }
  this._currentHighlightTargets=[];
  this._detachGlobalListeners();
  if(this._dock){ try{ this._dock.remove(); }catch(_){ } this._dock=null; }
      if(this.currentTrack && !skipped){
        try{ localStorage.setItem('tutorial_completed_'+this.currentTrack, '1'); }catch(_){ }
      }
  const finishedTrack = this.currentTrack;
  this.currentTrack = null; // reset
  if(this.opts.onFinish) this.opts.onFinish({ skipped, track: finishedTrack });
  // Allow showing chooser again unless user opted out
  this._startupShown = false; // allow re-show depending on preference
  setTimeout(()=>{
    try { if(localStorage.getItem('tutorial_startup_dismissed')==='1') return; }catch(_){ }
    this.showStartupDialog(false);
  }, 250);
    }
    _buildChrome(){
      // overlay (no blur so focused element stays sharp)
      const ov = document.createElement('div');
  ov.style.cssText='position:fixed;inset:0;background:'+this._baseOverlayColor+';z-index:2000;display:none;transition:background .25s ease;';
      ov.addEventListener('click', e=>{ e.stopPropagation(); });
      document.body.appendChild(ov); this._overlay=ov;
      const tip = document.createElement('div');
      tip.className='tutorial-tooltip';
      tip.style.cssText='position:fixed;max-width:320px;padding:14px 16px;background:#111;border:1px solid #333;border-radius:14px;color:#eee;font:500 13px/1.45 Inter,system-ui,sans-serif;z-index:2002;display:none;box-shadow:0 6px 28px -6px #000,0 0 0 1px #000;';
      tip.innerHTML='<div class="t-title" style="font-weight:600;margin-bottom:6px;font-size:14px;"></div><div class="t-body" style="white-space:pre-line;margin-bottom:10px;"></div><div class="t-actions" style="display:flex;gap:8px;justify-content:flex-end;"></div>';
      document.body.appendChild(tip); this._tooltip=tip;
      const arrow = document.createElement('div');
      arrow.style.cssText='position:fixed;width:0;height:0;border:10px solid transparent;z-index:2001;display:none;';
      document.body.appendChild(arrow); this._arrow=arrow;
    // focus ring (mask) element – uses massive spread shadow to darken surroundings
    const ring = document.createElement('div');
    ring.className='tutorial-focus-ring';
    ring.style.cssText='position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2001;display:none;box-shadow:none;transition:box-shadow .25s ease,border-radius .25s ease;';
    document.body.appendChild(ring); this._focusRing=ring;
    }
    _ensureUI(){
      // Recreate UI chrome if it was removed after a previous finish()
      if(!this._overlay || !this._tooltip || !this._arrow){
        this._buildChrome();
      }
      if(this._overlay) this._overlay.style.display='block';
      if(this._tooltip) this._tooltip.style.display='block';
      if(this._arrow) this._arrow.style.display='block';
    }
    _el(step){
      if(!step || !step.target) return null;
      if(typeof step.target === 'function'){
        try { return step.target(); } catch(_){ return null; }
      }
      if(typeof step.target==='string') return document.querySelector(step.target);
      return step.target;
    }
    _elements(step){
      if(!step) return [];
      let list = [];
      if(step.targets && Array.isArray(step.targets)) list = step.targets.slice();
      else if(Array.isArray(step.target)) list = step.target.slice();
      else if(step.target) list = [step.target];
      const resolved = list.map(t=> typeof t==='string'? document.querySelector(t): t).filter(Boolean);
      return resolved;
    }
    _showStep(){
      let step = this.steps[this.current];
      if(!step){ this.finish(); return; }
  // Ensure UI still present (in case of external DOM changes)
  if(!this._overlay || !document.body.contains(this._overlay)) this._buildChrome();
  this._ensureUI();
  const debugPrefix = '[Tutorial]';
      try { console.log('[Tutorial] Step', this.current+1, '/', this.steps.length, step.title); } catch(_){ }
      const titleEl = this._tooltip.querySelector('.t-title');
      const bodyEl = this._tooltip.querySelector('.t-body');
      const actionsEl = this._tooltip.querySelector('.t-actions');
      actionsEl.innerHTML='';
      const notFirst = this.current>0; const last = this.current === this.steps.length-1;
      // Buttons
      if(notFirst) actionsEl.appendChild(this._btn('Back', ()=>this.prev()));
      if(!last) actionsEl.appendChild(this._btn('Next', ()=>this.next(), true)); else actionsEl.appendChild(this._btn('Finish', ()=>this.finish(), true));
      if(this.opts.allowSkip) actionsEl.appendChild(this._btn('Skip', ()=>this.skip(), false,'#444'));
      // Content
      titleEl.textContent = (step.title || `Step ${this.current+1}`) + `  (${this.current+1}/${this.steps.length})`;
      bodyEl.textContent = step.text || '';
      // Resolve element with retry if missing
      let els = this._elements(step);
      let el = els[0]; // primary anchor
      if(!els.length && step.targets){
        try { console.warn(debugPrefix,'No targets resolved for step', step.title, 'selectors=', step.targets); }catch(_){ }
      }
      const wantsElement = (step.target!=null) || (step.targets && step.targets.length);
      if(wantsElement){
        if(!el && !step._retried){
          step._retried = 1; // mark retry attempts
          setTimeout(()=>{ if(this.active && this.current>=0) this._showStep(); }, 120);
        } else if(!el && step._retried < (step.maxRetries||25)){
          step._retried++;
          setTimeout(()=>{ if(this.active && this.current>=0) this._showStep(); }, 160 + step._retried*20);
        } else if(!el && step._retried >= (step.maxRetries||25) && !step._waitLoop){
          // Fallback poll loop (up to 5s) in case elements appear late
          step._waitLoop = true;
          const started = performance.now();
          const poll = ()=>{
            if(!this.active || this.steps[this.current]!==step) return; // aborted
            const found = this._elements(step);
            if(found.length){
              try { console.log(debugPrefix,'Late target appeared for', step.title); }catch(_){ }
              this._showStep();
              return;
            }
            if(performance.now()-started > 5000){
              try { console.warn(debugPrefix,'Giving up waiting for targets for', step.title); }catch(_){ }
              return;
            }
            setTimeout(poll, 250);
          };
          setTimeout(poll, 250);
        }
      }
      // Highlight / position
      if(el){
        // If element is currently hidden (e.g., inside collapsed advanced section) attempt to auto-expand once
        if((el.offsetWidth===0 || el.offsetHeight===0) && !step._expandedAttempt){
          const collapsedAncestor = el.closest('#advancedSection.collapsed');
          if(collapsedAncestor){
            const toggle = collapsedAncestor.querySelector('#advToggle');
            if(toggle){
              step._expandedAttempt = true;
              try { toggle.click(); } catch(_){ }
              // re-run after expand transition
              setTimeout(()=>{ if(this.active && this.steps[this.current]===step) this._showStep(); }, 160);
              return; // defer until expanded
            }
          }
        }
        this._highlight(els.length>1? els : el);
        let didScroll=false;
        try {
          // compute union rect if group
          const rects = (els.length>1? els: [el]).map(e=> e.getBoundingClientRect());
          const union = rects.reduce((a,r)=>({ top: Math.min(a.top,r.top), left: Math.min(a.left,r.left), right: Math.max(a.right,r.right), bottom: Math.max(a.bottom,r.bottom)}), {top:Infinity,left:Infinity,right:-Infinity,bottom:-Infinity});
          const needAuto = step.autoScroll || union.top < 0 || union.bottom > innerHeight || union.left < 0 || union.right > innerWidth;
          if(needAuto){
            this._smartScroll(els.length>1? els : el);
            didScroll=true;
          }
        } catch(_){ }
        this._position(el, step);
        this._positionFocus(els.length>1? els : el, step.focusPadding||8);
        if(didScroll){
          // Reposition after smooth scroll likely completes
          setTimeout(()=>{ if(this.active && this.steps[this.current]===step){ this._position(el, step); this._positionFocus(els.length>1? els : el, step.focusPadding||8); } }, 260);
        }
  // Do not auto-enable lasso; user should toggle it explicitly per tutorial instructions
        if(step.advanceOnClick){
          const adv = ()=>{ el.removeEventListener('click', adv); this.next(); };
          setTimeout(()=> el.addEventListener('click', adv, { once:true }), 20);
        }
      } else {
        this._clearHighlight();
        // Center tooltip when no element
        this._position(null, {});
      }
      this._updateDock();
      if(step.onEnter) try{ step.onEnter({ tutorial:this, element: el||null }); }catch(err){ console.warn('[Tutorial] onEnter error', err); }
    }
    _btn(label, cb, primary=false, bg){
      const b=document.createElement('button');
      b.textContent=label; b.style.cssText='border:none;border-radius:10px;padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer;background:'+(bg|| (primary?'#0b62d6':'#222'))+';color:'+(primary?'#fff':'#ddd')+';box-shadow:0 2px 6px #000a;';
      b.onmouseenter=()=>{ b.style.filter='brightness(1.15)'; }; b.onmouseleave=()=>{ b.style.filter='none'; };
      b.onclick=cb; return b;
    }
    _highlight(target){
      // target can be single element or array
      this._clearHighlight();
      const list = Array.isArray(target)? target : [target];
      this._currentHighlightTargets = list.filter(Boolean);
      list.forEach(el=>{
        if(!el) return;
        el.classList.add('tutorial-target');
        el.setAttribute('data-prev-z', el.style.zIndex||'');
        el.style.zIndex=2003; el.style.position = (getComputedStyle(el).position==='static')? 'relative': el.style.position;
        el.style.boxShadow = '0 0 0 2px #0b62d6, 0 0 14px 2px rgba(30,120,255,0.65)';
      });
      // Start maintenance loop if not already
      if(!this._highlightInterval){
        this._highlightInterval = setInterval(()=>{
          if(!this.active){ clearInterval(this._highlightInterval); this._highlightInterval=null; return; }
          this._currentHighlightTargets = this._currentHighlightTargets.filter(el=> el && document.body.contains(el));
          this._currentHighlightTargets.forEach(el=>{
            // Reassert style in case external code overwrote it
            if(el.style.zIndex !== '2003') el.style.zIndex='2003';
            if(!/tutorial-target/.test(el.className)) el.classList.add('tutorial-target');
            if(!el.style.boxShadow || !el.style.boxShadow.includes('#0b62d6')){
              el.style.boxShadow='0 0 0 2px #0b62d6, 0 0 14px 2px rgba(30,120,255,0.65)';
            }
          });
        }, 750);
      }
    }
    _clearHighlight(){
      document.querySelectorAll('.tutorial-target').forEach(e=>{
        e.style.boxShadow=''; if(e.getAttribute('data-prev-z')==='') e.style.removeProperty('z-index'); else e.style.zIndex=e.getAttribute('data-prev-z'); e.removeAttribute('data-prev-z'); e.classList.remove('tutorial-target');
      });
    if(this._focusRing){ this._focusRing.style.display='none'; this._focusRing.style.boxShadow='none'; }
    if(this._overlay){ this._overlay.style.background=this._baseOverlayColor; }
    this._currentHighlightTargets=[];
    }
    _position(el, step={}){
      const vp = { w: innerWidth, h: innerHeight };
      const tip = this._tooltip; const arrow = this._arrow;
      let tx = vp.w/2 - tip.offsetWidth/2; let ty = 40; // default
      let arrowDir = null; let arStyle='';
      if(el){
        const r = el.getBoundingClientRect();
        const pref = step.prefer || 'right';
        const gap = 14;
        if(pref==='right'){ tx = r.right + gap; ty = r.top + (r.height - tip.offsetHeight)/2; if(tx+tip.offsetWidth+20>vp.w) tx = vp.w - tip.offsetWidth - 20; arrowDir='left'; arStyle=`top:${r.top + r.height/2 - 10}px; left:${r.right + 2}px; border-left-color:#111;`; }
        else if(pref==='left'){ tx = r.left - tip.offsetWidth - gap; ty = r.top + (r.height - tip.offsetHeight)/2; if(tx<20) tx=20; arrowDir='right'; arStyle=`top:${r.top + r.height/2 - 10}px; left:${r.left - 22}px; border-right-color:#111;`; }
        else if(pref==='bottom'){ tx = r.left + (r.width - tip.offsetWidth)/2; ty = r.bottom + gap; if(ty+tip.offsetHeight>vp.h-20) ty = vp.h - tip.offsetHeight - 20; arrowDir='up'; arStyle=`top:${r.bottom + 2}px; left:${r.left + r.width/2 - 10}px; border-top-color:#111;`; }
        else { // top
          tx = r.left + (r.width - tip.offsetWidth)/2; ty = r.top - tip.offsetHeight - gap; if(ty<20) ty = r.bottom + gap; arrowDir='down'; arStyle=`top:${r.top - 22}px; left:${r.left + r.width/2 - 10}px; border-bottom-color:#111;`; }
        // constrain horizontally
        if(tx<20) tx=20; if(tx+tip.offsetWidth>vp.w-20) tx = vp.w - tip.offsetWidth - 20;
  // clamp vertically
  if(ty<20) ty=20; if(ty+tip.offsetHeight>vp.h-20) ty = Math.max(20, vp.h - tip.offsetHeight - 20);
      }
      tip.style.left = Math.round(tx)+'px';
      tip.style.top = Math.round(ty)+'px';
      // Arrow styling
      arrow.style.borderColor='transparent';
      arrow.style.cssText = 'position:fixed;width:0;height:0;border:10px solid transparent;z-index:2001;'+arStyle;
    }
    _reflowFocus(){
      if(!this.active) return; const step=this.steps[this.current]; if(!step) return; const els=this._elements(step); if(els.length) this._positionFocus(els.length>1? els : els[0], step.focusPadding||8);
    }
    _smartScroll(elOrList){
      const list = Array.isArray(elOrList)? elOrList : [elOrList];
      if(!list.length) return;
      // compute union rect and choose primary (first)
      const primary = list[0];
      try { primary.scrollIntoView({behavior:'smooth', block:'center'}); } catch(_){ }
      try {
        const isScrollable = (node)=>{
          if(!node || node===document.body) return false;
          const cs=getComputedStyle(node);
          return /(auto|scroll)/.test(cs.overflowY) && node.scrollHeight > node.clientHeight+4;
        };
        let parent=primary.parentElement; let targetAncestor=null;
        while(parent){ if(isScrollable(parent)){ targetAncestor=parent; break; } parent=parent.parentElement; }
        if(targetAncestor){
          const cr = targetAncestor.getBoundingClientRect();
          // union of list inside ancestor
            const rects = list.map(e=> e.getBoundingClientRect());
            const union = rects.reduce((a,r)=>({ top: Math.min(a.top,r.top), bottom: Math.max(a.bottom,r.bottom)}), {top:Infinity,bottom:-Infinity});
          if(union.top < cr.top || union.bottom > cr.bottom){
            const mid = (union.top + union.bottom)/2;
            const offset = mid - (cr.top + cr.height/2);
            targetAncestor.scrollTo({ top: targetAncestor.scrollTop + offset, behavior:'smooth' });
          }
        }
      } catch(_){ }
    }
    _positionFocus(elOrList, pad=8){
      if(!this._focusRing || !elOrList) return;
      const list = Array.isArray(elOrList)? elOrList : [elOrList];
      if(!list.length) return;
      const firstRect = list[0].getBoundingClientRect();
      const union = list.slice(1).reduce((acc,el)=>{ const r=el.getBoundingClientRect(); acc.left=Math.min(acc.left,r.left); acc.top=Math.min(acc.top,r.top); acc.right=Math.max(acc.right,r.right); acc.bottom=Math.max(acc.bottom,r.bottom); return acc; }, { left:firstRect.left, top:firstRect.top, right:firstRect.right, bottom:firstRect.bottom });
      const r = { left:union.left, top:union.top, width:union.right-union.left, height:union.bottom-union.top };
      const ring = this._focusRing; const x=r.left-pad, y=r.top-pad, w=r.width+pad*2, h=r.height+pad*2;
      ring.style.display='block'; ring.style.left=x+'px'; ring.style.top=y+'px'; ring.style.width=w+'px'; ring.style.height=h+'px';
      ring.style.borderRadius = Math.min(w,h)/6+'px';
      if(this._overlay){
        this._overlay.style.background='transparent';
        ring.style.boxShadow='0 0 0 3px #0b62d6,0 0 0 6px rgba(11,98,214,0.35),0 0 22px 4px rgba(30,120,255,0.5),0 0 0 9999px rgba(0,0,0,0.55)';
      }
    }
    showStartupDialog(force=false){
      if(!force){
        // Respect persistent dismissal
        try { if(localStorage.getItem('tutorial_startup_dismissed')==='1') return; } catch(_){ }
        if(this._startupShown) return; // already shown this session
        this._startupShown = true;
      } else {
        this._startupShown = true; // forced show
      }
      // Remove existing chooser if present
      if(this._startupModal) { try{ this._startupModal.remove(); }catch(_){ } this._startupModal=null; }
      const wrap = document.createElement('div');
      wrap.style.cssText='position:fixed;inset:0;z-index:2050;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);';
      const box = document.createElement('div');
      box.style.cssText='width:400px;max-width:90%;background:#111;border:1px solid #2a2a2a;border-radius:20px;padding:22px 24px;font:500 13px/1.5 Inter,system-ui,sans-serif;color:#ddd;box-shadow:0 10px 40px -8px #000,0 0 0 1px #000;display:flex;flex-direction:column;gap:16px;';
      box.innerHTML = 
        '<div style="display:flex;align-items:center;gap:10px;">'+
          '<div style="font-size:19px;font-weight:600;letter-spacing:.5px;flex:1;">Welcome</div>'+ 
          '<button id="startupCloseBtn" style="background:#222;border:1px solid #333;color:#bbb;border-radius:10px;padding:4px 10px;font-size:12px;font-weight:600;cursor:pointer;">×</button>'+
        '</div>'+
        '<div style="font-size:12px;color:#aaa;margin-top:-4px;">Select a tutorial to begin, or close this window. Tracks can be re-opened later with the ? button. Panels are movable (drag their headers) and collapsible (− buttons).</div>'+
        '<div class="track-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;"></div>'+
        '<div class="layouts" style="margin-top:6px;">'+
          '<div style="font-size:12px;color:#9ab; margin:10px 0 6px; font-weight:600;">Layouts</div>'+
          '<div style="display:flex;flex-wrap:wrap;gap:8px;">'+
            '<button class="layout-btn" data-layout="play" style="background:#222;border:1px solid #333;color:#7fe37f;border-radius:10px;padding:6px 10px;font-size:12px;">Play Mode</button>'+ 
            '<button class="layout-btn" data-layout="layoutx" style="background:#222;border:1px solid #333;color:#f36;border-radius:10px;padding:6px 10px;font-size:12px;">Layout X</button>'+ 
            '<button id="exportLayoutBtn" style="background:#222;border:1px solid #333;color:#6fa2ff;border-radius:10px;padding:6px 10px;font-size:12px;">Export Layout</button>'+ 
          '</div>'+
        '</div>'+
        '<label style="display:flex;align-items:center;gap:6px;font-size:11px;color:#888;">'+
          '<input type="checkbox" id="dontShowTutorialStartup" style="accent-color:#0b62d6;"> Don\'t show this again'+
        '</label>'+
        '<div style="display:flex;gap:10px;justify-content:flex-end;">'+
          '<button id="startBasicTrack" style="background:#0b62d6;border:none;color:#fff;border-radius:12px;padding:8px 14px;font-size:12px;font-weight:600;cursor:pointer;">Start Basic</button>'+
          '<button id="startupDismissBtn" style="background:#222;border:1px solid #333;color:#bbb;border-radius:12px;padding:8px 14px;font-size:12px;font-weight:600;cursor:pointer;">Dismiss</button>'+
        '</div>';
      wrap.appendChild(box); document.body.appendChild(wrap);
      const grid = box.querySelector('.track-grid');
      this.listTracks().forEach(t=>{
        const done = localStorage.getItem('tutorial_completed_'+t.name)==='1';
        const card = document.createElement('button');
        card.style.cssText='all:unset;cursor:pointer;padding:10px 12px;background:#1b1b1b;border:1px solid #262626;border-radius:14px;display:flex;flex-direction:column;gap:4px;transition:background .15s ease,border-color .15s ease;min-height:86px;';
        card.onmouseenter=()=>{ card.style.background='#242424'; card.style.borderColor='#333'; };
        card.onmouseleave=()=>{ card.style.background='#1b1b1b'; card.style.borderColor='#262626'; };
        card.innerHTML='<div style="display:flex;align-items:center;gap:6px;">'+
           '<span style="font-weight:600;font-size:13px;">'+(t.meta.label||t.name)+'</span>'+
           (done?'<span style="font-size:11px;color:#4cafef;">✓</span>':'')+
           '</div>'+
           (t.meta.desc?'<div style="font-size:11px;color:#888;line-height:1.4;">'+t.meta.desc+'</div>':'');
        card.addEventListener('click', ()=>{ finalize(); this.startTrack(t.name); });
        grid.appendChild(card);
      });
      const finalize = ()=>{
        const dont = box.querySelector('#dontShowTutorialStartup').checked;
        if(dont && !force){ try{ localStorage.setItem('tutorial_startup_dismissed','1'); }catch(_){ } }
        wrap.remove(); this._startupModal=null;
        if(this._dock){ try{ this._dock.remove(); }catch(_){ } this._dock=null; }
      };
      box.querySelector('#startupDismissBtn').addEventListener('click', finalize);
      box.querySelector('#startupCloseBtn').addEventListener('click', finalize);
  box.querySelector('#startBasicTrack').addEventListener('click', ()=>{ finalize(); this.startTrack('basic'); });
      // Layout handlers
      box.querySelectorAll('.layout-btn').forEach(btn=>{
        btn.addEventListener('click', ()=>{
          const mode = btn.getAttribute('data-layout');
          try{ localStorage.setItem('ui_layout_mode', mode); }catch(_){ }
          this.applyLayout(mode);
        });
      });
      // Export Layout button -> open the Layout Editor
      const exportBtn = box.querySelector('#exportLayoutBtn');
      if(exportBtn){
        exportBtn.addEventListener('click', ()=>{
          // Close startup and open editor UI if present
          try{ wrap.remove(); this._startupModal=null; }catch(_){ }
          if(window.LayoutEditor && typeof window.LayoutEditor.openDialog==='function'){
            window.LayoutEditor.openDialog();
          } else {
            alert('Layout Editor not loaded.');
          }
        });
      }
      this._startupModal = wrap;
    }
    applyLayout(mode){
      const ctl = document.getElementById('controlPanel');
      const zoom = document.getElementById('zoomPanel');
      const sel = document.getElementById('selectionPanel');
      const custom = document.getElementById('customBehaviorPanel');
      if(!ctl || !zoom || !sel) return;
      // Helper to collapse/expand a panel
    function setCollapsed(panel, collapsed) {
        if (!panel) return;
        if (collapsed) {
          panel.classList.add('collapsed');
          // Find and update toggle button if present
          const btn = panel.querySelector('.panel-header-buttons button[title="Collapse"], .panel-header-buttons button[title="Expand"], #toggleCustomPanel');
          if(btn) btn.textContent = '+';
      // Let CSS control collapsed width: clear inline width
      panel.style.width = '';
        } else {
          panel.classList.remove('collapsed');
          const btn = panel.querySelector('.panel-header-buttons button[title="Collapse"], .panel-header-buttons button[title="Expand"], #toggleCustomPanel');
          if(btn) btn.textContent = '−';
        }
        // Custom panel body visibility
        if(panel && panel.id === 'customBehaviorPanel'){
          const body = panel.querySelector('#customPanelBody');
          if(body) body.style.display = collapsed ? 'none' : 'flex';
        }
      }
      // Fully clear all relevant inline styles
      const reset = (el)=>{
        if(!el) return;
        el.style.top=''; el.style.left=''; el.style.right=''; el.style.bottom='';
        el.style.width=''; el.style.maxWidth=''; el.style.minWidth='';
        el.style.height=''; el.style.maxHeight='';
        el.style.transform='';
        el.style.position='';
        // Clear any stale inline display on body from older handlers
        const body = el.querySelector('.panel-body');
        if(body) body.style.display='';
      };
      // Always reset before applying a new layout
  reset(ctl); reset(zoom); reset(sel); if(custom) reset(custom);
      // Default: all expanded if mode missing
      if(!mode) {
        setCollapsed(ctl, false);
        setCollapsed(zoom, false);
        setCollapsed(sel, false);
        return;
      }
      const place = (el, pos)=>{
        if(!el) return;
        el.style.position = 'fixed';
        Object.assign(el.style, pos);
      };
      switch(mode){
        case 'play': {
          // Play Mode (exact positions provided by user)
          // Control
          setCollapsed(ctl, false);
          place(ctl, {
            top:'66px', left:'6px', right:'auto', bottom:'auto',
            width:'280px', maxHeight:'calc(100% - 32px)', transform:'none'
          });
          // Zoom
          setCollapsed(zoom, true);
          place(zoom, {
            top:'59px', left:'1054px', right:'auto', bottom:'822px',
            width:'220px', maxHeight:'60px', transform:'none'
          });
          // Selection
          setCollapsed(sel, true);
          place(sel, {
            top:'6px', left:'253px', right:'auto', bottom:'auto',
            width:'178.859px', maxHeight:'340px', transform:'matrix(1, 0, 0, 1, -89.4297, 0)'
          });
          // Custom Behavior Panel: collapsed at top-right
          if(custom){
            setCollapsed(custom, true);
            place(custom, { top:'16px', right:'16px', left:'auto', bottom:'auto', transform:'none' });
          }
          break;
        }
        case 'layoutx': {
          // Alternate layout preset
          setCollapsed(ctl, true);
          setCollapsed(zoom, false);
          setCollapsed(sel, false);
          place(ctl, { top:'16px', left:'16px', right:'', bottom:'', width:'300px', transform:'none' });
          place(zoom, { top:'16px', right:'16px', left:'', bottom:'', width:'300px', transform:'none' });
          place(sel, { bottom:'16px', left:'16px', right:'', top:'', transform:'none' });
          break;
        }
        default: {
          // Fallback to all expanded
          setCollapsed(ctl, false);
          setCollapsed(zoom, false);
          setCollapsed(sel, false);
          break;
        }
      }
    }
    showLauncher(anchorBtn){
      if(this._launcher){ this._launcher.remove(); this._launcher=null; }
      const menu = document.createElement('div');
      menu.className='tutorial-track-menu';
      menu.style.cssText='position:fixed;z-index:2100;background:#111;border:1px solid #333;border-radius:12px;padding:10px 10px;display:flex;flex-direction:column;gap:6px;min-width:220px;box-shadow:0 8px 28px -6px #000,0 0 0 1px #000;';
      const close = ()=>{ if(menu){ menu.remove(); this._launcher=null; } };
      // Build menu from registered tracks
      this.listTracks().forEach(t=>{
        const btn = document.createElement('button');
        btn.textContent = t.meta.label || t.name;
        btn.style.cssText='all:unset;cursor:pointer;padding:8px 10px;border-radius:8px;color:#ddd;display:block;';
        btn.onmouseenter=()=>btn.style.background='#1d1d1d';
        btn.onmouseleave=()=>btn.style.background='transparent';
        btn.onclick=()=>{ close(); this.startTrack(t.name); };
        menu.appendChild(btn);
        if(t.meta.desc){ const d=document.createElement('div'); d.textContent=t.meta.desc; d.style.cssText='font-size:11px;color:#666;margin:-2px 0 6px 4px;'; menu.appendChild(d); }
      });
      const r = anchorBtn.getBoundingClientRect();
      menu.style.top = (r.bottom + 8)+'px';
      menu.style.left = Math.min(innerWidth - 260, r.left)+'px';
      document.body.appendChild(menu); this._launcher=menu;
    }
    _installGlobalNav(){
      if(this._dock) return;
      const dock = document.createElement('div');
      dock.style.cssText='position:fixed;bottom:12px;left:50%;transform:translateX(-50%);z-index:2105;display:flex;align-items:center;gap:10px;padding:6px 12px;background:#111;border:1px solid #333;border-radius:14px;font:500 12px Inter,sans-serif;box-shadow:0 4px 16px -4px #000,0 0 0 1px #000;';
      dock.innerHTML='<span class="t-step-ind" style="color:#6fa2ff;font-weight:600;"></span><div class="t-dock-actions" style="display:flex;gap:6px;"></div>';
      document.body.appendChild(dock); this._dock=dock;
      this._updateDock();
    }
    _updateDock(){
      if(!this._dock) return; const ind=this._dock.querySelector('.t-step-ind'); if(ind) ind.textContent = `Step ${this.current+1}/${this.steps.length}`;
      const act = this._dock.querySelector('.t-dock-actions'); if(!act) return; act.innerHTML='';
      if(this.current>0) act.appendChild(this._dockBtn('◀', ()=>this.prev()));
      if(this.current < this.steps.length-1) act.appendChild(this._dockBtn('Next ▶', ()=>this.next(), true)); else act.appendChild(this._dockBtn('Finish', ()=>this.finish(), true));
      act.appendChild(this._dockBtn('Skip', ()=>this.skip(), false));
    }
    _dockBtn(label, cb, primary){
      const b=document.createElement('button');
      b.textContent=label; b.style.cssText='border:none;border-radius:10px;padding:4px 10px;font-size:11px;font-weight:600;cursor:pointer;background:'+(primary?'#0b62d6':'#222')+';color:'+(primary?'#fff':'#bbb')+';';
      b.onmouseenter=()=>b.style.filter='brightness(1.15)'; b.onmouseleave=()=>b.style.filter='none'; b.onclick=cb; return b;
    }
    _attachGlobalListeners(){
      if(this._eventsAttached) return;
      window.addEventListener('keydown', this._keyHandler);
      window.addEventListener('resize', this._resizeHandler);
      window.addEventListener('scroll', this._scrollHandler, true);
      this._eventsAttached = true;
    }
    _detachGlobalListeners(){
      if(!this._eventsAttached) return;
      window.removeEventListener('keydown', this._keyHandler);
      window.removeEventListener('resize', this._resizeHandler);
      window.removeEventListener('scroll', this._scrollHandler, true);
      this._eventsAttached = false;
    }
  }

  // Initialize tutorial system with multiple tracks
  const tutorial = new AppTutorial({ allowSkip:true, onFinish: ({skipped})=>{ console.log('[Tutorial] finished. skipped=', skipped); } });

  // Basic track
  tutorial.registerTrack('basic', [
    { target:'#startTutorialBtn', title:'Welcome', text:'Interactive Particle System\n\nBasic tour: core controls & workflow. Skip anytime.', prefer:'right' },
    { target:'#countRange', title:'Particle Count', text:'Adjust how many particles are simulated. Large values affect performance.', prefer:'right' },
    { target:'#gravityRange', title:'Global Gravity', text:'Overall downward force. Combine with per-type gravity for variety.', prefer:'right' },
  { target:'#pauseBtn', title:'Pause / Resume', text:'Click the Pause button now to toggle the simulation. Advancing automatically after click.', prefer:'right', advanceOnClick:true },
  { target:'#enableSelectionLabel', title:'Lasso Select', text:'Toggle lasso mode, then drag on the canvas to select particles. Double‑click to finalize.', prefer:'left', autoScroll:true },
  { target:'#applySelectionBtn', title:'Create Type', text:'Click this to create a new type from the selection. (Advances on click)', prefer:'top', autoScroll:true, advanceOnClick:true },
  { targets:['#typeColorInput','#typeElasticRange','#typeGravityRange','#typeBlobEligibleToggle'], title:'Type Properties', text:'Color, elasticity, gravity scale, and blob eligibility live here. Blob = fuse nearby particles into a smooth goo shape (toggle per type here; tuning in Advanced).', prefer:'left', autoScroll:true, focusPadding:14 },
    { target:'#zoomPanel', title:'Zoom & Stats', text:'Inspect a focused region and live metrics.', prefer:'left' },
    { target:null, title:'Done', text:'That completes the basic tour. Explore advanced & scripting tracks next!', prefer:'bottom' }
  ], { label:'Basic Tour', desc:'Core controls & workflow.' });

  // Advanced track
  tutorial.registerTrack('advanced', [
  { targets:['#gridToggleBtn','#gridToggle','#showGridBtn'], title:'Spatial Grid', text:'Debug the spatial partitioning cells used for collisions.', prefer:'right', autoScroll:true },
  { targets:['#qualitySelect','#qualityDropdown','#qualityLevelSelect'], title:'Collision Quality', text:'Increase steps per frame for more accurate collision resolution.', prefer:'right', autoScroll:true },
  { targets:['#blobDensitySelect','#blobDensityRange','#blobRenderingToggle'], title:'Blob Rendering', text:'Enable metaball ("blob") mode: nearby particles fuse into a smooth gooey mass when their combined field passes a cutoff. Use this menu to toggle style & quality.', prefer:'right', autoScroll:true },
  { targets:['#blobThresholdRange','#blobThresholdSlider'], title:'Blob Threshold', text:'Field cutoff / iso-surface. Lower = easier merging (more goo). Higher = blobs stay separate.', prefer:'right', autoScroll:true },
  { targets:['#blobRadiusExtraRange','#blobRadiusRange','#blobExtraRadius'], title:'Extra Radius', text:'Adds to each particle influence radius. Larger connects clusters sooner & looks thicker (slower if very large).', prefer:'right', autoScroll:true },
  { targets:['#velocityColorToggle','#velocityColorBtn','#velocityColoringToggle'], title:'Velocity Coloring', text:'Toggle speed-based color gradients.', prefer:'right', autoScroll:true },
  { targets:['#forceRange','#forceStrengthRange','#userForceRange'], title:'Force Strength', text:'Applies user force (mouse interaction or scripted) magnitude.', prefer:'right', autoScroll:true },
  { targets:['#radiusRange','#forceRadiusRange','#influenceRadiusRange'], title:'Force Radius', text:'Area of influence for the applied force field.', prefer:'right', autoScroll:true },
  { targets:['#timeScaleRange','#timescaleRange','#timeScaleSlider'], title:'Time Scale', text:'Slow motion ( <1 ) or fast-forward ( >1 ).', prefer:'right', autoScroll:true },
    { target:null, title:'Advanced Complete', text:'You now know the power-user controls.', prefer:'bottom' }
  ], { label:'Advanced Features', desc:'Performance, visualization & physics detail.' });

  // Scripting track
  tutorial.registerTrack('scripting', [
    { target:'#customBehaviorPanel', title:'Custom Behavior Panel', text:'Where you inject per-frame JS logic.', prefer:'left' },
    { target:'#customEnableToggle', title:'Enable Toggle', text:'Turn continuous execution on or off.', prefer:'left' },
    { target:'#customRunOnceBtn', title:'Run Once', text:'Execute code one time without attaching hooks.', prefer:'left' },
    { target:'#customApplyBtn', title:'Apply Script', text:'Compile + attach your script with chosen phase directives.', prefer:'left' },
    { target:'#customMinifyBtn', title:'Minify', text:'Compress code quickly (basic whitespace removal).', prefer:'left' },
    { target:'#customMaxBtn', title:'Maximize Editor', text:'Expand editing space for larger behaviors.', prefer:'left' },
    { target:null, title:'Directives', text:'Use @phase before|after|both|replace and @unsafe for full access. Explore api.each/filter/random/hooks.', prefer:'bottom' },
    { target:null, title:'Documentation', text:'Open the full scripting reference (API, hooks, unsafe mode, patterns, FAQ).', prefer:'bottom', onEnter: ({tutorial})=>{
        try {
          const actions = tutorial._tooltip && tutorial._tooltip.querySelector('.t-actions');
          if(actions && !actions.querySelector('.doc-btn')){
            const btn = tutorial._btn('Open Docs', ()=>{ window.open('scripting.html','_blank'); }, true);
            btn.classList.add('doc-btn');
            btn.style.background = '#1c6cd6';
            btn.style.minWidth='92px';
            actions.insertBefore(btn, actions.firstChild);
          }
        } catch(_){ }
      } },
    { target:null, title:'Scripting Complete', text:'Experiment & iterate. Combine with types for targeted effects.', prefer:'bottom', onEnter: ({tutorial})=>{
        try {
          const actions = tutorial._tooltip && tutorial._tooltip.querySelector('.t-actions');
          if(actions && !actions.querySelector('.doc-btn')){
            const btn = tutorial._btn('Docs', ()=>{ window.open('scripting.html','_blank'); }, false);
            btn.classList.add('doc-btn');
            btn.title='Open scripting documentation';
            // Insert before Finish/Skip to keep accessible
            if(actions.firstChild) actions.insertBefore(btn, actions.firstChild.nextSibling); else actions.appendChild(btn);
          }
        } catch(_){ }
      } }
  ], { label:'Scripting Deep Dive', desc:'Custom JS behaviors & directives.' });

  // Types & Selection focused track
  tutorial.registerTrack('types', [
  { target:'#enableSelectionLabel', title:'Enable Lasso', text:'First activate selection mode.', prefer:'left', autoScroll:true },
    { target:'#applySelectionBtn', title:'Create Type', text:'Turn selection into a new type instantly.', prefer:'top', autoScroll:true },
  { target:'#assignSelectionBtn', title:'Assign to Type', text:'Move selected particles into currently active type.', prefer:'top', autoScroll:true, focusPadding:10 },
    { target:'#renameTypeBtn', title:'Rename Type', text:'Keep your type list organized.', prefer:'top' },
    { target:'#typeGravityRange', title:'Per-Type Gravity', text:'Scale global gravity up/down for this type.', prefer:'left' },
    { target:'#typeElasticRange', title:'Elasticity', text:'Collision bounce factor for particles of this type.', prefer:'left' },
  { target:'#typeBlobEligibleToggle', title:'Blob Eligible', text:'If checked, this type contributes to & is rendered by blob mode. Unchecked: stays as discrete particles even when blobs on.', prefer:'left' },
    { target:null, title:'Types Complete', text:'Mix multiple types for layered simulations.', prefer:'bottom' }
  ], { label:'Types & Selection', desc:'Grouping & per-type physics.' });

  window.AppTutorial = tutorial;
  const startBtn = document.getElementById('startTutorialBtn');
  if(startBtn){
    startBtn.addEventListener('click', (e)=>{
      e.stopPropagation();
      tutorial.showLauncher(startBtn);
    });
  }
  // Initial (respect dismissal) and apply saved layout (supports custom layouts via LayoutEditor)
  window.addEventListener('load', ()=> setTimeout(()=> { 
    try{ 
      const m=localStorage.getItem('ui_layout_mode'); 
      if(m){ 
        if(/^custom:/.test(m) && window.LayoutEditor && typeof window.LayoutEditor.applySavedLayout==='function'){
          window.LayoutEditor.applySavedLayout(m.replace(/^custom:/,''));
        } else {
          tutorial.applyLayout(m);
        }
      }
    }catch(_){}
    tutorial.showStartupDialog(false); 
  }, 120));
})();

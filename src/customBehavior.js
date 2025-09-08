// Custom Behavior System
// Allows user-provided JavaScript to run each physics step on chosen particles.
// Sandbox is lightweight: code runs in a try/catch; expose limited API object.
(function(){
  const state = {
    enabled: true,
    code: '// Example:\n// api.each(p => { p.vx += (Math.random()-0.5)*2; });\n// api.filter(p=>p.y < 200).forEach(p=> p.vy -= 30 * api.dt);',
    fn: null,
    lastError: null,
    target: 'all', // all | type:<id>
  lastCompileHash: '',
  phase: 'after', // before | after | both | replace
  unsafe: false
  };

  function hash(str){ let h=0,i=0,l=str.length; while(i<l){ h = ((h<<5)-h + str.charCodeAt(i++))|0; } return h.toString(36); }

  function parseDirectives(src){
    state.phase = 'after';
    state.unsafe = false;
    const lines = src.split(/\n/).slice(0,12);
    for(const raw of lines){
      const line = raw.trim();
      if(!line.startsWith('//')) continue;
      if(line.includes('@phase')){
        const m = line.match(/@phase\s+(before|after|both|replace)/i);
        if(m) state.phase = m[1].toLowerCase();
      }
      if(line.includes('@unsafe')) state.unsafe = true;
    }
  }

  function compile(){
    const src = state.code || '';
    parseDirectives(src);
    const h = hash(src + '|' + state.target + '|' + state.phase + '|' + state.unsafe);
    if(h === state.lastCompileHash) return true;
    state.lastCompileHash = h;
    try {
      if(state.unsafe){
        // Unsafe global eval path (user requested full freedom)
        state.fn = new Function('api','window','Particle','particles','origPhysics', src + '\n;return true;');
      } else {
        state.fn = new Function('api','window','Particle','particles','origPhysics', src);
      }
      state.lastError = null;
      return true;
    } catch(e){
      state.lastError = e.message;
      state.fn = null;
      return false;
    }
  }

  function getTargetParticles(){
    if(!Array.isArray(window.particles)) return [];
    if(state.target === 'all') return window.particles;
    if(state.target.startsWith('type:')){
      const id = state.target.split(':')[1];
      return window.particles.filter(p=> String(p.typeId) === id);
    }
    return window.particles;
  }

  // Public API passed to user code each frame
  function buildApi(dt){
    const list = getTargetParticles();
    const hooks = { before:null, perParticle:null };
    return {
      dt,
      particles: list,
      count: list.length,
      each: (cb)=>{ for(let i=0;i<list.length;i++) cb(list[i], i); },
      filter: (pred)=> list.filter(pred),
      random: ()=> list[Math.floor(Math.random()*list.length)],
      global: { width: window.innerWidth, height: window.innerHeight, gravity: (typeof gravity!=='undefined'? gravity : 0) },
      byType: (id)=> window.particles.filter(p=> String(p.typeId) === String(id)),
      types: ()=> (window.typeSystem? window.typeSystem.getTypes() : []),
      log: (...args)=> console.log('[Custom]', ...args),
      hooks
    };
  }

  // Hook into physics loop: minimal patching by wrapping existing physicsStep if present
  function installHook(){
    if(window.__customBehaviorHookInstalled) return; // idempotent
    window.__customBehaviorHookInstalled = true;
    const orig = window.physicsStep || null;
    window.physicsStep = function(dt){
      let api = null;
      const shouldRun = state.enabled && state.code && compile() && state.fn;
      function runUser(){
        if(!api) api = buildApi(dt);
        try { state.fn(api, window, window.Particle || null, window.particles || [], orig); }
        catch(e){ state.lastError = e.message; }
      }
      if(shouldRun){
        // BEFORE or BOTH: user code (and hooks.before) first
        if(state.phase === 'before' || state.phase === 'both'){
          runUser();
          if(api && api.hooks && typeof api.hooks.before === 'function'){
            try { api.hooks.before(api); } catch(e){ state.lastError = e.message; }
          }
        }
        if(state.phase === 'replace'){
          // User fully controls simulation; they may call orig via origPhysics
          runUser();
        } else {
          if(orig) orig(dt); // base simulation
        }
        // AFTER or BOTH: run after base physics
        if(state.phase === 'after' || state.phase === 'both'){
          runUser();
        }
        // Per-particle hook always executes last if defined
        if(!api) api = buildApi(dt);
        if(api && api.hooks && typeof api.hooks.perParticle === 'function'){
          const list = api.particles;
            for(let i=0;i<list.length;i++){
              try { api.hooks.perParticle(list[i], api); } catch(e){ state.lastError = e.message; break; }
            }
        }
      } else {
        if(orig) orig(dt);
      }
    };
  }

  // Expose management API
  window.customBehavior = {
    setCode(str){ state.code = String(str||''); state.lastCompileHash=''; compile(); },
    getCode(){ return state.code; },
    setEnabled(v){ state.enabled = !!v; },
    isEnabled(){ return state.enabled; },
    getLastError(){ return state.lastError; },
    setTargetAll(){ state.target='all'; },
    setTargetType(id){ state.target = 'type:'+id; state.lastCompileHash=''; },
    getTarget(){ return state.target; },
    listTargets(){
      const arr = [{value:'all', label:'All Particles'}];
      if(window.typeSystem){
        for(const t of window.typeSystem.getTypes()) arr.push({ value:'type:'+t.id, label:'Type: '+t.name });
      }
      return arr;
    }
  };

  // Defer hook install until after main.js likely defined physicsStep
  if(document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installHook);
  } else {
    installHook();
  }
})();

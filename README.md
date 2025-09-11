# Particle System

High‑performance browser particle simulation with multi-track interactive tutorials, custom scripting, type-based physics, and optional metaball ("blob") rendering.

## ✨ Features
- Real-time particle physics with collision and gravity controls
- Multi-track guided tutorial system (Basic, Advanced, Types & Selection, Scripting)
- Spotlight highlighting & smart scrolling for UI onboarding
- Type system: per-type gravity scaling, elasticity, color, blob eligibility
- Lasso selection & batch operations (create/assign/rename/delete types)
- Blob / metaball rendering (density, threshold, extra radius)
- Zoom / stats panel with live metrics
- Custom scripting panel with phase directives & optional unsafe mode
- Script API: per-frame & hook-based customization (before/after/per-particle)
- Performance utilities: auto capacity check, adjustable collision quality

## 🚀 Quick Start
1. Clone or download the project.
2. Open `index.html` in any modern browser (Chrome/Edge/Firefox).
3. The tutorial launcher (`?` button) or startup dialog can guide you through the UI.

> No build step required. Pure HTML/CSS/JS.

## 🕹 Core Controls
| Control | Purpose |
|---------|---------|
| Gravity | Global downward force |
| Count | Particle population size (performance-sensitive) |
| Size | Rendering radius (affects visual density) |
| Force Strength / Radius | Interactive mouse influence |
| Pause | Toggle simulation state |
| Collision Quality | Steps per frame for collision resolution |
| Time Scale | Slow motion / fast forward |

Advanced panel adds: grid visualization, blob settings, elasticity, velocity coloring.

## 🧪 Types & Selection
- Enable Lasso → drag to select particles.
- Create Type → promote selection to a new type (with independent properties).
- Assign Sel → move selection into currently active type.
- Per-type properties: Color, Elasticity, Gravity Scale, Blob Eligible.

Blob eligible types contribute to the metaball field. Disable for crisp discrete particles even when blobs are on.

## 🧬 Blob Rendering
| Setting | Effect |
|---------|--------|
| Blob Density | Enables metaball pass (fused look) |
| Blob Min Count | Threshold: minimum neighbors contributing to merging |
| Blob Extra Radius | Expands influence; higher = thicker, slower |

## 📚 Tutorial System
Tracks:
- **Basic** – Core workflow & essential controls
- **Advanced** – Performance & visualization features
- **Types & Selection** – Group management & per-type physics
- **Scripting** – Custom logic, directives, hooks

Tutorial engine highlights elements, auto-scrolls into view, and re-launches on demand. Use the `?` button to pick another track. "Don’t show again" dismisses the startup chooser persistently.

## 🛠 Custom Scripting
Open the **Custom Behavior** panel (bottom-right). Write JavaScript and click **Apply**.

Directives (in leading comments):
```js
// @phase before|after|both|replace   // default: after
// @unsafe                            // opt-in wider access
```
Phases:
- `before` – runs pre-physics
- `after` (default) – runs post-physics
- `both` – twice per frame
- `replace` – you drive the simulation; call `origPhysics(dt)` manually if needed (unsafe only)

API snapshot:
```js
api.dt              // delta time
api.particles       // targeted particle subset
api.count
api.each(cb)        // fast iteration
api.filter(fn)
api.random()
api.global.width / height / gravity
api.byType(id)
api.types()         // type metadata array
api.log(...)
api.hooks.before = (api)=>{}
api.hooks.perParticle = (p, api)=>{}
```
Example:
```js
// Gentle drag & color shimmer
api.each(p => { p.vx *= 0.99; p.vy *= 0.99; });
if(api.count) api.random().color = '#'+(Math.random()*0xffffff|0).toString(16).padStart(6,'0');
```
Full documentation: open `scripting.html` (also exposed in final scripting tutorial step).

## ⚡ Performance Tips
- Keep particle count within device limits (use Auto Capacity to probe)
- Reduce Collision Quality for weaker hardware
- Prefer velocity adjustments over direct position teleports
- Avoid nested loops across all particles (O(n^2)) unless critical
- Use `api.filter` sparingly; cache results if reused inside same frame
- Blob rendering at high density + extra radius is the most expensive visual feature

## 🐞 Error Handling
- Script compile/runtime errors appear in the scripting panel status line
- The simulation continues attempting execution each frame (no hard disable)
- Use browser DevTools console for deeper inspection

## 📄 Files
| File | Purpose |
|------|---------|
| `index.html` | Main UI and panel markup |
| `style.css` | Styling for panels & controls |
| `src/main.js` | Core particle simulation & loop (not shown here) |
| `src/types.js` | Type system logic |
| `src/selection.js` | Lasso selection & interactions |
| `src/customBehavior.js` | Scripting engine (API + directives) |
| `src/tutorial.js` | Multi-track tutorial system |
| `scripting.html` | Full scripting documentation |

## 🔐 Unsafe Mode Caveat
`// @unsafe` lifts sandbox constraints, enabling prototype patches and direct engine access. Use only for experimentation; it can destabilize performance or break subsequent frames.

## 🧭 Roadmap Ideas
- Accessibility pass (ARIA roles, keyboard trapping in modals)
- MutationObserver-based element resolution for tutorials (replace retry polling)
- Adaptive quality scaler (auto adjust collision steps for frame time)
- Export/import custom scripts & type definitions

## 🧩 Contributing
Feel free to fork and adapt. If you add large features, consider documenting them in `README.md` and `scripting.html`.

## 📜 License
Specify your preferred license (e.g., MIT) here.

---
Enjoy experimenting and extending the particle sandbox!

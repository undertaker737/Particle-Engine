const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

let width = canvas.width;
let height = canvas.height;

// Gravity interpreted as acceleration (pixels / s^2)
// Adjustable: use [ and ] to decrease/increase; keys 1/2/3 set time-to-ground presets.
let gravity = 300; // was 60; higher => faster fall
const TARGET_FPS = 60;
const FRAME_DT = 1 / TARGET_FPS; // baseline seconds per frame
const MAX_SUBSTEP = FRAME_DT;    // max physics step size (clamps large dt)

// --- PARAMETERS ---
const PARTICLE_SIZE = 4;          // keep consistent with initParticles(size,...)
const PARTICLE_COUNT = 3000;      // consider reducing this for performance
const MIN_CELL_SIZE = 32;          // minimum grid cell size (safe default)
let gridMode = 'auto'; // auto | manual
let gridAutoFactor = 1.1; // scaling multiplier
let manualCellSize = 32; // manual override size
// ------------------

// Stability tuning
const VELOCITY_DAMPING = 0.999; // mild global damping each step
const MAX_SPEED = 1500;         // clamp to avoid explosive velocities
// Blob merge visualization
const DEFAULT_BLOB_THRESHOLD = 8; // lower threshold so blobs appear more readily
let blobThreshold = DEFAULT_BLOB_THRESHOLD; // active threshold when blobs enabled
const BLOB_ALPHA_BASE = 0.25;              // increased base opacity
const BLOB_ALPHA_PER_PARTICLE = 0.012;     // faster opacity growth
const BLOB_ALPHA_MAX = 0.8;                // higher max opacity
const BLOB_RADIUS_SCALE = 0.9; // reduced scale factor for tighter blobs
let blobExtraRadius = 0; // additive radius for blob visualization

let cellSize = Math.max(PARTICLE_SIZE * 2, MIN_CELL_SIZE);
let timeScale = 1; // multiplier for simulation speed
let collisionsEnabled = true;
let overlayEnabled = true;
let gridEnabled = false; // grid visualizer toggle
let blobsEnabled = true; // toggle blob merge visualization
let velocityColoring = false; // dynamic coloring by speed
let paused = false;
let forceStrength = 9001; // default force strength (it's over 9000!)
let forceRadius = 500; // synced with new UI default
let collisionPasses = 3; // default quality (matches High)
let warnedQuality = false; // swal warning shown flag (reset each reload)
let mouseX = 0, mouseY = 0;
let applyingForce = false;
let forceMode = 'pull'; // 'pull' or 'push'

// --- Worker / Multithreading State ---
let worker = null; // legacy single-worker (if SharedArrayBuffer unsupported)
let workerPool = []; // multi-worker pool
let poolActive = false;
let useWorker = false;         // worker disabled
let workerReady = false;      // single-worker ready flag
let poolReady = false;        // pool all ready
let workerPending = false;    // a collide job is in flight (single worker)
let particleBuffer = null;    // Float32Array backing store (serialized particles) or SharedArrayBuffer view
let elasticityBuffer = null;  // Float32Array for per-particle elasticity
const PARTICLE_STRIDE = 5;    // x,y,vx,vy,size
let sharedMode = false;       // using SharedArrayBuffer
let pendingRanges = 0;        // outstanding range jobs in pool
let lastCollisionFrame = 0;   // frames since last completed worker collision
const COLLISION_INTERVAL = 1; // run collisions every N frames when pooled (1 = every frame)
let snapshotBuffer = null; // snapshot state before dispatch for delta reconciliation

function canUseSharedArrayBuffer() {
    // Heuristic: presence of cross-origin isolation APIs / headers (simplified)
    return typeof SharedArrayBuffer !== 'undefined';
}

function initWorkerIfNeeded() {
    if (!useWorker) return;
    if (sharedMode) return; // pool handles
    if (worker) return;
    workerReady = false; workerPending = false;
    try {
        worker = new Worker('src/collisionWorker.js');
        worker.onmessage = (e) => {
            const data = e.data;
            if (data.type === 'ready') { workerReady = true; return; }
            if (data.type === 'collided') {
                const result = new Float32Array(data.particleArray.buffer || data.particleArray);
                applyCollisionDeltas(result);
                workerPending = false;
            }
        };
        worker.postMessage({ type: 'init' });
    } catch (err) {
        console.error('Worker init failed', err);
        terminateWorker();
    }
}

function initWorkerPool() {
    if (!useWorker || workerPool.length) return;
    if (!canUseSharedArrayBuffer()) return; // fallback to single worker
    sharedMode = true;
    // Determine pool size (leave one core)
    const hw = (navigator.hardwareConcurrency || 4);
    const poolSize = Math.min(Math.max(hw - 1, 1), 8);
    ensureParticleBuffers(true); // allocate SAB
    workerPool = [];
    pendingRanges = 0;
    poolReady = false;
    let readyCount = 0;
    for (let i = 0; i < poolSize; i++) {
        const w = new Worker('src/collisionWorker.js');
        w.onmessage = (e) => {
            const d = e.data;
            if (d.type === 'ready') {
                readyCount++;
                if (readyCount === poolSize) { poolReady = true; poolActive = true; }
                return;
            }
            if (d.type === 'rangeDone') {
                pendingRanges--;
                if (pendingRanges === 0) {
                    applyCollisionDeltas(particleBuffer);
                }
            }
        };
        w.postMessage({ type: 'initShared', particleBuffer: particleBuffer.buffer, elasticityBuffer: elasticityBuffer.buffer });
        workerPool.push(w);
    }
}

function terminateWorker() {
    if (worker) { worker.terminate(); worker = null; }
    workerReady = false; workerPending = false;
    for (const w of workerPool) w.terminate();
    workerPool = []; poolReady = false; poolActive = false; sharedMode = false; pendingRanges = 0;
}

function ensureParticleBuffers(shared = false) {
    const count = particles.length;
    const needed = count * PARTICLE_STRIDE;
    const hasSAB = (typeof SharedArrayBuffer !== 'undefined');
    if (shared && hasSAB) {
        if (!particleBuffer || !(particleBuffer.buffer instanceof SharedArrayBuffer) || particleBuffer.length !== needed) {
            particleBuffer = new Float32Array(new SharedArrayBuffer(needed * 4));
        }
        if (!elasticityBuffer || !(elasticityBuffer.buffer instanceof SharedArrayBuffer) || elasticityBuffer.length !== count) {
            elasticityBuffer = new Float32Array(new SharedArrayBuffer(count * 4));
        }
    } else {
        // Fallback: normal buffers; avoid referencing SharedArrayBuffer in instanceof if not present
        if (!particleBuffer || particleBuffer.length !== needed || (hasSAB && particleBuffer.buffer instanceof SharedArrayBuffer && !sharedMode)) {
            particleBuffer = new Float32Array(needed);
        }
        if (!elasticityBuffer || elasticityBuffer.length !== count || (hasSAB && elasticityBuffer.buffer instanceof SharedArrayBuffer && !sharedMode)) {
            elasticityBuffer = new Float32Array(count);
        }
        if (shared && !hasSAB) {
            // Requested shared but not available
            sharedMode = false; // downgrade
            if (useWorker) initWorkerIfNeeded();
        }
    }
}

function serializeParticlesIntoBuffer() {
    ensureParticleBuffers();
    for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const base = i * PARTICLE_STRIDE;
        particleBuffer[base] = p.x;
        particleBuffer[base + 1] = p.y;
        particleBuffer[base + 2] = p.vx;
        particleBuffer[base + 3] = p.vy;
        particleBuffer[base + 4] = p.size;
        elasticityBuffer[i] = p.elast;
    }
}

function applyCollisionDeltas(resultArray) {
    if (!snapshotBuffer) return;
    const count = Math.min(particles.length, Math.floor(resultArray.length / PARTICLE_STRIDE));
    for (let i = 0; i < count; i++) {
        const base = i * PARTICLE_STRIDE;
        const dx = resultArray[base]     - snapshotBuffer[base];
        const dy = resultArray[base + 1] - snapshotBuffer[base + 1];
        const dvx = resultArray[base + 2] - snapshotBuffer[base + 2];
        const dvy = resultArray[base + 3] - snapshotBuffer[base + 3];
        const p = particles[i];
        p.x += dx; p.y += dy; p.vx += dvx; p.vy += dvy;
    }
    snapshotBuffer = null;
}

function dispatchWorkerCollision(frameId) {
    if (!useWorker || !collisionsEnabled) return;
    if (sharedMode) {
        if (!poolReady || !poolActive) return;
        if ((frameId - lastCollisionFrame) < COLLISION_INTERVAL) return;
    // Serialize (writes object state into shared buffer)
    serializeParticlesIntoBuffer();
    snapshotBuffer = new Float32Array(particleBuffer); // snapshot
    // Partition rows among workers
        const widthPx = canvas.width;
        const heightPx = canvas.height;
        const inv = 1 / cellSize;
        const rows = Math.max(1, Math.floor(heightPx * inv));
        const band = Math.ceil(rows / workerPool.length);
        pendingRanges = 0;
        for (let i = 0; i < workerPool.length; i++) {
            const startRow = i * band;
            let endRow = Math.min(rows, startRow + band);
            if (startRow >= rows) break;
            pendingRanges++;
            workerPool[i].postMessage({
                type: 'collideRange',
                startRow,
                endRow,
                count: particles.length,
                cellSize,
                width: widthPx,
                height: heightPx,
                passes: collisionPasses
            });
        }
        lastCollisionFrame = frameId;
    } else {
        if (!worker || !workerReady || workerPending) return;
        serializeParticlesIntoBuffer();
        const sendCopy = particleBuffer.slice(0); // snapshot gets mutated by worker copy
        snapshotBuffer = sendCopy.slice(0);
        worker.postMessage({
            type: 'collide',
            particleArray: sendCopy,
            count: particles.length,
            elasticityArray: elasticityBuffer.slice(0),
            cellSize,
            width: canvas.width,
            height: canvas.height,
            passes: collisionPasses
        });
        workerPending = true;
    }
}

// Cell class
class Cell {
    constructor(row, column) {
        this.particles = [];
        this.row = row;
        this.column = column;
    }
    addParticle(particle) {
        this.particles.push(particle);
    }
    clearCell() {
        this.particles.length = 0;
    }
}

// initCells (use integer cols/rows)
function initCells(width, height, cellSize) {
    const cols = Math.max(1, Math.floor(width / cellSize));
    const rows = Math.max(1, Math.floor(height / cellSize));
    const cells = new Array(cols * rows);
    let idx = 0;
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            cells[idx++] = new Cell(r, c);
        }
    }
    return [cols, rows, cells];
}

let [cols, rows, cells] = initCells(width, height, cellSize);

// get cell coords (clamped)
function getCellCoords(particle) {
    let column = Math.floor(particle.x / cellSize);
    let row = Math.floor(particle.y / cellSize);
    // clamp to valid range (important when particle sits on border)
    column = Math.max(0, Math.min(column, cols - 1));
    row = Math.max(0, Math.min(row, rows - 1));
    return { row, column };
}
function computeCellSize(width, height, particleCount, particleSize) {
    const area = width * height;
    const avgParticlesPerCell = 6; // target density per cell
    const particleArea = Math.PI * particleSize * particleSize;
    // estimate effective particle spacing
    const spacing = Math.sqrt(area / particleCount);
    // cell size = max(diameter, spacing * adjustment)
    if (gridMode === 'manual') {
        return Math.max(particleSize * 2, manualCellSize);
    }
    return Math.max(particleSize * 2, spacing * gridAutoFactor);
}
function updateGrid() {
    cellSize = computeCellSize(width, height, PARTICLE_COUNT, PARTICLE_SIZE);
    [cols, rows, cells] = initCells(width, height, cellSize);
}

// Compute gravity needed so an object starting at y=0 reaches bottom in given time (ignoring collisions)
function gravityForDropTime(timeSeconds) {
    // s = 0.5 * g * t^2 => g = 2s / t^2, use canvas height as s
    return (2 * height) / (timeSeconds * timeSeconds);
}

function setGravityForDrop(timeSeconds) {
    gravity = gravityForDropTime(timeSeconds);
}

window.addEventListener("resize", () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    width = canvas.width;
    height = canvas.height;
    updateGrid();
});

// Keyboard controls for gravity tuning
document.addEventListener('keydown', (e) => {
    switch (e.key) {
        case '[': // decrease
            gravity = Math.max(10, gravity / 1.2);
            break;
        case ']': // increase
            gravity = Math.min(5000, gravity * 1.2);
            break;
        case '1': // slow (3s to ground)
            setGravityForDrop(3);
            break;
        case '2': // medium (2s)
            setGravityForDrop(2);
            break;
        case '3': // fast (1s)
            setGravityForDrop(1);
            break;
    }
});

updateGrid(); 


function getCellIndex(row, col) {
    if (row < 0 || col < 0 || row >= rows || col >= cols) return -1;
    return row * cols + col;
}

// Particle class (unchanged except slight clamp safety)
class Particle {
    constructor(x, y, vx, vy, size, color, elast) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.size = size;
        this.color = color;
        this.elast = elast;
        this.gravityScale = 1; // default multiplier
    }

    update(dt) {
        // Semi-implicit Euler
    const gScale = (typeof this.gravityScale === 'number' && !isNaN(this.gravityScale)) ? this.gravityScale : 1;
    this.vy += gravity * gScale * dt; // Apply scaled gravity
    this.x += this.vx * dt;
    this.y += this.vy * dt;

        // Bounce off walls (keep inside)
        if (this.x - this.size < 0) {
            this.x = this.size;
            this.vx *= -this.elast;
        } else if (this.x + this.size > canvas.width) {
            this.x = canvas.width - this.size;
            this.vx *= -this.elast;
        }
        if (this.y - this.size < 0) {
            this.y = this.size;
            this.vy *= -this.elast;
        } else if (this.y + this.size > canvas.height) {
            this.y = canvas.height - this.size;
            this.vy *= -this.elast;
        }
    }

    draw() {
        if (velocityColoring) {
            const spd = Math.hypot(this.vx, this.vy);
            // Map speed (0 -> MAX_SPEED) to hue (200 (blue) -> 0 (red))
            const t = Math.min(1, spd / MAX_SPEED);
            const hue = 200 * (1 - t); // 200->0
            const sat = 100; // percent
            const light = 55 - 25 * t; // 55% down to 30%
            ctx.fillStyle = `hsl(${hue.toFixed(0)} ${sat}% ${light.toFixed(0)}%)`;
        } else {
            ctx.fillStyle = this.color;
        }
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
    }
}

// Initialize particles
function initParticles(size, color, particleCount) {
    const particles = [];
    for (let i = 0; i < particleCount; i++) {
        const x = Math.random() * (canvas.width - 2 * size) + size;
        const y = Math.random() * (canvas.height - 2 * size) + size;
        const vx = (Math.random() - 0.5) * 2;
        const vy = (Math.random() - 0.5) * 2;
    const p = new Particle(x, y, vx, vy, size, color, 0.9);
    try { if(window.typeSystem){ const active = window.typeSystem.getActiveType && window.typeSystem.getActiveType(); if(active){ p.typeId = active.id; if(typeof active.gravityScale==='number') p.gravityScale = active.gravityScale; } } } catch(_){}
    particles.push(p);
    }
    return particles;
}
let particles = initParticles(PARTICLE_SIZE, "red", PARTICLE_COUNT);
// Expose for selection module
window.particles = particles;

function syncParticlesGlobal(){ window.particles = particles; }

// Collision resolution between two particles
function resolveCollision(p1, p2) {
    let dx = p2.x - p1.x;
    let dy = p2.y - p1.y;
    const minDist = p1.size + p2.size;
    const distSq = dx * dx + dy * dy;
    if (distSq === 0) {
        const j = 0.01;
        dx = j * (Math.random() - 0.5);
        dy = j * (Math.random() - 0.5);
    }
    if (distSq <= 0) return;
    const dist = Math.sqrt(distSq);
    if (dist >= minDist) return;
    const nx = dx / dist;
    const ny = dy / dist;
    // Equal mass positional correction (no extra amplification)
    const overlap = (minDist - dist) * 0.5; // distribute equally
    p1.x -= nx * overlap;
    p1.y -= ny * overlap;
    p2.x += nx * overlap;
    p2.y += ny * overlap;
    // Velocity impulse (inelastic / elastic)
    const dvx = p2.vx - p1.vx;
    const dvy = p2.vy - p1.vy;
    const vn = dvx * nx + dvy * ny;
    if (vn >= 0) return; // separating
    const restitution = Math.min(p1.elast, p2.elast);
    const impulse = -(1 + restitution) * vn * 0.5; // half for equal masses
    const ix = impulse * nx;
    const iy = impulse * ny;
    p1.vx -= ix; p1.vy -= iy;
    p2.vx += ix; p2.vy += iy;
}

// Handle collisions (includes same-cell pairs + forward neighbors)
function handleCollisions() {
    // Offsets to check: same cell, right, bottom-left, bottom, bottom-right
    const neighborOffsets = [
        [0, 0],
        [0, 1],
        [1, -1],
        [1, 0],
        [1, 1]
    ];

    for (let cell of cells) {
        if (!cell) continue;
        for (const [dr, dc] of neighborOffsets) {
            const nRow = cell.row + dr;
            const nCol = cell.column + dc;
            const nIdx = getCellIndex(nRow, nCol);
            if (nIdx === -1) continue;
            const neighbor = cells[nIdx];
            if (!neighbor) continue;

            if (dr === 0 && dc === 0) {
                // same cell: all unique pairs
                const list = cell.particles;
                for (let i = 0; i < list.length; i++) {
                    for (let j = i + 1; j < list.length; j++) {
                        resolveCollision(list[i], list[j]);
                    }
                }
            } else {
                // cross-cell pairs
                for (let p1 of cell.particles) {
                    for (let p2 of neighbor.particles) {
                        resolveCollision(p1, p2);
                    }
                }
            }
        }
    }
}

// Resize handling: recompute grid (keep cellSize based on particle size)
window.addEventListener("resize", () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    width = canvas.width;
    height = canvas.height;

    // recompute grid
    cellSize = Math.max(PARTICLE_SIZE * 2, MIN_CELL_SIZE);
    [cols, rows, cells] = initCells(width, height, cellSize);
});


// Animation loop
let lastTime = performance.now();
let accumulator = 0;
let fps = 0, accTime = 0, frames = 0;

function physicsStep(stepDt) {
    // Clear cells
    for (let cell of cells) { if (cell) cell.clearCell(); }

    // Integrate & assign cells
    let typeCache = null;
    if(window.typeSystem){
        const tArr = window.typeSystem.getTypes();
        typeCache = new Map(tArr.map(t=>[t.id, t]));
    }
    for (let p of particles) {
        if(typeCache && p.typeId){ const t=typeCache.get(p.typeId); if(t){ p.elast = t.elasticity; if(!velocityColoring) p.color = p.color || t.color; if(typeof t.gravityScale==='number') p.gravityScale = t.gravityScale; } }
        p.update(stepDt);
        if (applyingForce) {
            const dx = p.x - mouseX;
            const dy = p.y - mouseY;
            const distSq = dx*dx + dy*dy;
            const r = forceRadius;
            if (distSq < r*r && distSq > 0.0001) {
                const dist = Math.sqrt(distSq);
                const falloff = 1 - (dist / r);
                const nx = dx / dist;
                const ny = dy / dist;
                const dir = (forceMode === 'pull') ? -1 : 1;
                const accel = (forceStrength * falloff) / (p.size);
                p.vx += nx * accel * dir * stepDt;
                p.vy += ny * accel * dir * stepDt;
            }
        }
        const { row, column } = getCellCoords(p);
        const idx = getCellIndex(row, column);
        if (idx !== -1) cells[idx].addParticle(p);
        p.vx *= VELOCITY_DAMPING;
        p.vy *= VELOCITY_DAMPING;
        const spd = Math.hypot(p.vx, p.vy);
        if (spd > MAX_SPEED) {
            const s = MAX_SPEED / spd;
            p.vx *= s; p.vy *= s;
        }
    }
    if (collisionsEnabled) {
        for (let i = 0; i < collisionPasses; i++) handleCollisions();
    }
}

function animate(now) {
    // Frame dt (seconds)
    let frameDt = (now - lastTime) / 1000;
    if (frameDt > 0.25) frameDt = 0.25; // clamp if tab was inactive
    lastTime = now;
    if (!paused) accumulator += frameDt * timeScale;

    // FPS tracking
    accTime += frameDt; frames++;
    if (accTime >= 0.5) { fps = Math.round(frames / accTime); accTime = 0; frames = 0; }

    // Fixed-timestep stepping
    if (!paused) {
        while (accumulator >= MAX_SUBSTEP) {
            physicsStep(MAX_SUBSTEP);
            accumulator -= MAX_SUBSTEP;
        }
        if (accumulator > 0.00001) {
            physicsStep(accumulator); // final partial step
            accumulator = 0;
        }
    }

    // Render
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Track particles hidden by blobs
    let hiddenParticles = null;
    // Pass 1: draw merge blobs for dense cells (neighborhood based)
    try {
        if (blobsEnabled) {
            const minForBlob = blobThreshold;
            hiddenParticles = new Set();
                        for (let cell of cells) {
                if (!cell) continue;
                // Gather particles from 3x3 neighborhood (cell + 8 neighbors)
                const neighborhood = [];
                for (let dr = -1; dr <= 1; dr++) {
                    for (let dc = -1; dc <= 1; dc++) {
                        const nIdx = getCellIndex(cell.row + dr, cell.column + dc);
                        if (nIdx === -1) continue;
                        const nCell = cells[nIdx];
                        if (!nCell || !nCell.particles.length) continue;
                        // push references (no copies needed)
                                                for (let p of nCell.particles) {
                                                    if(!window.typeSystem || window.typeSystem.isParticleBlobEligible(p)) neighborhood.push(p);
                                                }
                    }
                }
                if (neighborhood.length < minForBlob) continue;
                // Mark particles to hide their individual rendering
                for (let p of neighborhood) hiddenParticles.add(p);
                // Compute centroid
                let sx = 0, sy = 0;
                for (let p of neighborhood) { sx += p.x; sy += p.y; }
                const cx = sx / neighborhood.length;
                const cy = sy / neighborhood.length;
                // Average radial extent
                let avg = 0;
                for (let p of neighborhood) avg += Math.hypot(p.x - cx, p.y - cy) + p.size * 0.5;
                avg /= neighborhood.length;
                const radius = Math.max(5, Math.min(220, avg * BLOB_RADIUS_SCALE * (blobRadiusScaleMultiplier || 1) + (blobExtraRadius || 0)));
                if (velocityColoring) {
                    // Average speed for neighborhood
                    let speedSum = 0;
                    for (let p of neighborhood) speedSum += Math.hypot(p.vx, p.vy);
                    const avgSpeed = speedSum / neighborhood.length;
                    const t = Math.min(1, avgSpeed / MAX_SPEED);
                    const hue = 200 * (1 - t);
                    const sat = 100;
                    const light = 55 - 25 * t;
                    ctx.fillStyle = `hsl(${hue.toFixed(0)} ${sat}% ${light.toFixed(0)}%)`;
                } else {
                    let baseColor = (neighborhood[0] && neighborhood[0].color) ? neighborhood[0].color : '#ffffff';
                    function parseColor(c) {
                        let r=255,g=255,b=255;
                        if (typeof c !== 'string') return {r,g,b};
                        if (c.startsWith('#')) {
                            if (c.length === 4) { c = '#' + c[1]+c[1]+c[2]+c[2]+c[3]+c[3]; }
                            if (c.length === 7) {
                                r = parseInt(c.slice(1,3),16);
                                g = parseInt(c.slice(3,5),16);
                                b = parseInt(c.slice(5,7),16);
                                return {r,g,b};
                            }
                        }
                        const tmp = document.createElement('canvas').getContext('2d');
                        try { tmp.fillStyle = c; const std = tmp.fillStyle; if (std.startsWith('#')) { return parseColor(std); } } catch(_) {}
                        return {r,g,b};
                    }
                    const {r,g,b} = parseColor(baseColor);
                    ctx.fillStyle = `rgb(${r},${g},${b})`;
                }
                ctx.beginPath();
                ctx.arc(cx, cy, radius, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    } catch(_e) {}
    // Pass 2: draw particles on top (skip those merged into blobs)
    if (hiddenParticles) {
        for (let p of particles) { if (!hiddenParticles.has(p)) p.draw(); }
    } else {
        for (let p of particles) p.draw();
    }

    // Overlay
    ctx.fillStyle = 'white';
    ctx.font = '14px monospace';
    if (overlayEnabled) {
        ctx.fillText(`FPS: ${fps}`, 10, 20);
        ctx.fillText(`Particles: ${particles.length}`, 10, 40);
        ctx.fillText(`Gravity: ${gravity.toFixed(1)}`, 10, 60);
        ctx.fillText(`TimeScale: ${timeScale.toFixed(2)}`, 10, 80);
        ctx.fillText(paused ? 'PAUSED' : '', 10, 100);
    }
    if (gridEnabled) {
        ctx.save();
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.beginPath();
        for (let c = 0; c <= cols; c++) {
            const x = Math.floor(c * cellSize) + 0.5;
            ctx.moveTo(x, 0);
            ctx.lineTo(x, canvas.height);
        }
        for (let r = 0; r <= rows; r++) {
            const y = Math.floor(r * cellSize) + 0.5;
            ctx.moveTo(0, y);
            ctx.lineTo(canvas.width, y);
        }
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.font = '10px monospace';
        for (let cell of cells) {
            if (!cell) continue;
            const n = cell.particles.length;
            if (n >= blobThreshold) {
                const x = cell.column * cellSize + 4;
                const y = cell.row * cellSize + 12;
                ctx.fillText(n.toString(), x, y);
            }
        }
        ctx.restore();
    }
    requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
// Zoom & stats rendering loop (separate RAF to avoid touching main loop)
function renderZoomAndStats() {
    if (!zoomEnabled || !zoomCtx) return;
    let cx = zoomFollow ? mouseX : zoomAnchorX;
    let cy = zoomFollow ? mouseY : zoomAnchorY;
    const half = zoomRegionSize / 2;
    const sx = Math.max(0, Math.min(canvas.width - zoomRegionSize, cx - half));
    const sy = Math.max(0, Math.min(canvas.height - zoomRegionSize, cy - half));
    zoomCtx.save();
    zoomCtx.clearRect(0,0,zoomCanvas.width, zoomCanvas.height);
    zoomCtx.imageSmoothingEnabled = false;
    try { zoomCtx.drawImage(canvas, sx, sy, zoomRegionSize, zoomRegionSize, 0, 0, zoomCanvas.width, zoomCanvas.height); } catch(_) {}
    zoomCtx.restore();
    // Stats aggregation
    const maxX = sx + zoomRegionSize;
    const maxY = sy + zoomRegionSize;
    let count = 0, speedSum = 0, rSum=0,gSum=0,bSum=0;
    for (let p of particles) {
        if (p.x >= sx && p.x <= maxX && p.y >= sy && p.y <= maxY) {
            count++;
            speedSum += Math.hypot(p.vx, p.vy);
            let c = p.color || '#ffffff';
            if (c.startsWith('#')) {
                if (c.length === 4) c = '#' + c[1]+c[1]+c[2]+c[2]+c[3]+c[3];
                if (c.length === 7) { rSum += parseInt(c.slice(1,3),16); gSum += parseInt(c.slice(3,5),16); bSum += parseInt(c.slice(5,7),16); }
            }
        }
    }
    const area = zoomRegionSize * zoomRegionSize;
    if (statCount) statCount.textContent = `Particles: ${count}`;
    if (statDensity) statDensity.textContent = `Density: ${(count/area*1000).toFixed(2)}`;
    if (statAvgSpeed) statAvgSpeed.textContent = `Avg Speed: ${count? (speedSum/count).toFixed(1):'0.0'}`;
    if (statAvgColorSwatch && count) {
        const r = Math.round(rSum / count), g = Math.round(gSum / count), b = Math.round(bSum / count);
        statAvgColorSwatch.style.background = `rgb(${r},${g},${b})`;
    }
}
function zoomLoop(){ renderZoomAndStats(); requestAnimationFrame(zoomLoop); }
requestAnimationFrame(zoomLoop);

// ---------------- Control Panel Wiring ----------------
const gravityRange = document.getElementById('gravityRange');
const gravityValue = document.getElementById('gravityValue');
const countRange = document.getElementById('countRange');
const countValue = document.getElementById('countValue');
const sizeRange = document.getElementById('sizeRange');
const sizeValue = document.getElementById('sizeValue');
const elasticRange = document.getElementById('elasticRange');
const elasticValue = document.getElementById('elasticValue');
const timeScaleRange = document.getElementById('timeScaleRange');
const timeScaleValue = document.getElementById('timeScaleValue');
const colorInput = document.getElementById('colorInput');
const collisionToggle = document.getElementById('collisionToggle');
const overlayToggle = document.getElementById('overlayToggle');
const gridToggle = document.getElementById('gridToggle'); // legacy (may not exist)
const gridToggleBtn = document.getElementById('gridToggleBtn');
const resetBtn = document.getElementById('resetBtn');
const randomizeBtn = document.getElementById('randomizeBtn');
const pauseBtn = document.getElementById('pauseBtn');
const togglePanelBtn = document.getElementById('togglePanel');
const themeToggleBtn = document.getElementById('themeToggle');
const panelBody = document.querySelector('#controlPanel .panel-body');
const forceRange = document.getElementById('forceRange');
const forceValue = document.getElementById('forceValue');
const radiusRange = document.getElementById('radiusRange');
const radiusValue = document.getElementById('radiusValue');
const qualitySelect = document.getElementById('qualitySelect');
const qualityValue = document.getElementById('qualityValue');
const presetSelect = document.getElementById('presetSelect');
const blobDensitySelect = document.getElementById('blobDensitySelect');
const blobThresholdRange = document.getElementById('blobThresholdRange');
const blobThresholdValue = document.getElementById('blobThresholdValue');
const blobThresholdRow = document.getElementById('blobThresholdRow');
const blobRadiusExtraRange = document.getElementById('blobRadiusExtraRange');
const blobRadiusExtraValue = document.getElementById('blobRadiusExtraValue');
const velocityColorToggle = document.getElementById('velocityColorToggle');
const gridModeSelect = document.getElementById('gridModeSelect');
const gridModeValue = document.getElementById('gridModeValue');
const gridSizeInput = document.getElementById('gridSizeInput');
const gridFactorSelect = document.getElementById('gridFactorSelect');
const manualGridSizeRow = document.getElementById('manualGridSizeRow');
const gridFactorRow = document.getElementById('gridFactorRow');
const advancedSection = document.getElementById('advancedSection');
const advToggle = document.getElementById('advToggle');
const zoomPanel = document.getElementById('zoomPanel');
const toggleZoomPanel = document.getElementById('toggleZoomPanel');
// Zoom panel elements
const zoomEnableToggle = document.getElementById('zoomEnableToggle');
const zoomFollowToggle = document.getElementById('zoomFollowToggle');
const zoomSizeRange = document.getElementById('zoomSizeRange');
const zoomSizeValue = document.getElementById('zoomSizeValue');
const zoomScaleRange = document.getElementById('zoomScaleRange');
const zoomScaleValue = document.getElementById('zoomScaleValue');
const zoomCanvas = document.getElementById('zoomCanvas');
const zoomCtx = zoomCanvas ? zoomCanvas.getContext('2d') : null;
const statCount = document.getElementById('statCount');
const statDensity = document.getElementById('statDensity');
const statAvgSpeed = document.getElementById('statAvgSpeed');
const statAvgColorSwatch = document.getElementById('zoomAvgColorSwatch');
let zoomEnabled = false;
let zoomFollow = true;
let zoomRegionSize = 150;
let zoomFactor = 2;
let zoomAnchorX = 0;
let zoomAnchorY = 0;
// workerToggle removed from UI

function refreshUI() {
    if (gravityRange) gravityRange.value = gravity.toFixed(0);
    if (gravityValue) gravityValue.textContent = gravity.toFixed(0);
    if (countRange) countValue.textContent = particles.length.toString();
    if (sizeRange) sizeValue.textContent = PARTICLE_SIZE.toString();
    if (elasticRange) elasticValue.textContent = particles[0]?.elast.toFixed(2);
    if (timeScaleRange) timeScaleValue.textContent = timeScale.toFixed(2);
    if (forceRange) { forceRange.max = '50000'; forceRange.value = forceStrength; forceValue.textContent = forceStrength.toString(); }
    if (radiusRange) { radiusRange.max = '2000'; radiusRange.value = forceRadius; radiusValue.textContent = forceRadius.toString(); }
    if (qualitySelect) { qualitySelect.value = String(collisionPasses); qualityValue.textContent = collisionPasses.toString(); }
    if (blobDensitySelect) {
        blobDensitySelect.value = blobsEnabled ? '1' : '0';
    }
    if (blobThresholdRow) blobThresholdRow.style.display = blobsEnabled ? 'block' : 'none';
    if (blobThresholdRange && blobThresholdValue) {
        blobThresholdRange.value = String(blobThreshold);
        blobThresholdValue.textContent = blobThreshold.toString();
    }
    if (blobRadiusExtraRange && blobRadiusExtraValue) {
        blobRadiusExtraRange.value = String(blobExtraRadius);
        blobRadiusExtraValue.textContent = blobExtraRadius.toString();
    }
    if (gridModeSelect) {
        gridModeSelect.value = gridMode;
        if (gridModeValue) gridModeValue.textContent = gridMode === 'auto' ? 'Auto' : 'Manual';
    }
    if (gridSizeInput) gridSizeInput.value = manualCellSize.toString();
    if (gridFactorSelect) gridFactorSelect.value = String(gridAutoFactor);
    if (manualGridSizeRow) manualGridSizeRow.style.display = (gridMode === 'manual') ? 'block' : 'none';
    if (gridFactorRow) gridFactorRow.style.display = (gridMode === 'auto') ? 'block' : 'none';
    if (zoomSizeValue) zoomSizeValue.textContent = zoomRegionSize.toString();
    if (zoomScaleValue) zoomScaleValue.textContent = zoomFactor.toFixed(1);
}
refreshUI();
// Initialize blob enablement from dropdown if present
if (typeof document !== 'undefined') {
    const sel = document.getElementById('blobDensitySelect');
    if (sel) {
        blobsEnabled = sel.value === '1';
        blobThreshold = blobsEnabled ? DEFAULT_BLOB_THRESHOLD : Number.MAX_SAFE_INTEGER;
    }
}
    gridModeSelect?.addEventListener('change', e => {
        gridMode = e.target.value;
        refreshUI();
        updateGrid();
    });
    gridSizeInput?.addEventListener('input', e => {
        manualCellSize = Math.max(8, Math.min(512, parseInt(e.target.value,10)||32));
        if (gridMode === 'manual') updateGrid();
    });
    gridFactorSelect?.addEventListener('change', e => {
        gridAutoFactor = parseFloat(e.target.value) || 1.1;
        if (gridMode === 'auto') updateGrid();
    });

gravityRange?.addEventListener('input', e => {
    gravity = parseFloat(e.target.value);
    gravityValue.textContent = gravity.toFixed(0);
});

timeScaleRange?.addEventListener('input', e => {
    timeScale = parseFloat(e.target.value);
    timeScaleValue.textContent = timeScale.toFixed(2);
});

countRange?.addEventListener('input', e => {
    let newCount = parseInt(e.target.value, 10);
    const diff = newCount - particles.length;
    if (diff > 0) {
        // add particles
        for (let i = 0; i < diff; i++) {
            const x = Math.random() * (canvas.width - 2 * PARTICLE_SIZE) + PARTICLE_SIZE;
            const y = Math.random() * (canvas.height - 2 * PARTICLE_SIZE) + PARTICLE_SIZE;
            const vx = (Math.random() - 0.5) * 2;
            const vy = (Math.random() - 0.5) * 2;
                        const p = new Particle(x, y, vx, vy, PARTICLE_SIZE, colorInput.value, particles[0]?.elast || 0.9);
                        try { if(window.typeSystem){ const active = window.typeSystem.getActiveType && window.typeSystem.getActiveType(); if(active){ p.typeId = active.id; if(typeof active.gravityScale==='number') p.gravityScale = active.gravityScale; } } } catch(_){}
                        particles.push(p);
                        // Attach to active type if exists
                        if(window.typeSystem){
                            const types = window.typeSystem.getTypes();
                            const active = window.typeSystem.getActiveType && window.typeSystem.getActiveType();
                            let targetId = active?.id || 1;
                            p.typeId = targetId;
                        }
        }
    } else if (diff < 0) {
        particles.length = newCount; // truncate
    }
    countValue.textContent = particles.length.toString();
    // Reallocate buffers if using worker
    if (useWorker) {
        particleBuffer = null;
        elasticityBuffer = null;
    }
});

sizeRange?.addEventListener('input', e => {
    const newSize = parseInt(e.target.value, 10);
    for (let p of particles) p.size = newSize;
    sizeValue.textContent = newSize.toString();
});

elasticRange?.addEventListener('input', e => {
    const val = parseFloat(e.target.value);
    for (let p of particles) p.elast = val;
    elasticValue.textContent = val.toFixed(2);
});

colorInput?.addEventListener('input', e => {
    const col = e.target.value;
    for (let p of particles) p.color = col;
});
velocityColorToggle?.addEventListener('change', e => {
    velocityColoring = e.target.checked;
});

forceRange?.addEventListener('input', e => {
    forceStrength = parseFloat(e.target.value);
    forceValue.textContent = forceStrength.toString();
});

radiusRange?.addEventListener('input', e => {
    forceRadius = parseFloat(e.target.value);
    radiusValue.textContent = forceRadius.toString();
});

collisionToggle?.addEventListener('change', e => {
    collisionsEnabled = e.target.checked;
});

qualitySelect?.addEventListener('change', e => {
    const val = parseInt(e.target.value, 10);
    collisionPasses = val;
    qualityValue.textContent = String(val);
    if (val >= 5 && !warnedQuality && typeof Swal !== 'undefined') {
        warnedQuality = true; // no persistence
        Swal.fire({
            icon: 'warning',
            title: 'High Collision Quality',
            html: 'Higher collision quality increases CPU usage. Ultra (10 passes) can severely impact performance or crash the tab with many particles.',
            confirmButtonText: 'Understood'
        });
    }
});

blobDensitySelect?.addEventListener('change', e => {
    const mode = e.target.value; // '0' or '1'
    blobsEnabled = (mode === '1');
    blobThreshold = blobsEnabled ? DEFAULT_BLOB_THRESHOLD : Number.MAX_SAFE_INTEGER;
    if (blobThresholdRow) blobThresholdRow.style.display = blobsEnabled ? 'block' : 'none';
});
let blobRadiusScaleMultiplier = 1.0; // constant now
blobThresholdRange?.addEventListener('input', e => {
    const v = parseInt(e.target.value, 10);
    if (!isNaN(v)) blobThreshold = v;
    if (blobThresholdValue) blobThresholdValue.textContent = blobThreshold.toString();
});
blobRadiusExtraRange?.addEventListener('input', e => {
    blobExtraRadius = parseInt(e.target.value, 10) || 0;
    if (blobRadiusExtraValue) blobRadiusExtraValue.textContent = blobExtraRadius.toString();
});
// ------------- Preset System -------------
const PRESETS = {
    lightSpray: {
        label: 'Light Spray',
        params: {
            gravity: 150,
            particleCount: 1200,
            size: 4,
            elasticity: 0.85,
            collisionPasses: 2,
            blobs: false,
            blobThreshold: 999999,
            forceStrength: 9001,
            forceRadius: 500,
            velocityJitter: 150
        }
    },
    denseFluid: {
        label: 'Dense Fluid',
        params: {
            gravity: 200,
            particleCount: 5000,
            size: 5,
            elasticity: 0.5,
            collisionPasses: 5,
            blobs: true,
            blobThreshold: 10,
            forceStrength: 9001,
            forceRadius: 500,
            velocityJitter: 40
        }
    },
    gasCloud: {
        label: 'Gas Cloud',
        params: {
            gravity: 20,
            particleCount: 4000,
            size: 3,
            elasticity: 0.95,
            collisionPasses: 1,
            blobs: true,
            blobThreshold: 25,
            forceStrength: 9001,
            forceRadius: 500,
            velocityJitter: 80
        }
    },
    heavyRain: {
        label: 'Heavy Rain',
        params: {
            gravity: 1400,
            particleCount: 3500,
            size: 3,
            elasticity: 0.3,
            collisionPasses: 2,
            blobs: false,
            blobThreshold: 999999,
            forceStrength: 9001,
            forceRadius: 500,
            velocityJitter: 500,
            initialVelocity: { x: 0, y: 600 }
        }
    },
    lavaPool: {
        label: 'Lava Pool',
        params: {
            gravity: 90,
            particleCount: 2800,
            size: 6,
            elasticity: 0.2,
            collisionPasses: 6,
            blobs: true,
            blobThreshold: 6,
            forceStrength: 9001,
            forceRadius: 500,
            velocityJitter: 20,
            color: '#ff5a00'
        }
    },
    explosion: {
        label: 'Explosion Demo',
        params: {
            gravity: 50,
            particleCount: 2000,
            size: 4,
            elasticity: 0.4,
            collisionPasses: 3,
            blobs: false,
            blobThreshold: 999999,
            forceStrength: 9001,
            forceRadius: 500,
            velocityJitter: 900,
            radialBurst: true
        }
    }
};

function applyPreset(key) {
    const preset = PRESETS[key];
    if (!preset) return;
    const p = preset.params;
    gravity = p.gravity ?? gravity;
    // particle count adjustment
    const targetCount = p.particleCount ?? particles.length;
    if (targetCount !== particles.length) {
        countRange.value = String(targetCount);
        const diff = targetCount - particles.length;
        if (diff > 0) {
            for (let i = 0; i < diff; i++) {
                const x = Math.random() * (canvas.width - 2 * PARTICLE_SIZE) + PARTICLE_SIZE;
                const y = Math.random() * (canvas.height - 2 * PARTICLE_SIZE) + PARTICLE_SIZE;
                const vx = (Math.random() - 0.5) * (p.velocityJitter ?? 2);
                const vy = (Math.random() - 0.5) * (p.velocityJitter ?? 2);
                const np = new Particle(
                    x,
                    y,
                    vx,
                    vy,
                    (p.size ?? PARTICLE_SIZE),
                    (p.color || colorInput.value),
                    (p.elasticity ?? (particles[0]?.elast || 0.9))
                );
                try { if(window.typeSystem){ const active = window.typeSystem.getActiveType && window.typeSystem.getActiveType(); if(active){ np.typeId = active.id; if(typeof active.gravityScale==='number') np.gravityScale = active.gravityScale; } } } catch(_){}
                particles.push(np);
            }
        } else if (diff < 0) {
            particles.length = targetCount;
        }
        syncParticlesGlobal();
    }
    // resize existing
    if (p.size) { for (let pt of particles) pt.size = p.size; sizeRange.value = String(p.size); }
    if (p.elasticity !== undefined) { for (let pt of particles) pt.elast = p.elasticity; elasticRange.value = String(p.elasticity); }
    collisionPasses = p.collisionPasses ?? collisionPasses;
    qualitySelect.value = String(collisionPasses); qualityValue.textContent = String(collisionPasses);
    blobsEnabled = !!p.blobs;
    blobDensitySelect.value = blobsEnabled ? '1' : '0';
    blobThreshold = p.blobThreshold ?? blobThreshold;
    blobThresholdRange.value = String(Math.min(blobThresholdRange.max, blobThreshold));
    blobThresholdValue.textContent = blobThreshold.toString();
    if (p.forceStrength !== undefined) { forceStrength = p.forceStrength; forceRange.value = String(forceStrength); }
    if (p.forceRadius !== undefined) { forceRadius = p.forceRadius; radiusRange.value = String(forceRadius); }
    if (p.color) { colorInput.value = p.color; for (let pt of particles) pt.color = p.color; }
    // special behaviors
    if (p.radialBurst) {
        const cx = canvas.width / 2, cy = canvas.height / 2;
    for (let pt of particles) {
            const ang = Math.random() * Math.PI * 2;
            const sp = (Math.random() * 0.5 + 0.5) * (p.velocityJitter ?? 300);
            pt.x = cx; pt.y = cy; pt.vx = Math.cos(ang) * sp; pt.vy = Math.sin(ang) * sp;
        }
    syncParticlesGlobal();
    } else if (p.initialVelocity) {
        for (let pt of particles) { pt.vx += p.initialVelocity.x; pt.vy += p.initialVelocity.y; }
    }
    refreshUI();
}

presetSelect?.addEventListener('change', e => {
    const key = e.target.value;
    if (key === 'custom') return; // keep current settings
    applyPreset(key);
    if(window.typeSystem) window.typeSystem.rebuild();
});
zoomEnableToggle?.addEventListener('change', e => { zoomEnabled = e.target.checked; });
zoomFollowToggle?.addEventListener('change', e => { zoomFollow = e.target.checked; });
zoomSizeRange?.addEventListener('input', e => { zoomRegionSize = parseInt(e.target.value,10)||zoomRegionSize; if (zoomSizeValue) zoomSizeValue.textContent = zoomRegionSize.toString(); });
zoomScaleRange?.addEventListener('input', e => { zoomFactor = parseFloat(e.target.value)||zoomFactor; if (zoomScaleValue) zoomScaleValue.textContent = zoomFactor.toFixed(1); });
zoomCanvas?.addEventListener('mousemove', e => {
    if (!zoomEnabled || zoomFollow) return;
    const rect = zoomCanvas.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    zoomAnchorX = nx * canvas.width;
    zoomAnchorY = ny * canvas.height;
});
// No persistence: always false on load

// Initialize worker pool or single worker immediately
if (canUseSharedArrayBuffer()) {
    sharedMode = true;
    ensureParticleBuffers(true);
    initWorkerPool();
} else {
    sharedMode = false;
    initWorkerIfNeeded();
}

overlayToggle?.addEventListener('change', e => {
    overlayEnabled = e.target.checked;
});
gridToggle?.addEventListener('change', e => { gridEnabled = e.target.checked; });
gridToggleBtn?.addEventListener('click', () => {
    gridEnabled = !gridEnabled;
    gridToggleBtn.textContent = gridEnabled ? 'Grid On' : 'Grid Off';
});

resetBtn?.addEventListener('click', () => {
    particles = initParticles(PARTICLE_SIZE, colorInput.value, parseInt(countRange.value, 10));
    syncParticlesGlobal();
    if(window.typeSystem) window.typeSystem.rebuild();
    refreshUI();
});

randomizeBtn?.addEventListener('click', () => {
    for (let p of particles) {
        p.vx = (Math.random() - 0.5) * 2;
        p.vy = (Math.random() - 0.5) * 2;
    }
});

pauseBtn?.addEventListener('click', () => {
    paused = !paused;
    pauseBtn.textContent = paused ? 'Resume' : 'Pause';
});

togglePanelBtn?.addEventListener('click', () => {
    const panel = document.getElementById('controlPanel');
    if (!panel) return;
    const collapsed = panel.classList.toggle('collapsed');
    togglePanelBtn.textContent = collapsed ? '+' : '−';
});

themeToggleBtn?.addEventListener('click', () => {
    const light = document.body.classList.toggle('theme-light');
    themeToggleBtn.textContent = light ? '☾' : '☀';
});
advToggle?.addEventListener('click', () => {
    if (!advancedSection) return;
    const collapsed = advancedSection.classList.toggle('collapsed');
    // Text only (arrow handled via CSS ::after)
    advToggle.textContent = 'Advanced';
});
toggleZoomPanel?.addEventListener('click', () => {
    if (!zoomPanel) return;
    const collapsed = zoomPanel.classList.toggle('collapsed');
    toggleZoomPanel.textContent = collapsed ? '+' : '−';
});

// Draggable zoom panel
(function enableZoomPanelDrag(){
    if (!zoomPanel) return;
    const header = zoomPanel.querySelector('.panel-header');
    if (!header) return;
    let drag=false, sx=0, sy=0, startLeft=0, startTop=0;
    let lockedWidth=null, lockedHeight=null;
    header.addEventListener('mousedown', (e)=>{
        if (e.target === toggleZoomPanel) return;
        drag = true; sx = e.clientX; sy = e.clientY;
        const rect = zoomPanel.getBoundingClientRect();
        startLeft = rect.left; startTop = rect.top;
        // Lock size to prevent reflow jitter
        lockedWidth = rect.width; lockedHeight = rect.height;
        zoomPanel.style.width = lockedWidth + 'px';
        zoomPanel.style.height = lockedHeight + 'px';
        document.body.style.userSelect='none';
    });
    window.addEventListener('mousemove', (e)=>{
        if (!drag) return;
        const dx = e.clientX - sx, dy = e.clientY - sy;
        // Clamp within viewport
        const W = window.innerWidth, H = window.innerHeight;
        const w = lockedWidth || zoomPanel.offsetWidth; const h = lockedHeight || zoomPanel.offsetHeight;
        let nx = startLeft + dx; let ny = startTop + dy;
        nx = Math.max(6, Math.min(nx, W - w - 6));
        ny = Math.max(6, Math.min(ny, H - h - 6));
    zoomPanel.style.left = Math.round(nx) + 'px';
    zoomPanel.style.top = Math.round(ny) + 'px';
        // remove right positioning if moving horizontally
        zoomPanel.style.right = 'auto';
    });
    window.addEventListener('mouseup', ()=>{ 
        if (!drag) return;
        drag=false; document.body.style.userSelect='';
        // Restore auto sizing
        zoomPanel.style.height = '';
        zoomPanel.style.width = '';
        lockedWidth = lockedHeight = null;
    });
})();

// Modify collision application check
const originalHandleCollisions = handleCollisions;
handleCollisions = function() {
    if (!collisionsEnabled) return; // skip resolving
    originalHandleCollisions();
};

// -------------- Mouse interaction (pull / push) --------------
canvas.addEventListener('mousedown', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    applyingForce = true;
    forceMode = e.button === 2 ? 'push' : 'pull';
});
canvas.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
});
canvas.addEventListener('mouseup', () => { applyingForce = false; });
canvas.addEventListener('mouseleave', () => { applyingForce = false; });
canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); });

// -------------- Draggable Panel --------------
(function enablePanelDrag(){
    const panel = document.getElementById('controlPanel');
    const header = panel?.querySelector('.panel-header');
    if (!panel || !header) return;
    let drag = false; let sx=0, sy=0; let startLeft=0, startTop=0; let lockedWidth=null, lockedHeight=null;
    header.addEventListener('mousedown', (e)=>{
        if (e.target === togglePanelBtn) return; // don't start drag on toggle button
        drag = true; sx = e.clientX; sy = e.clientY;
        const rect = panel.getBoundingClientRect();
        startLeft = rect.left; startTop = rect.top;
        // Lock current size to avoid layout shifts while dragging
        lockedWidth = rect.width; lockedHeight = rect.height;
        panel.style.width = lockedWidth + 'px';
        panel.style.height = lockedHeight + 'px';
        document.body.style.userSelect = 'none';
    });
    window.addEventListener('mousemove', (e)=>{
        if (!drag) return;
        const dx = e.clientX - sx; const dy = e.clientY - sy;
        const W = window.innerWidth, H = window.innerHeight;
        const w = lockedWidth || panel.offsetWidth; const h = lockedHeight || panel.offsetHeight;
        let nx = startLeft + dx; let ny = startTop + dy;
        nx = Math.max(6, Math.min(nx, W - w - 6));
        ny = Math.max(6, Math.min(ny, H - h - 6));
    panel.style.left = Math.round(nx) + 'px';
    panel.style.top = Math.round(ny) + 'px';
        // Ensure left/top positioning dominates
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
    });
    window.addEventListener('mouseup', ()=>{ 
        if (!drag) return;
        drag = false; document.body.style.userSelect=''; 
        // Restore natural sizing
        panel.style.width = '';
        panel.style.height = '';
        lockedWidth = lockedHeight = null;
    });
})();
const sliders = document.querySelectorAll('input[type=range]');
sliders.forEach(slider => {
  const updateSlider = () => {
    const val = (slider.value - slider.min) / (slider.max - slider.min) * 100;
    slider.style.background = `linear-gradient(to right, #fff 0%, #fff ${val}%, #333 ${val}%, #333 100%)`;
  };
  slider.addEventListener('input', updateSlider);
  updateSlider(); // initialize
});
const capacityBtn = document.getElementById('capacityBtn');
capacityBtn?.addEventListener('click', () => {
    if (!countRange) return;
    // Simple adaptive search to estimate max particles sustaining ~60 FPS.
    // Heuristic: attempt exponential growth until FPS drops below target threshold, then binary refine.
    const targetFps = 60;
    const minFps = 57; // acceptable lower bound
    const originalCount = particles.length;
    const testSize = particles[0]?.size || PARTICLE_SIZE;
    const testElastic = particles[0]?.elast || 0.9;
    let low = 500; // guaranteed feasible baseline
    let high = Math.min(30000, Math.max(low * 2, originalCount));

    function setCount(n) {
        particles = initParticles(testSize, colorInput.value, n);
        countRange.value = String(n);
        countValue.textContent = String(n);
    }

    function measure(frames = 18) { // ~0.3s @60fps
        return new Promise(resolve => {
            let collected = 0; let sum = 0; let last = performance.now();
            function tick(now) {
                const dt = now - last; last = now;
                const instFps = 1000 / dt;
                sum += instFps; collected++;
                if (collected >= frames) {
                    resolve(sum / collected);
                } else {
                    requestAnimationFrame(tick);
                }
            }
            requestAnimationFrame(tick);
        });
    }

    async function exponentialFind() {
        // Grow until below minFps or cap reached
        let n = low;
        setCount(n);
        await measure(10); // warm
        while (n < high) {
            const fpsNow = await measure(14);
            if (fpsNow < minFps) { high = n; break; }
            low = n;
            n = Math.min(high, Math.floor(n * 1.6));
            setCount(n);
        }
        if (low === high) high = low + 200; // ensure range
    }

    async function binaryRefine() {
        while (high - low > 300) { // resolution
            const mid = Math.floor((low + high) / 2);
            setCount(mid);
            const fpsNow = await measure(18);
            if (fpsNow >= minFps) low = mid; else high = mid - 1;
        }
    }

    (async () => {
        capacityBtn.disabled = true; capacityBtn.textContent = 'Measuring...';
        const prevPaused = paused; paused = false; // ensure running
        await exponentialFind();
        await binaryRefine();
        // Final fine tune around low upwards
        let best = low; let bestFps = 0;
        for (let n = Math.max(500, low - 400); n <= low + 400; n += 200) {
            if (n < 100) continue;
            setCount(n);
            const f = await measure(14);
            if (f > bestFps && f >= minFps) { bestFps = f; best = n; }
        }
        setCount(best);
        paused = prevPaused;
        capacityBtn.textContent = 'Capacity: ' + best;
        setTimeout(() => { capacityBtn.textContent = 'Auto Capacity'; capacityBtn.disabled = false; }, 4000);
    })();
});

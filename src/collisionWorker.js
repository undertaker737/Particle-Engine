// Simplified worker: replicate main-thread collision algorithm exactly (3 passes),
// scanning each cell and forward neighbors: same, right, bottom-left, bottom, bottom-right.
// No extra damping or modified overlap factors.
const STRIDE = 5; // x,y,vx,vy,size

function resolvePair(particleArray, elasticityArray, iA, iB, doImpulse, impulseScale) {
  const a = iA * STRIDE;
  const b = iB * STRIDE;
  let dx = particleArray[b] - particleArray[a];
  let dy = particleArray[b + 1] - particleArray[a + 1];
  let distSq = dx*dx + dy*dy;
  const rA = particleArray[a + 4];
  const rB = particleArray[b + 4];
  const minDist = rA + rB;
  if (distSq === 0) {
    dx = (Math.random() - 0.5) * 0.01;
    dy = (Math.random() - 0.5) * 0.01;
    distSq = dx*dx + dy*dy;
  }
  if (distSq >= minDist*minDist) return;
  const dist = Math.sqrt(distSq);
  const nx = dx / dist;
  const ny = dy / dist;
  const overlap = (minDist - dist) * 0.5; // equal distribution
  particleArray[a]     -= nx * overlap;
  particleArray[a + 1] -= ny * overlap;
  particleArray[b]     += nx * overlap;
  particleArray[b + 1] += ny * overlap;
  if (!doImpulse) return; // only positional correction this pass
  const dvx = particleArray[b + 2] - particleArray[a + 2];
  const dvy = particleArray[b + 3] - particleArray[a + 3];
  const vn = dvx * nx + dvy * ny;
  if (vn >= 0) return; // separating
  const e = Math.min(elasticityArray[iA], elasticityArray[iB]);
  const impulse = (-(1 + e) * vn * 0.5) * impulseScale;
  const ix = impulse * nx;
  const iy = impulse * ny;
  particleArray[a + 2] -= ix;
  particleArray[a + 3] -= iy;
  particleArray[b + 2] += ix;
  particleArray[b + 3] += iy;
}

function collideAll(particleArray, elasticityArray, count, cellSize, width, height, passes) {
  const cols = Math.max(1, Math.floor(width / cellSize));
  const rows = Math.max(1, Math.floor(height / cellSize));
  const cellCount = cols * rows;
  const neighborOffsets = [ [0,0], [0,1], [1,-1], [1,0], [1,1] ];
  if (passes < 1) passes = 1;
  const basePasses = 3; // baseline energy reference
  const impulseScale = Math.min(1, basePasses / passes); // more passes => scale down impulse
  for (let pass = 0; pass < passes; pass++) {
    const doImpulse = (pass === passes - 1); // only last pass imparts velocity change
    // build grid
    const cells = new Array(cellCount);
    for (let i = 0; i < count; i++) {
      const base = i * STRIDE;
      const x = particleArray[base];
      const y = particleArray[base + 1];
      let col = Math.floor(x / cellSize); if (col < 0) col = 0; else if (col >= cols) col = cols - 1;
      let row = Math.floor(y / cellSize); if (row < 0) row = 0; else if (row >= rows) row = rows - 1;
      const idx = row * cols + col;
      (cells[idx] || (cells[idx] = [])).push(i);
    }
    // collision passes
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const cellIndex = row * cols + col;
        const list = cells[cellIndex];
        if (!list || list.length === 0) continue;
        for (const [dr, dc] of neighborOffsets) {
          const nr = row + dr;
            const nc = col + dc;
          if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
          const nIndex = nr * cols + nc;
          const nList = cells[nIndex];
          if (!nList || nList.length === 0) continue;
          if (dr === 0 && dc === 0) {
            for (let i = 0; i < list.length; i++) {
              for (let j = i + 1; j < list.length; j++) {
                resolvePair(particleArray, elasticityArray, list[i], list[j], doImpulse, impulseScale);
              }
            }
          } else {
            for (let i = 0; i < list.length; i++) {
              for (let j = 0; j < nList.length; j++) {
                resolvePair(particleArray, elasticityArray, list[i], nList[j], doImpulse, impulseScale);
              }
            }
          }
        }
      }
    }
  }
}

let shared = false;
let sharedParticleArray = null;
let sharedElasticityArray = null;

self.onmessage = (e) => {
  const d = e.data;
  switch (d.type) {
    case 'init': {
      self.postMessage({ type: 'ready' });
      break;
    }
    case 'initShared': {
      shared = true;
      sharedParticleArray = new Float32Array(d.particleBuffer);
      sharedElasticityArray = new Float32Array(d.elasticityBuffer);
      self.postMessage({ type: 'ready' });
      break;
    }
    case 'collide': {
      const { particleArray, count, elasticityArray } = d;
      collideAll(particleArray, elasticityArray, count, d.cellSize, d.width, d.height, d.passes || 3);
      self.postMessage({ type: 'collided', particleArray }, [particleArray.buffer]);
      break;
    }
    case 'collideRange': {
      if (!shared || !sharedParticleArray) break;
      // For range we still build full grid each pass (simple) but we only process rows in band for same-cell pairs and neighbor pairs where at least one cell row is in band.
      const passes = d.passes || 3;
      const count = d.count;
      const cellSize = d.cellSize;
      const width = d.width;
      const height = d.height;
      const startRow = d.startRow;
      const endRow = d.endRow; // exclusive
      const cols = Math.max(1, Math.floor(width / cellSize));
      const rows = Math.max(1, Math.floor(height / cellSize));
      const cellCount = cols * rows;
      const neighborOffsets = [ [0,0], [0,1], [1,-1], [1,0], [1,1] ];
      for (let pass = 0; pass < passes; pass++) {
        const cells = new Array(cellCount);
        for (let i = 0; i < count; i++) {
          const base = i * STRIDE;
          const x = sharedParticleArray[base];
          const y = sharedParticleArray[base + 1];
          let col = Math.floor(x / cellSize); if (col < 0) col = 0; else if (col >= cols) col = cols - 1;
          let row = Math.floor(y / cellSize); if (row < 0) row = 0; else if (row >= rows) row = rows - 1;
          const idx = row * cols + col;
          (cells[idx] || (cells[idx] = [])).push(i);
        }
        for (let r = startRow; r < endRow; r++) {
          for (let c = 0; c < cols; c++) {
            const cellIndex = r * cols + c;
            const list = cells[cellIndex];
            if (!list || list.length === 0) continue;
            for (const [dr, dc] of neighborOffsets) {
              const nr = r + dr;
              const nc = c + dc;
              if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
              const nIndex = nr * cols + nc;
              const nList = cells[nIndex];
              if (!nList || nList.length === 0) continue;
              if (dr === 0 && dc === 0) {
                for (let i = 0; i < list.length; i++) {
                  for (let j = i + 1; j < list.length; j++) {
                    resolvePair(sharedParticleArray, sharedElasticityArray, list[i], list[j], doImpulse, impulseScale);
                  }
                }
              } else {
                // only process neighbor if owning row in band to avoid duplicate work across workers
                for (let i = 0; i < list.length; i++) {
                  for (let j = 0; j < nList.length; j++) {
                    resolvePair(sharedParticleArray, sharedElasticityArray, list[i], nList[j], doImpulse, impulseScale);
                  }
                }
              }
            }
          }
        }
      }
      self.postMessage({ type: 'rangeDone', startRow, endRow });
      break;
    }
  }
};
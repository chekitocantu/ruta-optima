importScripts('common.js');

// Held-Karp exact TSP: visits every node once, returns to node 0.
// O(n^2 * 2^n) time / O(n * 2^n) memory -> capped by caller for large n.

self.onmessage = function (e) {
  const { matrix, cap } = e.data;
  const n = matrix.length;
  const start = performance.now();

  if (n > cap) {
    postMessage({ algorithm: 'exact', skipped: true });
    return;
  }

  if (n <= 2) {
    const order = n === 2 ? [0, 1] : [0];
    postMessage({ algorithm: 'exact', order, cost: tourCost(order, matrix), timeMs: performance.now() - start });
    return;
  }

  const FULL = 1 << n;
  const dp = new Array(FULL);
  const parent = new Array(FULL);
  for (let mask = 0; mask < FULL; mask++) {
    dp[mask] = new Float64Array(n).fill(Infinity);
    parent[mask] = new Int16Array(n).fill(-1);
  }
  dp[1][0] = 0;

  for (let mask = 1; mask < FULL; mask++) {
    if (!(mask & 1)) continue;
    for (let u = 0; u < n; u++) {
      if (!(mask & (1 << u))) continue;
      const cu = dp[mask][u];
      if (cu === Infinity) continue;
      for (let v = 0; v < n; v++) {
        if (mask & (1 << v)) continue;
        const nmask = mask | (1 << v);
        const nc = cu + matrix[u][v];
        if (nc < dp[nmask][v]) {
          dp[nmask][v] = nc;
          parent[nmask][v] = u;
        }
      }
    }
  }

  const fullMask = FULL - 1;
  let best = Infinity;
  let bestU = -1;
  for (let u = 1; u < n; u++) {
    const c = dp[fullMask][u] + matrix[u][0];
    if (c < best) {
      best = c;
      bestU = u;
    }
  }

  const order = [];
  let mask = fullMask;
  let u = bestU;
  while (u !== -1) {
    order.push(u);
    const pu = parent[mask][u];
    mask ^= (1 << u);
    u = pu;
  }
  order.reverse();

  postMessage({ algorithm: 'exact', order, cost: best, timeMs: performance.now() - start });
};

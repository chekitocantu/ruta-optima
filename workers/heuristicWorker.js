importScripts('common.js');

// Nearest-neighbour construction + 2-opt + Or-opt local search.
// Works for asymmetric matrices (real streets/one-ways) since costs are
// always recomputed in full rather than using the symmetric delta shortcut.

function nearestNeighbor(m, n) {
  const visited = new Array(n).fill(false);
  const order = [0];
  visited[0] = true;
  let cur = 0;
  for (let k = 1; k < n; k++) {
    let best = -1;
    let bestC = Infinity;
    for (let j = 0; j < n; j++) {
      if (!visited[j] && m[cur][j] < bestC) {
        bestC = m[cur][j];
        best = j;
      }
    }
    order.push(best);
    visited[best] = true;
    cur = best;
  }
  return order;
}

function twoOpt(order, m) {
  let best = order.slice();
  let bestCost = tourCost(best, m);
  const n = order.length;
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const cand = best.slice(0, i).concat(best.slice(i, j + 1).reverse(), best.slice(j + 1));
        const c = tourCost(cand, m);
        if (c < bestCost - 1e-9) {
          best = cand;
          bestCost = c;
          improved = true;
        }
      }
    }
  }
  return best;
}

function orOpt(order, m) {
  let best = order.slice();
  let bestCost = tourCost(best, m);
  const n = order.length;
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < n; i++) {
      const city = best[i];
      const without = best.slice(0, i).concat(best.slice(i + 1));
      for (let pos = 0; pos <= without.length; pos++) {
        const cand = without.slice(0, pos).concat([city], without.slice(pos));
        const c = tourCost(cand, m);
        if (c < bestCost - 1e-9) {
          best = cand;
          bestCost = c;
          improved = true;
        }
      }
    }
  }
  return best;
}

self.onmessage = function (e) {
  const { matrix } = e.data;
  const n = matrix.length;
  const start = performance.now();

  if (n <= 2) {
    const order = n === 2 ? [0, 1] : [0];
    postMessage({ algorithm: 'heuristic', order, cost: tourCost(order, matrix), timeMs: performance.now() - start });
    return;
  }

  let order = nearestNeighbor(matrix, n);
  order = twoOpt(order, matrix);
  order = orOpt(order, matrix);
  order = rotateToStart(order, 0);

  postMessage({ algorithm: 'heuristic', order, cost: tourCost(order, matrix), timeMs: performance.now() - start });
};

function tourCost(order, m) {
  let c = 0;
  for (let i = 0; i < order.length; i++) {
    const a = order[i];
    const b = order[(i + 1) % order.length];
    c += m[a][b];
  }
  return c;
}

function rotateToStart(order, startNode) {
  const idx = order.indexOf(startNode);
  if (idx <= 0) return order;
  return order.slice(idx).concat(order.slice(0, idx));
}

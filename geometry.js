(function (root) {
  "use strict";
  const add = (a, b) => a.map((v, i) => v + b[i]);
  const subtract = (a, b) => a.map((v, i) => v - b[i]);
  const vector = o => [o.x, o.y, o.z];
  const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
  function rotate(q, v) {
    const [x, y, z, w] = q;
    const t = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])];
    return [v[0] + w * t[0] + y * t[2] - z * t[1],
      v[1] + w * t[1] + z * t[0] - x * t[2], v[2] + w * t[2] + x * t[1] - y * t[0]];
  }
  const toDisplay = v => [v[0], v[1], -v[2]];
  function rotateY(v, radians) {
    const c = Math.cos(radians), s = Math.sin(radians);
    return [c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]];
  }
  function heading(rotation) {
    const forward = rotate(rotation, [0, 0, 1]);
    if (Math.hypot(forward[0], forward[2]) < 1e-8) throw new Error("骨盤の水平向きを決められません。");
    return Math.atan2(forward[0], forward[2]);
  }
  function longAxisYawAlignment(rotation) {
    const up = rotate(rotation, [0, 1, 0]);
    if (Math.hypot(up[0], up[2]) < 1e-8) throw new Error("体の長軸の水平向きを決められません。");
    return Math.atan2(up[2], up[0]);
  }
  function viewVector(v, yawRadians) { return toDisplay(rotateY(v, yawRadians)); }
  function basis(yawDegrees, elevationDegrees, rollDegrees = 0) {
    const a = yawDegrees * Math.PI / 180, e = elevationDegrees * Math.PI / 180;
    const r = rollDegrees * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    const right = [Math.cos(a), 0, -Math.sin(a)];
    const up = [-Math.sin(a) * Math.sin(e), Math.cos(e), -Math.cos(a) * Math.sin(e)];
    return { right: right.map((v, i) => c * v + s * up[i]),
      up: up.map((v, i) => c * v - s * right[i]),
      outward: [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)] };
  }
  function axis(v, direction) {
    if (direction === 1) return v;
    if (direction === 0) return [v[1], v[0], v[2]];
    if (direction === 2) return [v[0], v[2], v[1]];
    throw new Error("未対応のカプセル軸です。");
  }
  function primitive(c) {
    const vertices = [], emit = (p, n) => vertices.push({ p, n });
    if (c.type === "BoxCollider") {
      const s = vector(c.size).map(v => v / 2);
      for (let d = 0; d < 3; d++) for (const sign of [-1, 1]) {
        const a = (d + 1) % 3, b = (d + 2) % 3, points = [];
        for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const p = [0, 0, 0]; p[d] = sign * s[d]; p[a] = x * s[a]; p[b] = y * s[b]; points.push(p);
        }
        const n = [0, 0, 0]; n[d] = sign;
        for (const i of [0, 1, 2, 0, 2, 3]) emit(points[i], n);
      }
    } else {
      if (!["SphereCollider", "CapsuleCollider"].includes(c.type)) throw new Error("未対応のColliderです。");
      const r = c.radius, half = c.type === "CapsuleCollider" ? c.height / 2 - r : 0;
      if (!(r > 0) || half < 0) throw new Error("不正なCollider寸法です。");
      const profiles = [], rings = 8, segments = 24;
      for (let i = 0; i <= rings; i++) profiles.push([-Math.PI / 2 + i * Math.PI / (2 * rings), -half]);
      for (let i = 0; i <= rings; i++) profiles.push([i * Math.PI / (2 * rings), half]);
      const direction = c.type === "CapsuleCollider" ? c.direction : 1;
      function sample(profile, longitude) {
        const [a, offset] = profile, t = longitude / segments * Math.PI * 2;
        const n = [Math.cos(a) * Math.cos(t), Math.sin(a), Math.cos(a) * Math.sin(t)];
        return { p: axis([r * n[0], r * n[1] + offset, r * n[2]], direction), n: axis(n, direction) };
      }
      for (let i = 0; i < profiles.length - 1; i++) for (let j = 0; j < segments; j++) {
        const q = [sample(profiles[i], j), sample(profiles[i], j + 1),
          sample(profiles[i + 1], j + 1), sample(profiles[i + 1], j)];
        for (const k of [0, 1, 2, 0, 2, 3]) emit(q[k].p, q[k].n);
      }
    }
    return vertices;
  }
  function bodyMesh(body, origin, yawRadians = 0) {
    const center = vector(body.collider.centerLocal);
    return primitive(body.collider).map(v => ({
      p: viewVector(subtract(add(body.position, rotate(body.rotation, add(center, v.p))), origin), yawRadians),
      n: viewVector(rotate(body.rotation, v.n), yawRadians), part: body.part
    }));
  }
  const api = { add, subtract, vector, dot, rotate, toDisplay, rotateY, heading, longAxisYawAlignment, viewVector, basis, primitive, bodyMesh };
  if (typeof module !== "undefined") module.exports = api;
  else root.PoseGeometry = api;
})(globalThis);

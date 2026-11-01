"use strict";
window.initializeSavedPoses = function initializeSavedPoses(data, humanAsset) {
  const G = window.PoseGeometry;
  const selected = ["reference-aa84", "v9-trial-2613"].map(id => data.poses.find(pose => pose.id === id));
  if (!G || data.newPhysicsRuns !== 0 || !data.cameraOnly || selected.some(pose => !pose)) {
    throw new Error("保存姿勢の形式が想定と異なります。");
  }
  const sourceSnapshot = JSON.stringify(selected);
  const controls = {
    yaw: document.getElementById("camera-yaw"),
    elevation: document.getElementById("camera-elevation"),
    zoom: document.getElementById("camera-zoom")
  };
  const camera = { yaw: 35, elevation: 42, zoom: 1 };
  const modes = ["reference", "best"];
  const meshes = selected.map(pose => {
    if (pose.bodies.length !== 11 || pose.bodies.some((body, i) => body.part !== i ||
        body.position.length !== 3 || body.rotation.length !== 4 ||
        [...body.position, ...body.rotation].some(value => !Number.isFinite(value)))) {
      throw new Error("11部位の保存位置・回転を確認できません。");
    }
    const origin = pose.bodies[2].position;
    return pose.bodies.flatMap(body => G.bodyMesh(body, origin));
  });
  const radius = Math.max(...meshes.map(mesh => Math.max(...mesh.map(v => Math.hypot(...v.p)))),
    ...selected.map(pose => window.BlueHuman.radius(humanAsset, pose.bodies))) * 1.09;
  if (!Number.isFinite(radius) || radius <= 0) throw new Error("表示する保存形状の範囲が不正です。");
  const vertexSource = `
    attribute vec3 position; attribute vec3 normal; attribute vec3 color;
    uniform vec3 right; uniform vec3 up; uniform vec3 outward;
    uniform float halfSize; uniform float aspect;
    varying vec3 shade;
    void main() {
      gl_Position = vec4(dot(position,right)/(halfSize*aspect),
        dot(position,up)/halfSize, -dot(position,outward)/(halfSize*4.0), 1.0);
      float light = max(0.0,dot(normalize(normal),normalize(vec3(-0.3,0.8,-0.6))));
      shade = color * (0.57 + 0.43*light);
    }`;
  const fragmentSource = "precision mediump float; varying vec3 shade; void main(){gl_FragColor=vec4(shade,1.0);}";
  const colors = { center: [.44, .60, .72], left: [.17, .40, .77], right: [.81, .49, .20] };
  let mode = "compare", renderStyle = "human", renderCount = 0, fallback = false;
  const renderers = [];
  function report() {
    window.savedPoseState = {
      camera: { ...camera }, mode, renderStyle, renderCount, fallback,
      sourcePoseUnchanged: JSON.stringify(selected) === sourceSnapshot,
      bodyCount: 22, newPhysicsRuns: 0, sourceReferenceSha256: data.referenceSha256,
      displayedScores: [null, selected[1].similarity], humanGeometrySha256: humanAsset.metadata.sha256,
      cameraTarget: "each saved pelvis; no body transform", coordinateConversion: "X,Y,-Z exactly once"
    };
    document.getElementById("camera-readout").textContent = fallback ? "静止画表示 / 保存姿勢のデータは変わりません。" :
      `共通カメラ：方位 ${Math.round(camera.yaw)}° / 仰角 ${Math.round(camera.elevation)}° / 倍率 ${camera.zoom.toFixed(2)}`;
  }
  function useFallback(reason) {
    fallback = true;
    for (const figure of document.querySelectorAll(".pose-card")) {
      figure.querySelector("canvas").hidden = true;
      figure.querySelector(".pose-fallback").hidden = false;
    }
    for (const control of document.querySelectorAll("#camera-controls input, #camera-controls button")) control.disabled = true;
    const message = document.getElementById("pose-error");
    message.hidden = false;
    message.textContent = `${reason} 保存姿勢の検査形状の静止画を表示しています。`;
    report();
  }
  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("3D表示の初期化に失敗しました。");
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error("3D表示用プログラムを作成できません。");
    return shader;
  }
  for (const [index, id] of ["reference-canvas", "best-canvas"].entries()) {
    const canvas = document.getElementById(id);
    const gl = canvas.getContext("webgl", { alpha: false, antialias: true, preserveDrawingBuffer: true });
    if (!gl) { useFallback("この環境ではWebGLを利用できません。"); break; }
    const program = gl.createProgram();
    if (!program) throw new Error("3D表示の初期化に失敗しました。");
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("3D表示用プログラムを結合できません。");
    gl.useProgram(program);
    const packed = new Float32Array(meshes[index].flatMap(v => [
      ...v.p, ...v.n, ...([3, 4, 7, 8].includes(v.part) ? colors.left :
        [5, 6, 9, 10].includes(v.part) ? colors.right : colors.center)
    ]));
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, packed, gl.STATIC_DRAW);
    for (const [i, name] of ["position", "normal", "color"].entries()) {
      const location = gl.getAttribLocation(program, name);
      gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 36, i * 12);
    }
    const uniforms = Object.fromEntries(["right", "up", "outward", "halfSize", "aspect"]
      .map(name => [name, gl.getUniformLocation(program, name)]));
    gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.clearColor(.957, .976, .989, 1);
    const attributes = ["position", "normal", "color"].map(name => gl.getAttribLocation(program, name));
    const human = window.BlueHuman.createRenderer(canvas, humanAsset);
    renderers.push({ canvas, gl, program, buffer, attributes, uniforms,
      vertexCount: packed.length / 9, human, bodies: selected[index].bodies });
    canvas.addEventListener("webglcontextlost", event => {
      event.preventDefault(); useFallback("3D描画が中断されました。再読み込みで復帰できる場合があります。");
    });
  }
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  function draw() {
    if (fallback) { report(); return; }
    const basis = G.basis(camera.yaw, camera.elevation);
    for (const { canvas, gl, program, buffer, attributes, uniforms, vertexCount, human, bodies } of renderers) {
      if (canvas.closest("figure").hidden) continue;
      if (renderStyle === "human") {
        human.draw(bodies, { ...camera, halfSize: radius });
        canvas.dataset.rendered = "true";
        continue;
      }
      const rect = canvas.getBoundingClientRect(), scale = Math.min(window.devicePixelRatio || 1, 2);
      if (!rect.width || !rect.height) continue;
      const width = Math.round(rect.width * scale), height = Math.round(rect.height * scale);
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      gl.useProgram(program); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      attributes.forEach((location, i) => {
        gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 36, i * 12);
      });
      gl.clearColor(.957, .976, .989, 1);
      gl.viewport(0, 0, canvas.width, canvas.height);
      for (const name of ["right", "up", "outward"]) gl.uniform3fv(uniforms[name], basis[name]);
      gl.uniform1f(uniforms.halfSize, radius / camera.zoom);
      gl.uniform1f(uniforms.aspect, canvas.width / canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
      if (gl.getError() !== gl.NO_ERROR) {
        useFallback("WebGL描画中にエラーが発生しました。"); return;
      }
      canvas.dataset.rendered = "true";
    }
    renderCount++; report();
  }
  function setCamera(update) {
    camera.yaw = ((update.yaw ?? camera.yaw) % 360 + 360) % 360;
    camera.elevation = clamp(update.elevation ?? camera.elevation, -80, 85);
    camera.zoom = clamp(update.zoom ?? camera.zoom, .7, 1.8);
    for (const key of Object.keys(controls)) controls[key].value = String(camera[key]);
    draw();
  }
  for (const [key, element] of Object.entries(controls)) {
    element.addEventListener("input", () => setCamera({ [key]: Number(element.value) }));
  }
  document.getElementById("camera-reset").addEventListener("click", () => setCamera({ yaw: 35, elevation: 42, zoom: 1 }));
  document.getElementById("camera-top").addEventListener("click", () => setCamera({ elevation: 85 }));
  for (const button of document.querySelectorAll("[data-render-style]")) {
    button.addEventListener("click", () => {
      renderStyle = button.dataset.renderStyle;
      for (const item of document.querySelectorAll("[data-render-style]")) item.setAttribute("aria-pressed", String(item === button));
      draw();
    });
  }
  for (const button of document.querySelectorAll("[data-pose-mode]")) {
    button.addEventListener("click", () => {
      mode = button.dataset.poseMode;
      for (const candidate of document.querySelectorAll("[data-pose-mode]")) candidate.setAttribute("aria-pressed", String(candidate === button));
      document.getElementById("pose-panels").classList.toggle("single", mode !== "compare");
      for (const figure of document.querySelectorAll(".pose-card")) figure.hidden = mode !== "compare" && figure.dataset.pose !== mode;
      draw();
    });
  }
  for (const { canvas } of renderers) {
    const pointers = new Map();
    let pinchDistance = null;
    canvas.addEventListener("pointerdown", event => {
      if (fallback) return;
      pointers.set(event.pointerId, [event.clientX, event.clientY]);
      canvas.setPointerCapture(event.pointerId); canvas.focus({ preventScroll: true });
    });
    canvas.addEventListener("pointermove", event => {
      const previous = pointers.get(event.pointerId);
      if (!previous || fallback) return;
      pointers.set(event.pointerId, [event.clientX, event.clientY]);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const distance = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinchDistance && distance > 0) setCamera({ zoom: camera.zoom * distance / pinchDistance });
        pinchDistance = distance;
      } else {
        setCamera({ yaw: camera.yaw + (event.clientX - previous[0]) * .45,
          elevation: camera.elevation + (event.clientY - previous[1]) * .35 });
      }
    });
    const release = event => { pointers.delete(event.pointerId); pinchDistance = null; };
    canvas.addEventListener("pointerup", release); canvas.addEventListener("pointercancel", release);
    canvas.addEventListener("lostpointercapture", release);
    canvas.addEventListener("keydown", event => {
      if (fallback) return;
      const actions = {
        ArrowLeft: { yaw: camera.yaw - 10 }, ArrowRight: { yaw: camera.yaw + 10 },
        ArrowUp: { elevation: camera.elevation + 10 }, ArrowDown: { elevation: camera.elevation - 10 },
        "+": { zoom: camera.zoom + .1 }, "=": { zoom: camera.zoom + .1 },
        "-": { zoom: camera.zoom - .1 }, Home: { yaw: 35, elevation: 42, zoom: 1 }
      };
      if (actions[event.key]) { event.preventDefault(); setCamera(actions[event.key]); }
    });
  }
  const observer = new ResizeObserver(draw);
  for (const modeName of modes) observer.observe(document.querySelector(`[data-pose="${modeName}"]`));
  draw();
};

"use strict";
window.BlueHuman = (() => {
  const G = () => window.PoseGeometry;
  async function load() {
    const metadataResponse = await fetch("data/blue-human-mesh.json");
    if (!metadataResponse.ok) throw new Error("人体CGの形状一覧を読み込めません。");
    const metadata = await metadataResponse.json();
    if (metadata.schemaVersion !== 1 || metadata.bodyCount !== 11 || metadata.strideFloats !== 9 ||
        metadata.coordinateSystem !== "UNITY_RIGIDBODY_LOCAL_METRES" ||
        metadata.binary !== "assets/blue-human-mesh.bin" || metadata.bytes > 20 * 1024 * 1024 ||
        metadata.parts.length !== 11 || metadata.parts.some((part, i) => part.part !== i ||
          !Number.isInteger(part.vertexCount) || part.vertexCount <= 0 || part.vertexCount % 3 ||
          !Number.isInteger(part.floatOffset) || part.floatOffset < 0)) {
      throw new Error("人体CGの形状形式が不正です。");
    }
    const binaryResponse = await fetch(metadata.binary);
    if (!binaryResponse.ok) throw new Error("人体CGの形状データを読み込めません。");
    const buffer = await binaryResponse.arrayBuffer();
    if (buffer.byteLength !== metadata.bytes || buffer.byteLength % 36) throw new Error("人体CGのデータ長が一致しません。");
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)), b => b.toString(16).padStart(2, "0")).join("");
    if (digest !== metadata.sha256) throw new Error("人体CGの識別値が一致しません。");
    const values = new Float32Array(buffer);
    if (values.some(v => !Number.isFinite(v))) throw new Error("人体CGに不正な座標があります。");
    let end = 0;
    for (const part of metadata.parts) {
      if (part.floatOffset !== end) throw new Error("人体CGの部位範囲が連続していません。");
      end += part.vertexCount * 9;
    }
    if (end !== values.length) throw new Error("人体CGの部位範囲が一致しません。");
    return { metadata, values };
  }
  function radius(asset, bodies, origin = bodies[2].position) {
    let maximum = 0;
    for (const part of asset.metadata.parts) {
      const body = bodies[part.part], end = part.floatOffset + part.vertexCount * 9;
      for (let i = part.floatOffset; i < end; i += 9) {
        const p = G().rotate(body.rotation, [asset.values[i], asset.values[i + 1], asset.values[i + 2]]);
        maximum = Math.max(maximum, Math.hypot(p[0] + body.position[0] - origin[0],
          p[1] + body.position[1] - origin[1], p[2] + body.position[2] - origin[2]));
      }
    }
    return maximum;
  }
  function createRenderer(canvas, asset, transparent = false) {
    const gl = canvas.getContext("webgl", { antialias: true, alpha: transparent, preserveDrawingBuffer: true });
    if (!gl) throw new Error("この環境では人体CGのWebGL表示を利用できません。");
    const vertexSource = `
      attribute vec3 position; attribute vec3 normal; attribute vec3 color;
      uniform vec4 rotation; uniform vec3 bodyPosition; uniform vec3 origin;
      uniform vec3 right; uniform vec3 up; uniform mediump vec3 outward;
      uniform float halfSize; uniform float aspect;
      varying mediump vec3 surfaceNormal; varying mediump vec3 surfaceColor;
      vec3 rotateQ(vec3 value) {
        vec3 t=2.0*cross(rotation.xyz,value);
        return value+rotation.w*t+cross(rotation.xyz,t);
      }
      void main() {
        vec3 p=rotateQ(position)+bodyPosition-origin;
        vec3 n=rotateQ(normal);
        p.z=-p.z; n.z=-n.z;
        gl_Position=vec4(dot(p,right)/(halfSize*aspect),dot(p,up)/halfSize,
                        -dot(p,outward)/(halfSize*4.0),1.0);
        surfaceNormal=n; surfaceColor=color;
      }`;
    const fragmentSource = `
      precision mediump float;
      varying mediump vec3 surfaceNormal; varying mediump vec3 surfaceColor;
      uniform mediump vec3 outward;
      void main() {
        vec3 n=normalize(surfaceNormal);
        vec3 light=normalize(vec3(-0.42,0.78,-0.48));
        float diffuse=max(0.0,dot(n,light));
        float sky=0.42+0.15*max(0.0,n.y);
        float spec=pow(max(0.0,dot(n,normalize(light+outward))),36.0)*0.06;
        vec3 linearColor=surfaceColor*(sky+0.85*diffuse)+vec3(spec);
        gl_FragColor=vec4(pow(clamp(linearColor,0.0,1.0),vec3(1.0/2.2)),1.0);
      }`;
    function shader(type, source) {
      const shader = gl.createShader(type);
      if (!shader) throw new Error("人体CGの描画準備に失敗しました。");
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error("人体CGの描画プログラムを作成できません。");
      return shader;
    }
    const program = gl.createProgram();
    if (!program) throw new Error("人体CGの描画準備に失敗しました。");
    gl.attachShader(program, shader(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragmentSource)); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`人体CGの描画プログラムを結合できません: ${gl.getProgramInfoLog(program)}`);
    const attributes = ["position", "normal", "color"].map(name => gl.getAttribLocation(program, name));
    const uniforms = Object.fromEntries(["rotation", "bodyPosition", "origin", "right", "up", "outward", "halfSize", "aspect"]
      .map(name => [name, gl.getUniformLocation(program, name)]));
    const parts = asset.metadata.parts.map(part => {
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, asset.values.subarray(part.floatOffset, part.floatOffset + part.vertexCount * 9), gl.STATIC_DRAW);
      return { ...part, buffer };
    });
    function draw(bodies, camera, explicitSize = null) {
      if (bodies.length !== 11 || bodies.some((body, index) => body.part !== index)) throw new Error("人体CGの11部位の対応が不正です。");
      const rect = canvas.getBoundingClientRect(), pixelRatio = Math.min(devicePixelRatio || 1, 2);
      const width = explicitSize ? explicitSize[0] : Math.max(1, Math.round(rect.width * pixelRatio));
      const height = explicitSize ? explicitSize[1] : Math.max(1, Math.round(rect.height * pixelRatio));
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      gl.useProgram(program); gl.viewport(0, 0, width, height);
      gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
      if (transparent) gl.clearColor(0, 0, 0, 0);
      else gl.clearColor(.949, .973, .989, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const basis = G().basis(camera.yaw, camera.elevation);
      for (const key of ["right", "up", "outward"]) gl.uniform3fv(uniforms[key], basis[key]);
      gl.uniform3fv(uniforms.origin, camera.origin || bodies[2].position);
      gl.uniform1f(uniforms.halfSize, camera.halfSize / (camera.zoom || 1));
      gl.uniform1f(uniforms.aspect, width / height);
      for (const part of parts) {
        const body = bodies[part.part];
        gl.bindBuffer(gl.ARRAY_BUFFER, part.buffer);
        attributes.forEach((location, i) => {
          gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 36, i * 12);
        });
        gl.uniform3fv(uniforms.bodyPosition, body.position);
        gl.uniform4fv(uniforms.rotation, body.rotation);
        gl.drawArrays(gl.TRIANGLES, 0, part.vertexCount);
      }
      if (gl.getError() !== gl.NO_ERROR) throw new Error("人体CGの描画中にWebGLエラーが発生しました。");
      gl.finish();
      canvas.dataset.humanRendered = "true";
    }
    return { draw, gl };
  }
  return { load, createRenderer, radius };
})();

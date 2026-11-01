"use strict";
(async () => {
  const canvas = document.getElementById("cg-film"), context = canvas.getContext("2d");
  const status = document.getElementById("cg-state");
  const input = document.getElementById("export-frame");
  try {
    const read = async path => {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`保存資料を読み込めません: ${path}`);
      return response.json();
    };
    const [asset, poses, trajectory] = await Promise.all([
      window.BlueHuman.load(), read("data/poses.json"), read("data/v9-trial0-motion.json")
    ]);
    const frames = trajectory.frames;
    if (frames.length !== 1430 || frames.some((row, i) => row.step !== i)) throw new Error("保存軌道の連続性を確認できません。");
    const originalSnapshot = JSON.stringify(frames);
    const originalPoses = JSON.stringify(poses.poses);
    const renderCanvas = document.createElement("canvas");
    const human = window.BlueHuman.createRenderer(renderCanvas, asset, true);
    const G = window.PoseGeometry, basis = G.basis(35, 18);
    const localBoxes = asset.metadata.parts.map(part => {
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = part.floatOffset; i < part.floatOffset + part.vertexCount * 9; i += 9) {
        for (let j = 0; j < 3; j++) { min[j] = Math.min(min[j], asset.values[i + j]); max[j] = Math.max(max[j], asset.values[i + j]); }
      }
      return [min, max];
    });
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    for (const frame of frames) for (const body of frame.bodies) {
      const [min, max] = localBoxes[body.part];
      for (let bits = 0; bits < 8; bits++) {
        const p = G.rotate(body.rotation, [0, 1, 2].map(j => bits & (1 << j) ? max[j] : min[j]));
        const world = G.toDisplay(p.map((value, j) => value + body.position[j]));
        const x = G.dot(world, basis.right), y = G.dot(world, basis.up);
        xmin = Math.min(xmin, x); xmax = Math.max(xmax, x);
        ymin = Math.min(ymin, y); ymax = Math.max(ymax, y);
      }
    }
    const originDisplay = basis.right.map((value, i) => value * (xmin + xmax) / 2 + basis.up[i] * (ymin + ymax) / 2);
    const fixedCamera = {
      yaw: 35, elevation: 18, zoom: 1,
      origin: [originDisplay[0], originDisplay[1], -originDisplay[2]],
      halfSize: Math.max((ymax - ymin) / 2, (xmax - xmin) / 2 / (1310 / 785)) * 1.18
    };
    window.cgProjectionAudit = {
      sourceFrames: frames.length, bodyCount: 11,
      displayVertexCount: asset.values.length / 9,
      testedBoundingCorners: frames.length * 11 * 8,
      method: "All display-mesh vertices form each local AABB; all eight transformed corners tested for every saved frame.",
      includesHeadHandsFeet: true,
      fixedCamera: { ...fixedCamera, origin: [...fixedCamera.origin] },
      plotPixels: [52, 192, 1310, 785],
      minimumHorizontalPaddingPixels: (1 - (xmax - xmin) / 2 / (fixedCamera.halfSize * (1310 / 785))) * 1310 / 2,
      minimumVerticalPaddingPixels: (1 - (ymax - ymin) / 2 / fixedCamera.halfSize) * 785 / 2,
      cameraNeverRefittedDuringMotion: true
    };
    const last = frames.at(-1), lastTime = last.physicalSeconds;
    const bestPose = poses.poses.find(pose => pose.id === "v9-trial-2613");
    const referenceRadius = window.BlueHuman.radius(asset, poses.poses[0].bodies) * 1.08;
    const terminalRadius = window.BlueHuman.radius(asset, last.bodies) * 1.06;
    const bestRadius = window.BlueHuman.radius(asset, bestPose.bodies) * 1.06;
    function txt(value, x, y, size = 30, color = "#15364d", width = 1800) {
      context.fillStyle = color; context.textBaseline = "top";
      do { context.font = `600 ${size}px "Hiragino Kaku Gothic ProN","Yu Gothic",sans-serif`; size--; }
      while (context.measureText(value).width > width && size > 15);
      context.fillText(value, x, y);
    }
    function draw(number) {
      const t = number / 30;
      const motion = t >= 4 && t < 28;
      let source, camera, phase, subtitle;
      if (t < 4) {
        source = poses.poses[0];
        camera = { yaw: 35, elevation: 42, zoom: 1, origin: source.bodies[2].position,
          halfSize: referenceRadius };
        phase = "reference-introduction";
        subtitle = "表示用人体CG / 次にtrial 0の初期から終端までを再生";
      } else if (motion) {
        const physical = Math.min(lastTime, (t - 4) / 8);
        let lo = 0, hi = frames.length - 1;
        while (lo < hi) {
          const mid = Math.ceil((lo + hi) / 2);
          if (frames[mid].physicalSeconds <= physical) lo = mid; else hi = mid - 1;
        }
        source = frames[lo]; camera = fixedCamera;
        phase = "fixed-world-recorded-trajectory";
        subtitle = "8倍スロー / 世界座標とカメラは固定 / 補間なし";
      } else if (t < 36) {
        source = last;
        camera = { yaw: 35 + (t - 28) * 13, elevation: 40, zoom: 1,
          origin: source.bodies[2].position, halfSize: terminalRadius };
        phase = "terminal-camera-only";
        subtitle = "保存終端を拡大 / 動いているのはカメラだけ";
      } else {
        source = bestPose;
        camera = { yaw: 40 + (t - 36) * 10, elevation: 46, zoom: 1,
          origin: source.bodies[2].position, halfSize: bestRadius };
        phase = "different-trial-saved-terminal";
        subtitle = "別の試行2613の保存終端 / この軌道は作っていません";
      }
      context.fillStyle = "#f2f7fb"; context.fillRect(0, 0, 1920, 1080);
      txt("RAGDOLL / 青い人体CGで、保存した動きを見る", 55, 25, 29, "#147475");
      txt(t < 4 ? "ヤムチャのポーズ研究：模型のCG化" :
        motion ? "立位から落下、そして終端へ。" :
        t < 36 ? "同じ終端を、近くから見る。" : "最高47.22%の非一致例も、CGで。", 55, 83, 57);
      context.fillStyle = "#e5eff7"; context.fillRect(52, 192, 1310, 785);
      if (motion) {
        for (const y of [-.4, 0, .5, 1, 1.5, 2]) {
          const p = G.toDisplay([0 - fixedCamera.origin[0], y - fixedCamera.origin[1], 0 - fixedCamera.origin[2]]);
          const py = 192 + 785 / 2 - G.dot(p, basis.up) / fixedCamera.halfSize * 785 / 2;
          if (py < 210 || py > 950) continue;
          context.strokeStyle = "#b7ccdb"; context.lineWidth = 1;
          context.beginPath(); context.moveTo(70, py); context.lineTo(1340, py); context.stroke();
          txt(`Y=${y.toFixed(1)}m`, 73, py + 4, 17, "#47647a", 120);
        }
      }
      human.draw(source.bodies, camera, [1310, 785]);
      context.drawImage(renderCanvas, 52, 192);
      txt(motion || (t >= 28 && t < 36) ? "V9 / trial 0" :
        t >= 36 ? "V9 / trial 2613" : "V9 / 保存参照 aa84", 1400, 206, 36, "#147475", 460);
      txt(motion || (t >= 28 && t < 36) ? "seed 2673074176" :
        t >= 36 ? "seed 3465339881" : "成功例ではありません", 1400, 272, 27, "#15364d", 465);
      if (source.step !== undefined) {
        txt(`step ${source.step} / 1429`, 1400, 369, 30, "#15364d", 465);
        txt(`物理 ${source.physicalSeconds.toFixed(3)} 秒`, 1400, 425, 31, "#15364d", 465);
        txt(`骨盤 world Y`, 1400, 506, 26, "#47647a", 465);
        txt(`${source.bodies[2].position[1].toFixed(3)} m`, 1400, 550, 44, "#235dd4", 460);
      } else if (t >= 36) {
        txt("類似度 47.22%", 1400, 382, 42, "#235dd4", 460);
        txt("右前腕の関節角差", 1400, 472, 29, "#47647a", 460);
        txt("99.2° > 75°", 1400, 525, 43, "#965800", 460);
        txt("QualifiedSettled", 1400, 594, 25, "#15364d", 460);
        txt("最高例も、非一致", 1400, 643, 30, "#15364d", 460);
      }
      txt("手・足・表面は表示用。", 1400, 747, 27, "#47647a", 465);
      txt("物理の11剛体は保存値。", 1400, 793, 27, "#47647a", 465);
      txt("採点・条件は変更なし。", 1400, 839, 27, "#47647a", 465);
      txt("新しい物理計算 0", 1400, 903, 29, "#147475", 465);
      txt(subtitle, 57, 1002, 34, "#147475");
      txt(motion ? "目盛りはz=0の世界Y基準。地面を動かしたり、各frameを原点へ戻したりしていません。" :
        "肌・手足などのCG表面は接触判定ではありません。原作画像・髪型・衣装の複製は使っていません。",
      57, 1051, 21, "#47647a");
      canvas.dataset.frame = String(number);
      window.cgReplayState = {
        videoFrame: number, phase, sourceStep: source.step ?? source.steps ?? null,
        sourcePhysicalSeconds: source.physicalSeconds,
        sourceTrialId: t < 4 ? null : t < 36 ? 0 : 2613,
        camera: { ...camera, origin: [...camera.origin] },
        fixedWorldDuringMotion: motion, bodyCount: 11, sourceDataUnchanged:
          JSON.stringify(frames) === originalSnapshot && JSON.stringify(poses.poses) === originalPoses,
        newPhysicsRuns: 0, noFrameOriginRepositioning: true, noMovingGround: true,
        meshSha256: asset.metadata.sha256
      };
      status.textContent = `${number} / 1319 frame — ${subtitle}`;
    }
    input.addEventListener("input", () => {
      const value = Number(input.value);
      if (!Number.isInteger(value) || value < 0 || value > 1319) {
        status.textContent = "0〜1319の整数frameを指定してください。"; return;
      }
      draw(value);
    });
    let animation = null, start = null, first = 0;
    const play = document.getElementById("cg-play");
    function tick(time) {
      if (start === null) start = time;
      const frame = first + Math.floor((time - start) / 1000 * 30);
      if (frame > 1319) { animation = null; play.textContent = "保存映像を再生（無音）"; return; }
      input.value = String(frame); draw(frame); animation = requestAnimationFrame(tick);
    }
    play.addEventListener("click", () => {
      if (animation !== null) {
        cancelAnimationFrame(animation); animation = null; play.textContent = "保存映像を再生（無音）";
      } else {
        first = Number(input.value) >= 1319 ? 0 : Number(input.value); start = null;
        play.textContent = "一時停止"; animation = requestAnimationFrame(tick);
      }
    });
    draw(0); document.body.dataset.ready = "true";
  } catch (error) {
    const box = document.getElementById("cg-error"); box.hidden = false; box.textContent = error.message;
    document.body.dataset.ready = "error"; console.error(error);
  }
})();

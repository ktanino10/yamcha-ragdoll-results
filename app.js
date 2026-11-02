"use strict";
(async function initializePublication() {
  const element = (name, className, text) => {
    const node = document.createElement(name);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  async function json(path) {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`${path}を読み込めません (${response.status})。`);
    return response.json();
  }
  function asset(path) {
    if (typeof path !== "string" || !/^(media|data|assets)\/[a-zA-Z0-9_./-]+$/.test(path) ||
        path.includes("..") || path.includes("//")) throw new Error("資料の相対パスが不正です。");
    return path;
  }
  const percent = value => `${(value * 100).toFixed(2)}%`;
  function histogram(summary) {
    const counts = summary.histogram.bins;
    if (counts.length !== 50 || counts.some(n => !Number.isInteger(n) || n < 0) ||
        counts.reduce((a, b) => a + b, 0) !== 6569) throw new Error("分布の件数が集計と一致しません。");
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 560 330"); svg.setAttribute("role", "img");
    const add = (type, attrs, text) => {
      const node = document.createElementNS(ns, type);
      for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
      if (text !== undefined) node.textContent = text;
      svg.append(node); return node;
    };
    add("title", {}, "V9の姿勢類似度分布。判定可能6,569件。中央値14.71%、最大47.22%。82%の閾値以上は0件。");
    for (const n of [0, 400, 800, 1200]) {
      const y = 265 - n / 1200 * 218;
      add("line", { x1: 44, y1: y, x2: 535, y2: y, stroke: "#cfdeea" });
      add("text", { x: 35, y: y + 4, "text-anchor": "end", fill: "#47647a", "font-size": 11 }, String(n));
    }
    counts.forEach((count, i) => {
      const height = count / 1200 * 218;
      const bar = add("rect", { x: 45 + i * 9.78, y: 265 - height, width: 8, height, fill: "#356dca", rx: 1 });
      const title = document.createElementNS(ns, "title"); title.textContent = `${i * 2}–${i * 2 + 2}%: ${count}件`; bar.append(title);
      if (count > 0) {
        const tr = element("tr");
        tr.append(element("td", "", `${i * 2}%以上 ${i * 2 + 2}%未満`), element("td", "", count.toLocaleString("ja-JP")));
        document.getElementById("histogram-table").append(tr);
      }
    });
    for (const value of [0, 20, 40, 60, 80, 100]) add("text",
      { x: 44 + value * 4.89, y: 290, "text-anchor": "middle", fill: "#47647a", "font-size": 12 }, String(value));
    add("text", { x: 289, y: 318, "text-anchor": "middle", fill: "#47647a", "font-size": 12 }, "姿勢類似度（%）");
    const thresholdX = 44 + 82 * 4.89;
    add("line", { x1: thresholdX, x2: thresholdX, y1: 40, y2: 265, stroke: "#9b650c", "stroke-width": 2, "stroke-dasharray": "5 5" });
    add("text", { x: thresholdX, y: 24, "text-anchor": "middle", fill: "#875009", "font-size": 12 }, "閾値 82%");
    add("text", { x: 292, y: 125, "text-anchor": "middle", fill: "#47647a", "font-size": 12 }, "50%以上：0件");
    document.getElementById("histogram").append(svg);
  }
  function resultsTable(rows) {
    if (rows.length !== 100 || rows[0].trialId !== 2613 || rows.some(r => r.success !== false ||
        r.status !== "QualifiedSettled" || !Number.isFinite(r.similarity))) throw new Error("上位記録の形式が一致しません。");
    function render() {
      const term = document.getElementById("trial-search").value.trim();
      const shown = rows.map((row, i) => ({ ...row, rank: i + 1 }))
        .filter(row => !term || String(row.trialId).includes(term) || String(row.seed).includes(term));
      const body = document.getElementById("top-results"); body.replaceChildren();
      for (const row of shown) {
        const tr = element("tr");
        for (const text of [row.rank, row.trialId, row.seed, percent(row.similarity), "判定可能・非一致"]) tr.append(element("td", "", text));
        body.append(tr);
      }
      document.getElementById("table-count").textContent = `${shown.length} / 100件`;
      document.getElementById("table-empty").hidden = shown.length !== 0;
    }
    document.getElementById("trial-search").addEventListener("input", render); render();
  }
  let youtubePromise;
  function loadYoutubeApi() {
    if (youtubePromise) return youtubePromise;
    youtubePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { youtubePromise = null; reject(new Error("YouTubeを読み込めません。MP4でも確認できます。")); }, 15000);
      window.onYouTubeIframeAPIReady = () => { clearTimeout(timeout); resolve(window.YT); };
      const script = element("script"); script.src = "https://www.youtube.com/iframe_api";
      script.onerror = () => { clearTimeout(timeout); youtubePromise = null; reject(new Error("YouTubeとの接続に失敗しました。MP4でも確認できます。")); };
      document.head.append(script);
    });
    return youtubePromise;
  }
  function timeLabel(seconds) {
    const time = Math.floor(seconds);
    return `${Math.floor(time / 60)}:${String(time % 60).padStart(2, "0")}`;
  }
  function videoCard(record) {
    if (!/^[a-z0-9-]+$/.test(record.id) || !Number.isFinite(record.durationSeconds) ||
        record.durationSeconds <= 0 || (record.youtubeId !== null && (!/^[A-Za-z0-9_-]{11}$/.test(record.youtubeId) ||
        !["public", "unlisted"].includes(record.youtubeVisibility)))) {
      throw new Error("動画のIDまたは再生情報が不正です。");
    }
    const card = element("article", "video-card"); card.id = `film-${record.id}`;
    const viewport = element("div", "video-viewport");
    if (record.orientation === "portrait") card.classList.add("portrait");
    const copy = element("div", "video-copy");
    copy.append(element("p", "video-kind", `${record.kindLabel} / ${timeLabel(record.durationSeconds)}`),
      element("h3", "", record.title), element("p", "", record.description));
    if (record.contextNote) copy.append(element("p", "video-notice", record.contextNote));
    const error = element("p", "video-error"); error.hidden = true; error.setAttribute("role", "alert");
    copy.append(error);
    const showError = message => { error.textContent = message; error.hidden = false; };
    let local = null, ytPlayer = null;
    if (record.youtubeId) {
      const image = element("img"); image.src = asset(record.poster); image.alt = record.title;
      const load = element("button", "youtube-load", "YouTubeの埋め込みを読み込む"); load.type = "button";
      viewport.append(image, load);
      load.addEventListener("click", async () => {
        load.disabled = true; error.hidden = true;
        try {
          const api = await loadYoutubeApi();
          const target = element("div"); viewport.replaceChildren(target);
          ytPlayer = new api.Player(target, {
            videoId: record.youtubeId, host: "https://www.youtube-nocookie.com",
            playerVars: { autoplay: 0, mute: 1, playsinline: 1, rel: 0, origin: window.location.origin },
            events: {
              onReady: event => {
                event.target.mute(); event.target.setVolume(0);
                const iframe = event.target.getIframe();
                iframe.title = record.title; iframe.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
                card.dataset.youtubeMuted = String(event.target.isMuted());
                card.dataset.youtubeVolume = String(event.target.getVolume());
                card.dataset.youtubeState = String(event.target.getPlayerState());
                card.dataset.youtubeReady = "true";
              },
              onStateChange: event => {
                card.dataset.youtubeState = String(event.data);
                card.dataset.youtubeTime = String(event.target.getCurrentTime());
              },
              onError: event => {
                card.dataset.youtubeError = String(event.data);
                showError("YouTubeで再生できません。MP4のリンクを利用してください。");
              }
            }
          });
        } catch (failure) {
          showError(failure.message); load.disabled = false;
        }
      });
    } else {
      local = element("video"); local.controls = true; local.preload = "metadata";
      local.defaultMuted = true; local.muted = true; local.volume = 0; local.autoplay = false;
      local.playsInline = true; local.setAttribute("muted", ""); local.setAttribute("aria-label", record.title);
      local.poster = asset(record.poster); local.src = asset(record.mp4);
      if (record.vtt) {
        const track = element("track"); track.kind = "subtitles"; track.srclang = "ja"; track.label = "日本語";
        track.src = asset(record.vtt); local.append(track);
      }
      local.addEventListener("error", () => showError("動画を読み込めません。ファイルの配置とMP4のリンクを確認してください。"));
      viewport.append(local);
    }
    const links = element("div", "video-links");
    for (const [label, path] of [["MP4", record.mp4], ["字幕 SRT", record.srt], ["台本", record.script], ["章", record.chaptersFile]]) {
      if (!path) continue;
      const link = element("a", "", label); link.href = asset(path); link.download = ""; links.append(link);
    }
    if (record.youtubeId) {
      const link = element("a", "", record.youtubeVisibility === "unlisted" ? "YouTubeで開く（限定公開）" : "YouTubeで開く（公開）");
      link.href = `https://www.youtube.com/watch?v=${record.youtubeId}`;
      link.rel = "noopener"; links.append(link);
    }
    copy.append(links);
    if (local) {
      const play = element("button", "", "再生"); play.type = "button"; play.setAttribute("aria-label", `${record.title}を再生`);
      play.addEventListener("click", async () => {
        try { if (local.paused) await local.play(); else local.pause(); }
        catch (failure) { showError(`再生を開始できません: ${failure.message}`); }
      });
      local.addEventListener("play", () => { play.textContent = "一時停止"; play.setAttribute("aria-label", `${record.title}を一時停止`); });
      local.addEventListener("pause", () => { play.textContent = "再生"; play.setAttribute("aria-label", `${record.title}を再生`); });
      const buttons = element("div", "chapter-buttons"); buttons.append(play); copy.append(buttons);
    }
    if (Array.isArray(record.chapters) && record.chapters.length) {
      const details = element("details"), list = element("div", "chapter-buttons");
      details.append(element("summary", "", "章から見る"));
      for (const chapter of record.chapters) {
        if (!Number.isFinite(chapter.start) || chapter.start < 0 || chapter.start >= record.durationSeconds) throw new Error("章の時刻が動画の範囲外です。");
        const button = element("button", "", `${timeLabel(chapter.start)} ${chapter.title}`); button.type = "button";
        button.addEventListener("click", () => {
          error.hidden = true;
          if (local) {
            if (local.readyState < 1) { showError("動画の情報を読み込み中です。再生後にもう一度選んでください。"); return; }
            local.currentTime = chapter.start; local.pause();
          } else if (ytPlayer && card.dataset.youtubeReady === "true") {
            ytPlayer.seekTo(chapter.start, true); ytPlayer.pauseVideo();
          } else {
            showError("先にYouTubeの埋め込みを読み込んでください。");
          }
        });
        list.append(button);
      }
      details.append(list); copy.append(details);
    }
    const provenance = element("details");
    provenance.append(element("summary", "", "動画の識別値"), element("p", "small", `SHA-256: ${record.sha256}`));
    copy.append(provenance); card.append(viewport, copy);
    for (const shortcut of document.querySelectorAll(`[data-seek-video="${record.id}"]`)) {
      shortcut.disabled = false;
      shortcut.addEventListener("click", async () => {
        const seconds = Number(shortcut.dataset.seekTime);
        if (!Number.isFinite(seconds) || seconds < 0 || seconds >= record.durationSeconds) {
          showError("再生開始位置が動画の範囲外です。"); return;
        }
        card.scrollIntoView({ block: "start" });
        error.hidden = true;
        if (local) {
          if (local.readyState < 1) { showError("動画情報の読み込み後に、もう一度選んでください。"); return; }
          local.muted = true; local.volume = 0; local.currentTime = seconds;
          try { await local.play(); }
          catch (failure) { showError(`無音再生を開始できません: ${failure.message}`); }
        } else if (ytPlayer && card.dataset.youtubeReady === "true") {
          ytPlayer.mute(); ytPlayer.setVolume(0); ytPlayer.seekTo(seconds, true); ytPlayer.playVideo();
        } else {
          showError("先にYouTubeの埋め込みを読み込んでください。");
        }
      });
    }
    return card;
  }
  try {
    const [summary, top, poses, videos, human] = await Promise.all([
      json("data/summary.json"), json("data/top100.json"), json("data/poses.json"), json("data/videos.json"), window.BlueHuman.load()
    ]);
    if (summary.recorded !== 6900 || summary.unknown !== 331 || summary.confirmedSuccesses !== 0 ||
        summary.fullPlanSuccessRate !== null || summary.studyComplete !== false) throw new Error("凍結済みV9集計の条件が一致しません。");
    histogram(summary); resultsTable(top); window.initializeSavedPoses(poses, human);
    if (videos.schemaVersion !== 1 || !Array.isArray(videos.videos)) throw new Error("動画一覧の形式が不正です。");
    const ids = new Set();
    for (const record of videos.videos) {
      if (ids.has(record.id)) throw new Error("動画IDが重複しています。"); ids.add(record.id);
      document.getElementById("video-list").append(videoCard(record));
    }
    document.body.dataset.ready = "true";
  } catch (error) {
    const message = document.getElementById("data-error");
    message.hidden = false; message.textContent = `一部の資料を表示できません: ${error.message}`;
    document.body.dataset.ready = "error"; console.error(error);
  }
})();

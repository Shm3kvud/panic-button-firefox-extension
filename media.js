"use strict";

browser.runtime.onMessage.addListener((message) => {
  if (!message || typeof message.type !== "string") {
    return undefined;
  }

  if (message.type === "pause-media") {
    let pausedAny = false;
    const mediaEls = document.querySelectorAll("video, audio");
    for (const el of mediaEls) {
      if (!el.paused && !el.ended) {
        try {
          el.pause();
          el.setAttribute("data-panic-was-playing", "1");
          pausedAny = true;
        } catch (err) {}
      }
    }
    return Promise.resolve({ wasPlaying: pausedAny });
  }

  if (message.type === "resume-media") {
    const marked = document.querySelectorAll("[data-panic-was-playing]");
    for (const el of marked) {
      el.removeAttribute("data-panic-was-playing");
      try {
        const p = el.play();
        if (p && typeof p.catch === "function") {
          p.catch(() => {});
        }
      } catch (err) {}
    }
    return Promise.resolve({ ok: true });
  }

  return undefined;
});

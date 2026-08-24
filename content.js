"use strict";

window.addEventListener(
  "keydown",
  (event) => {
    if (
      event.key === "F12" &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      !event.metaKey
    ) {
      event.preventDefault();
      event.stopPropagation();
      try {
        browser.runtime.sendMessage({ type: "toggle-panic" }).catch(() => {});
      } catch (err) {}
    }
  },
  true
);

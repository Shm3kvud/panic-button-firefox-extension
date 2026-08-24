"use strict";

const SAFE_URL = "https://www.google.com/";
const STATE_PREFIX = "panicState_";
const togglingWindows = new Set();

function stateKey(windowId) {
  return STATE_PREFIX + windowId;
}

async function getState(windowId) {
  const key = stateKey(windowId);
  const data = await browser.storage.local.get(key);
  return data[key] || null;
}

async function setState(windowId, state) {
  await browser.storage.local.set({ [stateKey(windowId)]: state });
}

async function clearState(windowId) {
  await browser.storage.local.remove(stateKey(windowId));
}

async function getAllPanicStates() {
  const data = await browser.storage.local.get(null);
  const result = [];
  for (const key of Object.keys(data)) {
    if (key.startsWith(STATE_PREFIX)) {
      result.push({
        windowId: Number(key.slice(STATE_PREFIX.length)),
        state: data[key]
      });
    }
  }
  return result;
}

async function togglePanic(windowId) {
  if (togglingWindows.has(windowId)) {
    return;
  }
  togglingWindows.add(windowId);
  try {
    const state = await getState(windowId);
    if (state && state.active) {
      await restoreTabs(windowId, state);
    } else {
      await panicMode(windowId);
    }
  } catch (err) {
    console.error("Panic Button error:", err);
  } finally {
    togglingWindows.delete(windowId);
  }
}

async function panicMode(windowId) {
  const tabs = await browser.tabs.query({ windowId });

  const pinnedIds = tabs.filter((t) => t.pinned).map((t) => t.id);

  for (const id of pinnedIds) {
    try {
      await browser.tabs.update(id, { pinned: false });
    } catch (err) {
      console.error("Panic Button unpin failed:", err);
    }
  }

  const safeTab = await browser.tabs.create({
    url: SAFE_URL,
    active: true
  });

  const allIds = tabs.map((t) => t.id);
  let hiddenIds = [];
  try {
    hiddenIds = await browser.tabs.hide(allIds);
  } catch (err) {
    console.error("Panic Button hide failed:", err);
  }

  const previouslyActive = tabs.find((t) => t.active);

  const mediaTabIds = [];
  for (const t of tabs) {
    if (t.hidden || !/^https?:/.test(t.url || "")) {
      continue;
    }
    try {
      const results = await browser.tabs.sendMessage(t.id, {
        type: "pause-media"
      });
      if (results && results.wasPlaying) {
        mediaTabIds.push(t.id);
      }
    } catch (err) {}
  }

  await setState(windowId, {
    active: true,
    safeTabId: safeTab.id,
    hiddenIds: hiddenIds,
    pinnedIds: pinnedIds,
    prevActiveId: previouslyActive ? previouslyActive.id : null,
    hiddenBeforeIds: tabs.filter((t) => t.hidden).map((t) => t.id),
    mediaTabIds: mediaTabIds
  });
}

async function restoreTabs(windowId, state) {
  let currentTabs = [];
  try {
    currentTabs = await browser.tabs.query({ windowId });
  } catch (err) {
    currentTabs = [];
  }
  const existingIds = new Set(currentTabs.map((t) => t.id));

  const idsToShow = state.hiddenIds.filter(
    (id) => existingIds.has(id) && !state.hiddenBeforeIds.includes(id)
  );

  if (idsToShow.length > 0) {
    try {
      await browser.tabs.show(idsToShow);
    } catch (err) {
      console.error("Panic Button show failed:", err);
    }
  }

  for (const id of state.hiddenBeforeIds) {
    if (existingIds.has(id)) {
      try {
        await browser.tabs.hide(id);
      } catch (err) {}
    }
  }

  for (const id of state.pinnedIds) {
    if (existingIds.has(id)) {
      try {
        await browser.tabs.update(id, { pinned: true });
      } catch (err) {}
    }
  }

  if (
    state.prevActiveId !== null &&
    state.prevActiveId !== undefined &&
    existingIds.has(state.prevActiveId)
  ) {
    try {
      await browser.tabs.update(state.prevActiveId, { active: true });
    } catch (err) {}
  }

  if (state.mediaTabIds && state.mediaTabIds.length > 0) {
    for (const id of state.mediaTabIds) {
      if (!existingIds.has(id)) {
        continue;
      }
      try {
        await browser.tabs.sendMessage(id, { type: "resume-media" });
      } catch (err) {}
    }
  }

  if (state.safeTabId && existingIds.has(state.safeTabId)) {
    try {
      await browser.tabs.remove(state.safeTabId);
    } catch (err) {}
  }

  await clearState(windowId);
}

browser.commands.onCommand.addListener(async (command) => {
  if (command === "toggle-panic") {
    try {
      const win = await browser.windows.getLastFocused({ populate: false });
      if (win && win.type === "normal") {
        await togglePanic(win.id);
      }
    } catch (err) {
      console.error("Panic Button command error:", err);
    }
  }
});

browser.browserAction.onClicked.addListener(async (tab) => {
  if (tab && tab.windowId) {
    await togglePanic(tab.windowId);
  }
});

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "toggle-panic") {
    (async () => {
      try {
        const win = await browser.windows.getLastFocused({ populate: false });
        if (win && win.type === "normal") {
          await togglePanic(win.id);
        }
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: String(err) });
      }
    })();
    return true;
  }
  return undefined;
});

browser.tabs.onRemoved.addListener(async (removedTabId) => {
  const states = await getAllPanicStates();
  for (const { windowId, state } of states) {
    if (!state || !state.active) continue;

    if (state.safeTabId === removedTabId) {
      const newState = Object.assign({}, state, { safeTabId: null });
      await restoreTabs(windowId, newState);
    } else {
      const hiddenIdx = state.hiddenIds.indexOf(removedTabId);
      if (hiddenIdx !== -1) {
        state.hiddenIds.splice(hiddenIdx, 1);
        await setState(windowId, state);
      }
      const pinnedIdx = state.pinnedIds.indexOf(removedTabId);
      if (pinnedIdx !== -1) {
        state.pinnedIds.splice(pinnedIdx, 1);
        await setState(windowId, state);
      }
      if (state.prevActiveId === removedTabId) {
        state.prevActiveId = null;
        await setState(windowId, state);
      }
    }
  }
});

browser.windows.onRemoved.addListener(async (removedWindowId) => {
  await clearState(removedWindowId);
});

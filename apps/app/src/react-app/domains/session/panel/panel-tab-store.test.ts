import assert from "node:assert/strict";
import { test } from "node:test";

import type { BrowserPanelTab, FilesPanelTab, PanelTab } from "./panel-tab-store";
import type { OpenTarget } from "../artifacts/open-target";
const memory = new Map<string, string>();
const localStorageShim = {
  getItem(key: string) {
    return memory.get(key) ?? null;
  },
  setItem(key: string, value: string) {
    memory.set(key, value);
  },
  removeItem(key: string) {
    memory.delete(key);
  },
  clear() {
    memory.clear();
  },
  key(_index: number) {
    return null;
  },
  get length() {
    return memory.size;
  },
};
Reflect.set(globalThis, "localStorage", localStorageShim);

const { usePanelTabStore, WORKSPACE_FILES_TAB_ID, createWorkspaceFilesTabId } = await import("./panel-tab-store");

function makeFileTarget(value: string): OpenTarget {
  const name = value.split("/").pop() ?? value;

  return {
    id: `file:${value}`,
    kind: "file",
    value,
    name,
    preview: "markdown",
    confidence: 100,
    reason: "test",
    exists: true,
    size: name.length,
  };
}

function findFilesTab(tabs: PanelTab[]): FilesPanelTab | undefined {
  const tab = tabs.find((entry) => entry.type === "files");

  return tab?.type === "files" ? tab : undefined;
}

function filesTab(tabs: PanelTab[]) {
  const tab = findFilesTab(tabs);
  assert.ok(tab, "expected a files tab");
  return tab;
}

function makeBrowserTab(id: string, ownerSessionId: string): BrowserPanelTab {
  return {
    id,
    type: "browser",
    label: "New tab",
    url: "",
    favicon: null,
    status: "ready",
    canGoBack: false,
    canGoForward: false,
    ownerSessionId,
    siteToolCount: 0,
    siteTools: [],
    siteToolActivity: [],
  };
}

function sessionState(sessionId: string) {
  const session = usePanelTabStore.getState().sessions[sessionId];
  assert.ok(session, `expected session ${sessionId}`);
  return session;
}

function makeArtifactTab(value: string, withTarget: boolean): PanelTab {
  return {
    id: `file:${value}`,
    type: "artifact",
    label: value,
    preview: "markdown",
    ...(withTarget ? { target: makeFileTarget(value) } : {}),
  };
}

test("Files & artifacts opens a single blank files tab", () => {
  const store = usePanelTabStore.getState();
  store.openTab("s-blank", { id: WORKSPACE_FILES_TAB_ID, type: "files", label: "Files" });

  const session = usePanelTabStore.getState().sessions["s-blank"] ?? { tabs: [], activeTabId: null };
  assert.equal(session.tabs.length, 1);
  assert.equal(session.activeTabId, WORKSPACE_FILES_TAB_ID);
  const tab = filesTab(session.tabs);
  assert.equal(tab.label, "Files");
  assert.equal(tab.target ?? null, null);
});

test("clicking the first file consumes the blank files tab in place", () => {
  const store = usePanelTabStore.getState();
  store.openTab("s-first", { id: WORKSPACE_FILES_TAB_ID, type: "files", label: "Files" });
  store.openTab("s-first", {
    id: WORKSPACE_FILES_TAB_ID,
    type: "files",
    label: "README.md",
    target: makeFileTarget("README.md"),
  });

  const session = usePanelTabStore.getState().sessions["s-first"] ?? { tabs: [], activeTabId: null };
  assert.equal(session.tabs.length, 1, "the blank tab is replaced, not stacked");
  const tab = filesTab(session.tabs);
  assert.equal(tab.id, WORKSPACE_FILES_TAB_ID);
  assert.equal(tab.label, "README.md");
  assert.equal(tab.target?.value, "README.md");
  assert.equal(session.activeTabId, WORKSPACE_FILES_TAB_ID);
});

test("clicking a second file opens a separate artifact tab", () => {
  const store = usePanelTabStore.getState();
  store.openTab("s-second", { id: WORKSPACE_FILES_TAB_ID, type: "files", label: "Files" });
  store.openTab("s-second", {
    id: WORKSPACE_FILES_TAB_ID,
    type: "files",
    label: "one.md",
    target: makeFileTarget("one.md"),
  });
  store.openTab("s-second", {
    id: "file:two.md",
    type: "artifact",
    label: "two.md",
    preview: "markdown",
    target: makeFileTarget("two.md"),
  });

  const session = usePanelTabStore.getState().sessions["s-second"] ?? { tabs: [], activeTabId: null };
  assert.equal(session.tabs.length, 2);
  assert.equal(session.activeTabId, "file:two.md");
  assert.equal(filesTab(session.tabs).target?.value, "one.md");
  const artifactTab = session.tabs.find((entry) => entry.type === "artifact");
  assert.ok(artifactTab);
  assert.equal(artifactTab.type, "artifact");
  if (artifactTab.type === "artifact") {
    assert.equal(artifactTab.label, "two.md");
  }
});

test("the blank files tab never spawns extra copies across reopenings", () => {
  const store = usePanelTabStore.getState();
  store.openTab("s-reopen", { id: WORKSPACE_FILES_TAB_ID, type: "files", label: "Files" });
  store.openTab("s-reopen", { id: WORKSPACE_FILES_TAB_ID, type: "files", label: "Files" });

  const session = usePanelTabStore.getState().sessions["s-reopen"] ?? { tabs: [], activeTabId: null };
  const filesTabs = session.tabs.filter((entry) => entry.type === "files");
  assert.equal(filesTabs.length, 1);
});

test("openTab selects the matching mode for the tab type", () => {
  const store = usePanelTabStore.getState();
  store.openTab("s-mode", { id: WORKSPACE_FILES_TAB_ID, type: "files", label: "Files" });
  assert.equal(sessionState("s-mode").mode, "files");

  store.openTab("s-mode", makeBrowserTab("browser-1", "s-mode"));
  assert.equal(sessionState("s-mode").mode, "browser");
  assert.equal(sessionState("s-mode").activeTabId, "browser-1");
});

test("setPanelMode restores each mode's last active tab", () => {
  const store = usePanelTabStore.getState();
  store.openTab("s-memory", { id: WORKSPACE_FILES_TAB_ID, type: "files", label: "Files" });
  store.openTab("s-memory", makeArtifactTab("notes.md", true));
  store.openTab("s-memory", makeBrowserTab("browser-2", "s-memory"));

  assert.equal(sessionState("s-memory").mode, "browser");

  store.setPanelMode("s-memory", "files");
  assert.equal(sessionState("s-memory").mode, "files");
  assert.equal(sessionState("s-memory").activeTabId, "file:notes.md");

  store.setPanelMode("s-memory", "browser");
  assert.equal(sessionState("s-memory").activeTabId, "browser-2");
});

test("closing the active files tab resolves within files mode, not to a browser tab", () => {
  const store = usePanelTabStore.getState();
  store.openTab("s-close", { id: WORKSPACE_FILES_TAB_ID, type: "files", label: "Files" });
  store.openTab("s-close", makeArtifactTab("one.md", true));
  store.openTab("s-close", makeBrowserTab("browser-3", "s-close"));

  store.setPanelMode("s-close", "files");
  assert.equal(sessionState("s-close").activeTabId, "file:one.md");

  store.closeTab("s-close", "file:one.md");

  const session = sessionState("s-close");
  assert.equal(session.mode, "files");
  assert.equal(session.activeTabId, WORKSPACE_FILES_TAB_ID);
});

test("background browser sync never steals an empty files-mode selection", () => {
  const store = usePanelTabStore.getState();
  store.openTab("s-idle", { id: WORKSPACE_FILES_TAB_ID, type: "files", label: "Files" });
  store.selectTab("s-idle", null);
  assert.equal(sessionState("s-idle").activeTabId, null);

  store.syncBrowserTabs("s-idle", [makeBrowserTab("browser-4", "s-idle")], "browser-4");

  const session = sessionState("s-idle");
  assert.equal(session.mode, "files");
  assert.equal(session.activeTabId, null);
  assert.ok(session.tabs.some((tab) => tab.id === "browser-4"), "the browser tab is retained");
});

test("browser sync adopts the electron active tab in browser mode", () => {
  const store = usePanelTabStore.getState();
  store.syncBrowserTabs("s-sync", [makeBrowserTab("browser-5", "s-sync")], "browser-5");

  assert.equal(sessionState("s-sync").mode, "browser");
  assert.equal(sessionState("s-sync").activeTabId, "browser-5");
});

test("reconcile resolves the active tab within files mode", () => {
  const store = usePanelTabStore.getState();
  store.openTab("s-reconcile", { id: WORKSPACE_FILES_TAB_ID, type: "files", label: "Files" });
  store.openTab("s-reconcile", makeArtifactTab("stale.md", false));
  store.openTab("s-reconcile", makeBrowserTab("browser-6", "s-reconcile"));

  store.setPanelMode("s-reconcile", "files");
  assert.equal(sessionState("s-reconcile").activeTabId, "file:stale.md");

  store.syncTranscriptArtifacts("s-reconcile", []);

  const session = sessionState("s-reconcile");
  assert.equal(session.mode, "files");
  assert.equal(session.activeTabId, WORKSPACE_FILES_TAB_ID);
  assert.ok(!session.tabs.some((tab) => tab.id === "file:stale.md"), "the stale artifact tab is dropped");
});

test("the + button appends a new blank files explorer tab instead of replacing", () => {
  const store = usePanelTabStore.getState();
  store.openTab("s-plus", { id: WORKSPACE_FILES_TAB_ID, type: "files", label: "Files" });
  store.openTab("s-plus", {
    id: WORKSPACE_FILES_TAB_ID,
    type: "files",
    label: "README.md",
    target: makeFileTarget("README.md"),
  });

  const secondId = createWorkspaceFilesTabId();
  assert.notEqual(secondId, WORKSPACE_FILES_TAB_ID);
  store.openTab("s-plus", { id: secondId, type: "files", label: "Files" });

  const session = sessionState("s-plus");
  const filesTabs = session.tabs.filter((tab) => tab.type === "files");
  assert.equal(filesTabs.length, 2, "a second files explorer tab is added");
  assert.equal(session.activeTabId, secondId);
  assert.equal(filesTab(session.tabs.filter((tab) => tab.id === WORKSPACE_FILES_TAB_ID)).target?.value, "README.md");
});

test("files explorer tab ids are unique", () => {
  const first = createWorkspaceFilesTabId();
  const second = createWorkspaceFilesTabId();
  assert.notEqual(first, second);
});
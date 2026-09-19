import assert from "node:assert/strict";
import { test } from "node:test";

import type { FilesPanelTab, PanelTab } from "./panel-tab-store";
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

const { usePanelTabStore, WORKSPACE_FILES_TAB_ID } = await import("./panel-tab-store");

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
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { isCollectibleArtifactTarget, type OpenTarget, type OpenTargetPreview } from "../artifacts/open-target";

export const PERSISTED_PANEL_TAB_STORE_KEY = "openwork:panel-tabs:v1";

export type PanelTabType = "artifact" | "browser" | "app" | "files";

export const WORKSPACE_FILES_TAB_ID = "workspace-files";

// Extra Files explorer tabs (opened with the panel's + button) need their own
// ids so openTab appends instead of replacing the existing explorer tab.
export function createWorkspaceFilesTabId(): string {
  return `workspace-files:${crypto.randomUUID()}`;
}

export type { BrowserPanelTab } from "../../../../app/lib/desktop-types";
import type { BrowserPanelTab } from "../../../../app/lib/desktop-types";

export type ArtifactPanelTab = {
  id: string;
  type: "artifact";
  label: string;
  preview: OpenTargetPreview;
  target?: OpenTarget;
}

export type AppPanelTab = { id: string; type: "app"; label: string; appId: string; revisionId?: string; receiptId?: string };

export type FilesPanelTab = {
  id: string;
  type: "files";
  label: string;
  target?: OpenTarget | null;
};

export type PanelTab = BrowserPanelTab | ArtifactPanelTab | AppPanelTab | FilesPanelTab;

// The right panel shows one mode at a time: the Browser rail shows browser tabs,
// the Files rail shows everything the Files explorer owns. The rail is a filter
// over a single tabs array, not a separate store.
export type PanelMode = "browser" | "files";

export function modeForTabType(type: PanelTabType): PanelMode {
  return type === "browser" ? "browser" : "files";
}

export function tabsForMode(tabs: PanelTab[], mode: PanelMode): PanelTab[] {
  return tabs.filter((tab) => modeForTabType(tab.type) === mode);
}

// Only files/artifact tabs carry an open target; browser/app tabs do not.
export function panelTabTarget(tab: PanelTab): OpenTarget | undefined {
  return tab.type === "files" || tab.type === "artifact" ? tab.target ?? undefined : undefined;
}

export type SessionPanelState = {
  tabs: PanelTab[];
  activeTabId: string | null;
  mode: PanelMode;
  // Which tab each rail should reselect when the user switches back to it.
  activeTabIds: Record<PanelMode, string | null>;
};

type PersistedPanelTabRef = {
  id: string;
  type: PanelTabType;
};

type PersistedSessionPanelState = {
  tabs: PersistedPanelTabRef[];
  activeTabId: string | null;
};

type PersistedPanelTabStore = {
  sessions: Record<string, PersistedSessionPanelState>;
};

export type OpenFileTargetOptions = {
  // When the file is picked from a blank Files explorer tab, consume that tab in
  // place so the explorer becomes the preview instead of spawning an extra tab.
  consumeTabId?: string;
};

export type PanelTabStore = {
  sessions: Record<string, SessionPanelState>;
  transcriptArtifactTargets: Record<string, OpenTarget[]>;
  openTab: (sessionId: string, tab: PanelTab) => void;
  openFileTarget: (sessionId: string, target: OpenTarget, options?: OpenFileTargetOptions) => void;
  closeTab: (sessionId: string, tabId: string) => void;
  selectTab: (sessionId: string, tabId: string | null) => void;
  setPanelMode: (sessionId: string, mode: PanelMode) => void;
  reorderTabs: (sessionId: string, tabIds: string[]) => void;
  syncBrowserTabs: (sessionId: string, browserTabs: BrowserPanelTab[], activeBrowserTabId: string | null) => void;
  syncArtifactTargets: (
    sessionId: string,
    targets: Array<{ id: string; name: string; preview: OpenTargetPreview }>,
  ) => void;
  syncTranscriptArtifacts: (sessionId: string, targets: OpenTarget[]) => void;
  clearSession: (sessionId: string) => void;
};

const EMPTY_SESSION: SessionPanelState = {
  tabs: [],
  activeTabId: null,
  mode: "browser",
  activeTabIds: { browser: null, files: null },
};

function getWritableSession(state: PanelTabStore, sessionId: string): SessionPanelState {
  return state.sessions[sessionId] ?? EMPTY_SESSION;
}

// Every active-tab change records the selection against its mode so each rail
// can reselect its last tab when the user switches back.
function withActiveTab(
  session: SessionPanelState,
  updates: { tabs?: PanelTab[]; mode?: PanelMode; activeTabId: string | null },
): SessionPanelState {
  const mode = updates.mode ?? session.mode;

  return {
    tabs: updates.tabs ?? session.tabs,
    mode,
    activeTabId: updates.activeTabId,
    activeTabIds: {
      ...session.activeTabIds,
      [mode]: updates.activeTabId,
    },
  };
}

function updateSession(
  state: PanelTabStore,
  sessionId: string,
  session: SessionPanelState,
): Partial<PanelTabStore> {
  return {
    sessions: {
      ...state.sessions,
      [sessionId]: session,
    },
  };
}

function reconcileOpenArtifactTabs(
  session: SessionPanelState,
  targets: Array<{ id: string; name: string; preview: OpenTargetPreview }>,
): SessionPanelState {
  const targetMap = new Map(targets.map((target) => [target.id, target]));

  const tabs = session.tabs
    .map((tab) => {
      if (tab.type !== "artifact") {
        return tab;
      }

      const target = targetMap.get(tab.id);

      if (!target) {
        return tab.target ? tab : null;
      }

      return {
        ...tab,
        label: target.name,
        preview: target.preview,
      };
    })
    .filter((tab): tab is PanelTab => tab !== null);

  const activeTabId = session.activeTabId === null
    ? null
    : resolveActiveTabId(tabsForMode(tabs, session.mode), session.activeTabId);

  return withActiveTab(session, { tabs, activeTabId });
}

function isSameTranscriptArtifactTargets(left: OpenTarget[], right: OpenTarget[]) {
  return (
    left.length === right.length &&
    left.every((target, index) => {
      const other = right[index];
      return other && target.id === other.id && target.updatedAt === other.updatedAt;
    })
  );
}

function resolveActiveTabId<Tab extends { id: string }>(
  tabs: Tab[],
  preferredActiveTabId: string | null,
): string | null {
  if (preferredActiveTabId && tabs.some((tab) => tab.id === preferredActiveTabId)) {
    return preferredActiveTabId;
  }

  return tabs[0]?.id ?? null;
}

function isSameTab(left: PanelTab, right: PanelTab) {
  if (left.id !== right.id || left.type !== right.type) {
    return false;
  }

  if (left.type === "artifact" && right.type === "artifact") {
    return (
      left.label === right.label &&
      left.preview === right.preview
      && left.target?.id === right.target?.id
      && left.target?.updatedAt === right.target?.updatedAt
    );
  }

  if (left.type === "app" && right.type === "app") {
    return left.label === right.label && left.appId === right.appId && left.revisionId === right.revisionId && left.receiptId === right.receiptId;
  }

  if (left.type === "browser" && right.type === "browser") {
    return (
      left.label === right.label &&
      left.url === right.url &&
      left.favicon === right.favicon &&
      left.status === right.status &&
      left.automationProtected === right.automationProtected &&
      left.canGoBack === right.canGoBack &&
      left.canGoForward === right.canGoForward &&
      left.ownerSessionId === right.ownerSessionId &&
      JSON.stringify(left.browserApproval) === JSON.stringify(right.browserApproval) &&
      JSON.stringify(left.loadError) === JSON.stringify(right.loadError) &&
      JSON.stringify(left.browserTask) === JSON.stringify(right.browserTask) &&
      left.siteToolCount === right.siteToolCount &&
      JSON.stringify(left.siteTools) === JSON.stringify(right.siteTools) &&
      JSON.stringify(left.siteToolActivity) === JSON.stringify(right.siteToolActivity)
    );
  }

  if (left.type === "files" && right.type === "files") {
    return (
      left.label === right.label &&
      (left.target?.id ?? null) === (right.target?.id ?? null) &&
      (left.target?.updatedAt ?? null) === (right.target?.updatedAt ?? null)
    );
  }

  return false;
}

function isSameSessionPanelState(
  session: SessionPanelState,
  tabs: PanelTab[],
  activeTabId: string | null,
  mode: PanelMode,
) {
  return (
    session.mode === mode &&
    session.tabs.length === tabs.length &&
    session.activeTabId === activeTabId &&
    session.tabs.every((tab, index) => isSameTab(tab, tabs[index]))
  );
}

function mergePersistedSessions(
  persistedState: unknown,
  currentState: PanelTabStore,
): PanelTabStore {
  const persisted = persistedState as PersistedPanelTabStore | undefined;

  if (!persisted?.sessions) {
    return currentState;
  }

  const sessions: Record<string, SessionPanelState> = {};

  for (const [sessionId, session] of Object.entries(persisted.sessions)) {
    const tabs = session.tabs
      .filter(({ type }) => type === "browser")
      .map(({ id }): PanelTab => ({
        id,
        type: "browser",
        label: "New tab",
        url: "",
        favicon: null,
        status: "ready",
        canGoBack: false,
        canGoForward: false,
        ownerSessionId: sessionId,
        siteToolCount: 0,
        siteTools: [],
        siteToolActivity: [],
      }));

    const activeTabId = session.activeTabId === null ? null : resolveActiveTabId(tabs, session.activeTabId);

    sessions[sessionId] = {
      tabs,
      activeTabId,
      mode: "browser",
      activeTabIds: { browser: activeTabId, files: null },
    };
  }

  return {
    ...currentState,
    sessions,
  };
}

export const usePanelTabStore = create<PanelTabStore>()(
  persist(
    (set, get) => ({
      sessions: {},
      transcriptArtifactTargets: {},
      openTab: (sessionId, tab) => set((state) => {
        const session = getWritableSession(state, sessionId);
        const existingIndex = session.tabs.findIndex((entry) => entry.id === tab.id);
        const mode = modeForTabType(tab.type);
        const tabs = existingIndex >= 0
          ? session.tabs.map((entry, index) => (index === existingIndex ? tab : entry))
          : [...session.tabs, tab];

        return updateSession(state, sessionId, withActiveTab(session, { tabs, mode, activeTabId: tab.id }));
      }),
      // A file consumed by the Files explorer lives under the Files tab id, not
      // its `file:` id. Dedupe by target id across every tab so reopening a file
      // selects the tab that already shows it instead of spawning a duplicate.
      openFileTarget: (sessionId, target, options) => set((state) => {
        const session = getWritableSession(state, sessionId);
        const existing = session.tabs.find((tab) => panelTabTarget(tab)?.id === target.id);

        if (existing) {
          const mode = modeForTabType(existing.type);
          if (session.activeTabId === existing.id && session.mode === mode) {
            return state;
          }

          return updateSession(state, sessionId, withActiveTab(session, { mode, activeTabId: existing.id }));
        }

        const consumeTab = options?.consumeTabId
          ? session.tabs.find((tab) => tab.id === options.consumeTabId && tab.type === "files" && !tab.target)
          : undefined;

        const tab: PanelTab = consumeTab
          ? { id: consumeTab.id, type: "files", label: target.name, target }
          : { id: target.id, type: "artifact", label: target.name, preview: target.preview, target };
        const tabs = consumeTab
          ? session.tabs.map((entry) => (entry.id === consumeTab.id ? tab : entry))
          : [...session.tabs, tab];
        const mode = modeForTabType(tab.type);

        return updateSession(state, sessionId, withActiveTab(session, { tabs, mode, activeTabId: tab.id }));
      }),
      closeTab: (sessionId, tabId) => set((state) => {
        const session = getWritableSession(state, sessionId);
        const index = session.tabs.findIndex((tab) => tab.id === tabId);
        if (index < 0) {
          return state;
        }

        const tabs = session.tabs.filter((tab) => tab.id !== tabId);

        if (session.activeTabId !== tabId) {
          return updateSession(state, sessionId, { ...session, tabs });
        }

        // Resolve the next tab within the current mode so closing a files tab
        // never lands on a browser tab (and vice versa).
        const modeTabs = tabsForMode(session.tabs, session.mode);
        const closedIndex = modeTabs.findIndex((tab) => tab.id === tabId);
        const neighbourId = modeTabs[closedIndex + 1]?.id ?? modeTabs[closedIndex - 1]?.id ?? null;
        const activeTabId = resolveActiveTabId(tabsForMode(tabs, session.mode), neighbourId);

        return updateSession(state, sessionId, withActiveTab(session, { tabs, activeTabId }));
      }),
      selectTab: (sessionId, tabId) => set((state) => {
        const session = getWritableSession(state, sessionId);

        if (tabId === null) {
          if (session.activeTabId === null) {
            return state;
          }

          return updateSession(state, sessionId, withActiveTab(session, { activeTabId: null }));
        }

        const tab = session.tabs.find((entry) => entry.id === tabId);
        if (!tab) {
          return state;
        }

        const mode = modeForTabType(tab.type);
        if (session.activeTabId === tabId && session.mode === mode) {
          return state;
        }

        return updateSession(state, sessionId, withActiveTab(session, { mode, activeTabId: tabId }));
      }),
      setPanelMode: (sessionId, mode) => set((state) => {
        const session = getWritableSession(state, sessionId);
        if (session.mode === mode) {
          return state;
        }

        const remembered = session.activeTabIds[mode];
        const activeTabId = resolveActiveTabId(tabsForMode(session.tabs, mode), remembered);

        return updateSession(state, sessionId, withActiveTab(session, { mode, activeTabId }));
      }),
      reorderTabs: (sessionId, tabIds) => set((state) => {
        const session = getWritableSession(state, sessionId);
        const tabsById = new Map(session.tabs.map((tab) => [tab.id, tab]));
        const reorderedTabs = tabIds
          .map((tabId) => tabsById.get(tabId))
          .filter((tab): tab is PanelTab => Boolean(tab));

        if (reorderedTabs.length !== session.tabs.length) {
          return state;
        }

        return updateSession(state, sessionId, {
          ...session,
          tabs: reorderedTabs,
        });
      }),
      syncBrowserTabs: (sessionId, browserTabs, activeBrowserTabId) => set((state) => {
        const session = getWritableSession(state, sessionId);
        const browserTabsById = new Map(browserTabs.map((tab) => [tab.id, tab]));

        const mergedTabs: PanelTab[] = [];

        for (const tab of session.tabs) {
          if (tab.type !== "browser") {
            mergedTabs.push(tab);
            continue;
          }

          const browserTab = browserTabsById.get(tab.id);
          if (browserTab) {
            mergedTabs.push(browserTab);
            browserTabsById.delete(tab.id);
          }
        }

        for (const browserTab of browserTabsById.values()) {
          mergedTabs.push(browserTab);
        }

        // A null selection with retained tabs is the Files empty state, not
        // permission for background browser updates to take over the panel.
        const shouldSyncActiveFromElectron = session.tabs.length === 0 || session.mode === "browser";
        const mode = shouldSyncActiveFromElectron ? "browser" : session.mode;
        const activeTabId = shouldSyncActiveFromElectron
          ? resolveActiveTabId(tabsForMode(mergedTabs, "browser"), activeBrowserTabId)
          : session.activeTabId === null
            ? null
            : resolveActiveTabId(tabsForMode(mergedTabs, mode), session.activeTabId);

        if (isSameSessionPanelState(session, mergedTabs, activeTabId, mode)) {
          return state;
        }

        return updateSession(state, sessionId, withActiveTab(session, { tabs: mergedTabs, mode, activeTabId }));
      }),
      syncArtifactTargets: (sessionId, targets) => set((state) => {
        const session = getWritableSession(state, sessionId);
        const nextSession = reconcileOpenArtifactTabs(session, targets);

        if (isSameSessionPanelState(session, nextSession.tabs, nextSession.activeTabId, nextSession.mode)) {
          return state;
        }

        return updateSession(state, sessionId, nextSession);
      }),
      syncTranscriptArtifacts: (sessionId, targets) => set((state) => {
        const currentTranscript = state.transcriptArtifactTargets[sessionId] ?? [];
        const session = getWritableSession(state, sessionId);
        const collectibleTargets = targets
          .filter(isCollectibleArtifactTarget)
          .map((target) => ({
            id: target.id,
            name: target.name,
            preview: target.preview,
          }));
        const nextSession = reconcileOpenArtifactTabs(session, collectibleTargets);
        const transcriptChanged = !isSameTranscriptArtifactTargets(currentTranscript, targets);
        const sessionChanged = !isSameSessionPanelState(session, nextSession.tabs, nextSession.activeTabId, nextSession.mode);

        if (!transcriptChanged && !sessionChanged) {
          return state;
        }

        const sessionUpdate = sessionChanged ? updateSession(state, sessionId, nextSession) : null;

        return {
          transcriptArtifactTargets: transcriptChanged ? {
            ...state.transcriptArtifactTargets,
            [sessionId]: targets,
          } : state.transcriptArtifactTargets,
          sessions: sessionUpdate?.sessions ?? state.sessions,
        };
      }),
      clearSession: (sessionId) => set((state) => {
        const nextSessions = { ...state.sessions };
        const nextTranscriptArtifactTargets = { ...state.transcriptArtifactTargets };
        
        let changed = false;

        if (state.sessions[sessionId]) {
          delete nextSessions[sessionId];
          changed = true;
        }

        if (state.transcriptArtifactTargets[sessionId]) {
          delete nextTranscriptArtifactTargets[sessionId];
          changed = true;
        }

        if (!changed) {
          return state;
        }

        return {
          sessions: nextSessions,
          transcriptArtifactTargets: nextTranscriptArtifactTargets,
        };
      }),
    }),
    {
      name: PERSISTED_PANEL_TAB_STORE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        sessions: Object.fromEntries(
          Object.entries(state.sessions).map(([sessionId, session]) => {
            const tabs = session.tabs
              .filter((tab) => tab.type === "browser")
              .map(({ id, type }) => ({ id, type }));

            return [
              sessionId,
              {
                tabs,
                activeTabId: session.activeTabId === null ? null : resolveActiveTabId(tabs, session.activeTabId),
              },
            ];
          }),
        ),
      }),
      merge: (persistedState, currentState) => mergePersistedSessions(persistedState, currentState),
    },
  ),
);

export function useSessionPanelState(sessionId: string): SessionPanelState {
  return usePanelTabStore((state) => state.sessions[sessionId] ?? EMPTY_SESSION);
}

export function useActivePanelTab(sessionId: string): PanelTab | null {
  return usePanelTabStore((state) => {
    const session = state.sessions[sessionId] ?? EMPTY_SESSION;

    return session.tabs.find((tab) => tab.id === session.activeTabId) ?? null;
  });
}

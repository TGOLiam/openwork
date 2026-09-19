/** @jsxImportSource react */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, X } from "lucide-react";

import type { OpenworkServerClient, OpenworkWorkspaceCatalog, OpenworkWorkspaceCatalogEntry } from "@/app/lib/openwork-server";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { type FilesPanelTab, usePanelTabStore } from "../panel/panel-tab-store";
import { ArtifactPanelView } from "./artifact-panel";
import { openTargetFromWorkspaceFile } from "./open-target";
import { useWorkspaceFileActions } from "./workspace-file-actions";
import { workspaceFileTreeQueryKey, WorkspaceFileTree, type WorkspaceFileAction } from "./workspace-file-tree";

const EMPTY_CATALOG: OpenworkWorkspaceCatalog = { items: [], total: 0, truncated: false };

type WorkspaceFilesPanelProps = {
  sessionId: string;
  tab: FilesPanelTab;
  client: OpenworkServerClient | null;
  workspaceId: string | null;
  workspaceRoot: string;
  isRemoteWorkspace?: boolean;
  onClose: () => void;
};

export function WorkspaceFilesPanel({
  sessionId,
  tab,
  client,
  workspaceId,
  workspaceRoot,
  isRemoteWorkspace = false,
  onClose,
}: WorkspaceFilesPanelProps) {
  const { canUseDesktopWorkspaceActions, workspaceName, downloadFile, openFileExternally, revealFile } = useWorkspaceFileActions(
    client,
    workspaceId,
    workspaceRoot,
    isRemoteWorkspace,
  );
  const target = tab.target ?? null;
  const filesQuery = useQuery({
    queryKey: workspaceFileTreeQueryKey(workspaceId ?? ""),
    queryFn: async () => {
      if (!client || !workspaceId) {
        return EMPTY_CATALOG;
      }

      return client.listWorkspaceFiles(workspaceId);
    },
    enabled: Boolean(client && workspaceId),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const hasWorkspaceFiles = (filesQuery.data?.items.length ?? 0) > 0;

  // The blank Files tab is consumed by the first file picked from the tree.
  // openFileTarget dedupes by target id, so picking a file that is already open
  // (here or in an artifact tab) reselects it instead of opening a duplicate.
  const openWorkspaceFile = (entry: { path: string; size: number; mtimeMs: number }) => {
    const nextTarget = openTargetFromWorkspaceFile(entry.path, { size: entry.size, updatedAt: entry.mtimeMs });
    if (!nextTarget) return;

    // Re-rendering into ArtifactPanelView re-selects the active file via
    // selectedPath, which fires onSelectionChange again and would open a
    // duplicate artifact tab for the file we just consumed. A pick of the
    // currently-previewed file is a selection echo, not an open.
    if (target && target.value === entry.path) return;

    usePanelTabStore.getState().openFileTarget(sessionId, nextTarget, { consumeTabId: tab.id });
  };

  const fileActions = useMemo<readonly WorkspaceFileAction[]>(() => [
    { id: "download", label: "Download", run: (entry) => void downloadFile(entry.path, entry.path.split(/[/\\]/).pop() ?? entry.path) },
    ...(canUseDesktopWorkspaceActions
      ? [
        { id: "reveal", label: "Show in folder", run: (entry: OpenworkWorkspaceCatalogEntry) => void revealFile(entry.path) },
        { id: "open-external", label: "Open externally", run: (entry: OpenworkWorkspaceCatalogEntry) => void openFileExternally(entry.path) },
      ]
      : []),
  ], [canUseDesktopWorkspaceActions, downloadFile, openFileExternally, revealFile]);

  if (!client || !workspaceId) {
    return null;
  }

  if (target) {
    return (
      <ArtifactPanelView
        sessionId={sessionId}
        client={client}
        workspaceId={workspaceId}
        workspaceRoot={workspaceRoot}
        isRemoteWorkspace={isRemoteWorkspace}
        target={target}
        onClose={onClose}
        onOpenFile={openWorkspaceFile}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="shrink-0 border-b border-border bg-background mac:bg-background/80 mac:backdrop-blur-2xl mac:backdrop-saturate-150">
        <div className="flex h-10 items-center gap-2 pe-2 ps-2">
          <div className="min-w-0 flex-1 flex items-center gap-1.5">
            <h3 className="min-w-0 truncate text-sm font-medium text-foreground">{tab.label}</h3>
          </div>
          <Tooltip>
            <TooltipTrigger
              render={(
                <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close workspace files">
                  <X />
                </Button>
              )}
            />
            <TooltipContent>Close</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1 overflow-hidden">
        <ResizablePanel
          id="workspace-files-explorer"
          defaultSize="280px"
          minSize="200px"
          maxSize="420px"
          className="min-h-0"
        >
          <WorkspaceFileTree
            client={client}
            workspaceId={workspaceId}
            workspaceName={workspaceName}
            selectedPath=""
            onOpenFile={openWorkspaceFile}
            fileActions={fileActions}
          />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel id="workspace-files-blank-preview" minSize="280px" className="min-h-0 min-w-0">
          <div className="flex h-full min-h-0 flex-col items-center justify-center gap-2 p-6 text-center">
            <span className="flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <FileText className="size-5" aria-hidden="true" />
            </span>
            {hasWorkspaceFiles ? (
              <>
                <h2 className="text-base font-medium text-foreground">Click a file to preview it</h2>
                <p className="mt-1 max-w-72 text-sm leading-6 text-muted-foreground">
                  Browse your workspace in the explorer, or start a conversation to create artifacts here.
                </p>
              </>
            ) : (
              <>
                <h2 className="text-base font-medium text-foreground">This workspace is empty</h2>
                <p className="mt-1 max-w-72 text-sm leading-6 text-muted-foreground">
                  Files you or your agent create in this workspace will appear in the explorer.
                </p>
              </>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
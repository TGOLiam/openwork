/** @jsxImportSource react */
import { useCallback } from "react";

import { openDesktopPath, revealDesktopItemInDir } from "@/app/lib/desktop";
import type { OpenworkServerClient } from "@/app/lib/openwork-server";
import { toast } from "@/components/ui/sonner";
import { usePlatform } from "@/react-app/kernel/platform";

export function absoluteWorkspacePath(root: string, path: string) {
  const cleanRoot = root.trim().replace(/[/\\]+$/, "");
  const cleanPath = path.trim().replace(/^\.\//, "");

  return cleanRoot ? `${cleanRoot}/${cleanPath}` : cleanPath;
}

export function useWorkspaceFileActions(
  client: OpenworkServerClient | null,
  workspaceId: string | null,
  workspaceRoot: string,
  isRemoteWorkspace: boolean,
) {
  const platform = usePlatform();
  const canUseDesktopWorkspaceActions = !isRemoteWorkspace && platform.capabilities.revealInFileManager;
  const workspaceName = workspaceRoot.split(/[/\\]/).filter(Boolean).pop() ?? "Workspace";

  const downloadFile = useCallback(async (path: string, name: string) => {
    if (!client || !workspaceId) return;
    const result = await client.downloadWorkspaceFile(workspaceId, path);
    const url = URL.createObjectURL(new Blob([result.data], { type: result.contentType ?? "application/octet-stream" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [client, workspaceId]);

  const openFileExternally = useCallback(async (path: string) => {
    if (isRemoteWorkspace) {
      await downloadFile(path, path.split(/[/\\]/).pop() ?? path);

      return;
    }

    try {
      await openDesktopPath(absoluteWorkspacePath(workspaceRoot, path));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not open this file.");
    }
  }, [downloadFile, isRemoteWorkspace, workspaceRoot]);

  const revealFile = useCallback(async (path: string) => {
    if (isRemoteWorkspace) return;
    try {
      await revealDesktopItemInDir(absoluteWorkspacePath(workspaceRoot, path));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not show this file in your file manager.");
    }
  }, [isRemoteWorkspace, workspaceRoot]);

  return { canUseDesktopWorkspaceActions, workspaceName, downloadFile, openFileExternally, revealFile };
}
export const WORKSPACE_PENDING_PANEL_KEY = "dashboard-pending-panel";

export type WorkspacePendingPanel = "calendar" | "messages";

export function setPendingWorkspacePanel(panel: WorkspacePendingPanel) {
  try {
    sessionStorage.setItem(WORKSPACE_PENDING_PANEL_KEY, panel);
  } catch {
    /* noop */
  }
}

export function peekPendingWorkspacePanel(): WorkspacePendingPanel | null {
  try {
    const value = sessionStorage.getItem(WORKSPACE_PENDING_PANEL_KEY);
    if (value === "calendar" || value === "messages") return value;
  } catch {
    /* noop */
  }
  return null;
}

export function consumePendingWorkspacePanel(): WorkspacePendingPanel | null {
  try {
    const value = sessionStorage.getItem(WORKSPACE_PENDING_PANEL_KEY);
    if (!value) return null;
    sessionStorage.removeItem(WORKSPACE_PENDING_PANEL_KEY);
    if (value === "calendar" || value === "messages") return value;
  } catch {
    /* noop */
  }
  return null;
}

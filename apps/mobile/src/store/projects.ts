/**
 * Projects tab state, backed by the v0.18.0 `projects.*` RPCs. On gateways
 * older than v0.18.0 the RPCs don't exist — surface that as a friendly
 * "needs upgrade" state instead of an error wall.
 */

import { atom } from 'nanostores';

import type { ProjectsTreeResult } from '../gateway/types';
import { peekGateway } from './connection';

export interface ProjectsSnapshot {
  loading: boolean;
  tree: ProjectsTreeResult | null;
  unsupported: boolean;
  error: string | null;
}

export const $projects = atom<ProjectsSnapshot>({
  loading: false,
  tree: null,
  unsupported: false,
  error: null,
});

export async function loadProjects(): Promise<void> {
  const gateway = peekGateway();
  if (!gateway) {
    return;
  }
  $projects.set({ ...$projects.get(), loading: true, error: null });
  try {
    const tree = await gateway.projectsTree();
    $projects.set({ loading: false, tree, unsupported: false, error: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // tui_gateway responds "Unknown method: projects.tree" pre-v0.18.
    const unsupported = /unknown method/i.test(message);
    $projects.set({
      loading: false,
      tree: null,
      unsupported,
      error: unsupported ? null : message,
    });
  }
}

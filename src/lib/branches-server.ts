import { parseBranchList } from '@/lib/branches';

/**
 * The configured family-branch list, read from the environment at REQUEST time.
 *
 * Deliberately a plain server-side variable rather than `NEXT_PUBLIC_*`:
 * `NEXT_PUBLIC_` values are inlined into the browser bundle during `next build`
 * and frozen there, so the same Docker image could not serve two families
 * without a rebuild. Reading it here and handing the resolved array to the
 * browser through `UserPrefsProvider` (see `src/app/layout.tsx`) keeps one build
 * portable across deployments.
 *
 * Server components, server actions, route handlers and the CLI scripts call
 * this. CLIENT components must NOT — they read `branches` from `useUserPrefs()`,
 * because in a browser bundle `process.env.FAMILY_BRANCHES` is simply gone and
 * this would silently hand back the demo list. The guard below turns that
 * mistake into an immediate error instead of a wrong-colours mystery.
 */
export function familyBranches(): string[] {
  if (typeof window !== 'undefined') {
    throw new Error(
      'familyBranches() is server-side only — FAMILY_BRANCHES is not in the browser bundle. ' +
      'In a client component read `branches` from useUserPrefs() instead.'
    );
  }
  return parseBranchList(process.env.FAMILY_BRANCHES);
}

import type { EnvironmentId } from "@t3tools/contracts";
import { parseJustfileRecipes, type JustRecipe } from "@t3tools/shared/justfile";
import { useMemo } from "react";

import { useProjectFileQuery } from "~/components/files/projectFilesQueryState";

const NO_RECIPES: ReadonlyArray<JustRecipe> = [];

/**
 * Public recipes from the justfile at the workspace root, offered in the
 * scripts menu. `Justfile` is read only when `justfile` is missing, which
 * matters on case-sensitive filesystems.
 */
export function useJustfileRecipes(
  environmentId: EnvironmentId,
  cwd: string | null,
): ReadonlyArray<JustRecipe> {
  const lower = useProjectFileQuery(environmentId, cwd ?? "", "justfile", cwd !== null);
  const upper = useProjectFileQuery(
    environmentId,
    cwd ?? "",
    "Justfile",
    cwd !== null && !lower.isPending && lower.data === null,
  );
  const data = lower.data ?? upper.data;
  const contents = data && !data.truncated ? data.contents : null;
  return useMemo(
    () => (contents === null ? NO_RECIPES : parseJustfileRecipes(contents)),
    [contents],
  );
}

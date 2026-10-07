import { parseJustfileRecipes } from "@t3tools/shared/justfile";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import type * as Path from "effect/Path";

/**
 * True when the justfile in `directory` has a public recipe called `name` that
 * runs without arguments. `Justfile` is read only when `justfile` is missing.
 */
export const hasRunnableJustRecipe = Effect.fn("hasRunnableJustRecipe")(function* (
  services: { readonly fileSystem: FileSystem.FileSystem; readonly path: Path.Path },
  directory: string,
  name: string,
) {
  const readJustfile = (fileName: string) =>
    services.fileSystem.readFileString(services.path.join(directory, fileName)).pipe(Effect.option);
  const lower = yield* readJustfile("justfile");
  const contents = Option.isSome(lower) ? lower : yield* readJustfile("Justfile");
  return Option.match(contents, {
    onNone: () => false,
    onSome: (text) =>
      parseJustfileRecipes(text).some(
        (recipe) => recipe.name === name && !recipe.hasRequiredParams,
      ),
  });
});

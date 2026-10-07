import { describe, expect, it } from "vite-plus/test";

import { parseJustfileRecipes } from "./justfile.ts";

describe("parseJustfileRecipes", () => {
  it("lists public recipes with their doc comments", () => {
    const recipes = parseJustfileRecipes(`set shell := ["bash", "-c"]
fork_repo := "gstark/t3code"
export TOKEN := env("TOKEN")
alias b := build

default:
    @just --list

# Build the app
build: _check
    vp build

# Detached comment

[private]
hidden:
    echo hidden

_check:
    echo check

[group('ci')]
[doc("Run the tests")]
@test:
    vp test
`);

    expect(recipes).toEqual([
      { name: "default", doc: null, hasRequiredParams: false },
      { name: "build", doc: "Build the app", hasRequiredParams: false },
      { name: "test", doc: "Run the tests", hasRequiredParams: false },
    ]);
  });

  it("flags recipes whose parameters have no default", () => {
    const recipes = parseJustfileRecipes(`serve port=":8080" host='a:b':
    echo
deploy env:
    echo
lint *files:
    echo
push +refs:
    echo
run $mode=(arch() + "x") $level="1": build
    echo
`);

    expect(recipes.map((recipe) => [recipe.name, recipe.hasRequiredParams])).toEqual([
      ["serve", false],
      ["deploy", true],
      ["lint", false],
      ["push", true],
      ["run", false],
    ]);
  });

  it("ignores text inside multi-line strings and recipe bodies", () => {
    const recipes = parseJustfileRecipes(`notes := '''
fake: recipe
'''

real:
    #!/usr/bin/env bash
    echo "not: a recipe"
`);

    expect(recipes.map((recipe) => recipe.name)).toEqual(["real"]);
  });

  it("keeps the last definition of a duplicated recipe", () => {
    const recipes = parseJustfileRecipes(`# first
dup:
    echo 1

# second
dup:
    echo 2
`);

    expect(recipes).toEqual([{ name: "dup", doc: "second", hasRequiredParams: false }]);
  });
});

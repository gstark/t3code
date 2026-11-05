export interface JustRecipe {
  readonly name: string;
  /** The recipe's doc comment or `[doc("...")]` attribute. */
  readonly doc: string | null;
  /** True when `just <name>` alone fails because a parameter has no default. */
  readonly hasRequiredParams: boolean;
}

const RECIPE_NAME = /^@?([A-Za-z_][A-Za-z0-9_-]*)/;
const DOC_ATTRIBUTE = /\bdoc\(\s*(?:"([^"]*)"|'([^']*)')\s*\)/;

/**
 * Public recipes in a justfile, in declaration order. This is a line scanner,
 * not a full parser: it reads only the root file (no `import` or `mod`) and
 * skips private recipes (`_name` or `[private]`).
 */
export function parseJustfileRecipes(contents: string): JustRecipe[] {
  const recipes = new Map<string, JustRecipe>();
  let comment: string | null = null;
  let attributes = "";
  let inMultilineString = false;

  for (const line of contents.split(/\r?\n/)) {
    if ((line.match(/'''|"""/g)?.length ?? 0) % 2 === 1) {
      inMultilineString = !inMultilineString;
      continue;
    }
    if (inMultilineString) continue;
    // A blank line detaches a comment from the next recipe.
    if (line.trim() === "") {
      comment = null;
      attributes = "";
      continue;
    }
    if (/^\s/.test(line)) continue;
    if (line.startsWith("#")) {
      comment = line.replace(/^#\s?/, "").trim() || null;
      continue;
    }
    if (line.startsWith("[")) {
      attributes += line;
      continue;
    }

    const header = parseRecipeHeader(line);
    if (header && !header.name.startsWith("_") && !/\bprivate\b/.test(attributes)) {
      const docAttribute = attributes.match(DOC_ATTRIBUTE);
      recipes.delete(header.name);
      recipes.set(header.name, {
        name: header.name,
        doc: docAttribute ? (docAttribute[1] ?? docAttribute[2] ?? null) : comment,
        hasRequiredParams: header.hasRequiredParams,
      });
    }
    comment = null;
    attributes = "";
  }

  return [...recipes.values()];
}

function parseRecipeHeader(line: string): Omit<JustRecipe, "doc"> | null {
  const nameMatch = line.match(RECIPE_NAME);
  if (!nameMatch?.[1]) return null;
  const rest = line.slice(nameMatch[0].length);

  // Find the colon that ends the parameter list, ignoring colons inside
  // quoted or parenthesized defaults. `:=` means this line is an assignment.
  const params: string[] = [];
  let token = "";
  let quote: string | null = null;
  let depth = 0;
  for (let index = 0; index < rest.length; index += 1) {
    const char = rest[index]!;
    if (quote) {
      if (char === quote) quote = null;
      token += char;
    } else if (char === '"' || char === "'" || char === "`") {
      quote = char;
      token += char;
    } else if (char === "(") {
      depth += 1;
      token += char;
    } else if (char === ")") {
      depth -= 1;
      token += char;
    } else if (depth === 0 && char === ":") {
      if (rest[index + 1] === "=") return null;
      if (token) params.push(token);
      return {
        name: nameMatch[1],
        hasRequiredParams: params.some(isRequiredParam),
      };
    } else if (depth === 0 && /\s/.test(char)) {
      if (token) params.push(token);
      token = "";
    } else {
      token += char;
    }
  }
  return null;
}

function isRequiredParam(param: string): boolean {
  return !param.replace(/^\$/, "").startsWith("*") && !param.includes("=");
}

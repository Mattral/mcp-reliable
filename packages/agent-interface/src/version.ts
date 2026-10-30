import { createRequire } from "node:module";

/** This package's version, read from its own package.json (which npm always publishes) so it can't drift from the released version. `../package.json` resolves to the package root from both `src/` and `dist/`. */
export const VERSION: string = (createRequire(import.meta.url)("../package.json") as { version: string }).version;

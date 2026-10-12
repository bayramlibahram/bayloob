// The modules main and the old pages share (src/shared): plain scripts that set a global in a page and fill
// module.exports where there is one. Importing them runs them: in a window their API is then on globalThis;
// where `module` exists (the test runner) it is the module's default export.
import * as promptFormat from "../../shared/prompt-format.js";
import * as roles from "../../shared/roles.js";

export const PromptFormat = globalThis.PromptFormat ?? promptFormat.default;
export const Roles = globalThis.Roles ?? roles.default;

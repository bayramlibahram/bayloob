// The modules UI and main share (src/shared): plain scripts that set a global in a page and fill
// module.exports where there is one. Importing them runs them: in a window their API is then on globalThis;
// where `module` exists (the test runner) it is the module's default export.

import * as promptFormat from "../../shared/prompt-format.js";
import * as roles from "../../shared/roles.js";
import * as taskShape from "../../shared/task-shape.js";
import * as workflowTemplates from "../../shared/workflow-templates.js";
import * as markdown from "./markdown-lite.js";

export const PromptFormat = globalThis.PromptFormat ?? promptFormat.default;
export const Roles = globalThis.Roles ?? roles.default;
export const TaskShape = globalThis.TaskShape ?? taskShape.default;
export const WorkflowTemplates = globalThis.WorkflowTemplates ?? workflowTemplates.default;
export const { renderMarkdown, plainMarkdown } = globalThis.MarkdownLite ?? markdown.default;

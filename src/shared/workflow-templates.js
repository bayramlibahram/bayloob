// Workflow templates: the stages a task runs, their agents, prompts and gates. Built-in presets ship read-only;
// the owner's own templates live in <userData>/workflows/*.json and go through the same validation.
// Shared by main (engine, template store) and the pages (workflow builder, New task dialog).
// Plain script: `require()` in main and tests, a <script> (global `WorkflowTemplates`) in a page.
//
// A stage:
//   { id, title, role, mode, agents: [{ adapter, count }], parallel, perCandidate, split, prompt, artifact,
//     action, gate, onFail: { goto, prompt, maxLoops } }
// role      planner | builder | tester | reviewer | arbiter | you
// mode      writes | read-only | plan          (agent stages; plan is read-only too, its answer is the plan)
// action    run-tests | integrate | merge      (stages Bayloob runs itself, no agent)
// gate      always | human | tests-pass | arbiter | no-findings
// Builders create the candidates: each instance gets its own worktree + branch. A perCandidate stage runs
// once for every candidate still in the race (tests, reviews).
// Split work: a planner with `split` ends its plan with a JSON block of subtasks, each owning its files; a builder
// stage with `split` runs one builder per subtask (its agents take turns), and the `integrate` action merges
// their branches into one candidate that the later stages test, review and merge.
// A task without builders (Review board) reviews what it started from: {{diff}} is the command that shows it.
// Arbiter: a stage with role arbiter and one read-only agent decides between the candidates (gate "arbiter") or,
// without builders, merges the reviewers' findings. Bayloob writes its input to the artifact arbiter-input.md.
// An arbiter stage without agents leaves the pick to the owner.
// Analysis (category "analysis"): an optional `collect` action gathers log sources and, for a security review, the
// project's dependency audit (artifacts logs.md, audit.md); analysts read in parallel; the Arbiter writes the report.
(root => {
  const ROLES = [
    "planner",
    "builder",
    "tester",
    "reviewer",
    "analyst",
    "arbiter",
    "discussion",
    "you",
  ];
  const DISCUSSION_FORMATS = ["round-robin", "debate", "critique", "consensus", "war-room"];
  const MODES = ["writes", "read-only", "plan"];
  const ACTIONS = ["run-tests", "integrate", "merge", "collect"];
  const GATES = ["always", "human", "tests-pass", "arbiter", "no-findings"];
  const ID = /^[a-z][a-z0-9-]{0,23}$/;
  const MAX_STAGES = 12;
  const MAX_LOOPS = 5;
  const PROMPT_MAX = 20_000;

  // What a prompt template can use. {{artifact:<name>}} is the text of an earlier stage's artifact; for a
  // candidate's own artifacts (test output, review) the candidate's copy is used.
  const VARIABLES = {
    task: "The task as you wrote it",
    base: "The commit the task started from",
    branch: "This candidate's branch",
    candidate: "This candidate's id (build-2)",
    note: "Your note from Request changes / Retry",
    subtask: "This builder's subtask and the files it owns (Split work)",
    parts: "How many builders the plan may be split between (Split work)",
    diff: "The git command that shows the change under review (Review board)",
    rubric: "What the Arbiter judges by (its stage's rubric)",
    hosts: "The hosts a runbook may use (Settings → Hosts, and this machine)",
    "artifact:logs.md": "The log sources Bayloob collected (Incident analysis)",
    "artifact:audit.md": "The project's own dependency audit (Security review)",
    "artifact:arbiter-input.md":
      "Everything the Arbiter decides on: goal, plan, each candidate's diff, tests and reviews",
    "artifact:plan.md": "The approved plan",
    "artifact:test-output": "This candidate's test output",
    "artifact:review.md": "This candidate's review",
  };

  // Prompts as lines (a template literal would carry this file's indentation into the prompt)
  const lines = (...l) => l.join("\n");
  const PLAN_PROMPT = lines(
    "Make a step-by-step implementation plan for this task. Read the code you need; do not change any file.",
    "Answer with the plan only, as Markdown: the files to change, what changes in each, and how to test it.",
    "",
    "Task:",
    "{{task}}"
  );

  const BUILD_PROMPT = lines(
    "Implement this approved plan. Run the project's tests when you are done.",
    "",
    "Task:",
    "{{task}}",
    "",
    "Plan:",
    "{{artifact:plan.md}}"
  );

  const FIX_TESTS_PROMPT = lines(
    "The tests fail on your change. Fix it and run the tests again.",
    "",
    "Test output (last lines):",
    "{{artifact:test-output}}"
  );

  const REVIEW_PROMPT = lines(
    "Review the change on branch {{branch}} against {{base}}: run `git diff {{base}}...{{branch}}` and read what you need.",
    "Try to break it: bugs, missed cases, risky edits, missing tests. Do not change any file.",
    'Answer with findings, one per line as `path:line — problem`, most severe first. If there are none, answer "No findings".',
    "",
    "Task:",
    "{{task}}"
  );

  const SPLIT_PLAN_PROMPT = lines(
    "Make an implementation plan for this task and split it into at most {{parts}} independent subtasks that",
    "different builders can do at the same time. Every subtask owns its files: no file or folder may be in two",
    "subtasks. Read the code you need; do not change any file.",
    "Answer with the plan as Markdown, then end with exactly one JSON block, like:",
    "```json",
    '{"subtasks": [{"id": "api", "title": "Coupon endpoint", "files": ["src/api/coupons.js", "test/coupons.test.js"]}]}',
    "```",
    "",
    "Task:",
    "{{task}}"
  );

  const SPLIT_BUILD_PROMPT = lines(
    "You are one of several builders, each doing one part of the same task at the same time.",
    "Do only your subtask and change only the files it owns; the other builders change the rest.",
    "Run the project's tests when you are done (some may fail until the other parts are in).",
    "",
    "Task:",
    "{{task}}",
    "",
    "Your subtask:",
    "{{subtask}}",
    "",
    "The whole plan:",
    "{{artifact:plan.md}}"
  );

  const BOARD_PROMPT = lines(
    "Review this change: run `{{diff}}` and read what you need around it.",
    "Try to break it: bugs, missed cases, risky edits, security, missing tests. Do not change any file.",
    'Answer with findings, one per line as `path:line — problem`, most severe first. If there are none, answer "No findings".',
    "",
    "What the change is for (from the owner):",
    "{{task}}"
  );

  const ARBITER_PROMPT = lines(
    "You are the Arbiter: decide which candidate to keep. Judge by this rubric:",
    "{{rubric}}",
    "Everything you need is below; you may also run read-only git commands (git diff, git show). Do not change any file.",
    "Answer with your reasoning in a few lines, then end with exactly one JSON block:",
    "```json",
    '{"decision": "select", "winner": "build-2", "ranking": [{"candidate": "build-2", "score": 8.5, "reasons": ["..."]}], "retry_instructions": null, "risks": [], "confidence": 0.8}',
    "```",
    "- decision: select (keep the winner) · retry (they should all try again — say how in retry_instructions) ·",
    "merge_ideas (the winner should take the good ideas of the others) · escalate (the owner has to decide).",
    '- Rank every candidate, score 0–10. Start a risk with "high:" when it is serious. confidence: 0 to 1.',
    "",
    "{{artifact:arbiter-input.md}}"
  );

  const BOARD_ARBITER_PROMPT = lines(
    "You are the Arbiter of a review board. Merge the reviewers' findings below into one list: remove duplicates",
    "(the same problem in other words), drop findings that are wrong (check the code with read-only git commands",
    "if you need to), and rank them by severity. Do not change any file.",
    "Answer with a short summary, then end with exactly one JSON block:",
    "```json",
    '{"summary": "One or two sentences.", "findings": [{"severity": "high", "file": "src/a.js", "line": 12, "problem": "...", "reviewers": ["claude", "codex"]}]}',
    "```",
    "severity: high, medium or low.",
    "",
    "{{artifact:arbiter-input.md}}"
  );

  // Analysis: one prompt per preset (editable in the workflow builder), the same answer form for all
  const ANALYSIS_FOCUS = {
    audit: "Audit this codebase: bugs, risky code, dead code, missing tests, unclear structure.",
    security: lines(
      "Do a security review of this codebase: secrets committed to the repo, injection points (SQL, shell, path, templates),",
      "missing authorization checks, unsafe deserialization, weak crypto, and known-vulnerable dependencies",
      "(the project's own audit output is below when it has one)."
    ),
    incident: lines(
      "Find the cause of this incident from the logs below and the code: what failed, when, why, and what would fix it.",
      "Quote the log lines you rely on."
    ),
    perf: "Do a performance review: slow paths, N+1 queries, needless work in loops, blocking I/O, memory growth, missing caching or indexes.",
    files: lines(
      "Answer the owner's question from the attached files (listed at the end, read-only). Read each one that matters;",
      "the project's code is there too if a file refers to it. A PDF or office file may have a text version next to it",
      "(→ name.txt / name.csv): read that, and cite a PDF's page (pages are separated by a form feed). Back every finding",
      "with evidence: the file and line (or page), or the row of a table."
    ),
    deps: "Write a dependency upgrade report: outdated or risky dependencies in the manifests and lock files, what an upgrade would break, and the order to upgrade in.",
  };
  const ANALYSIS_INPUT = { incident: "{{artifact:logs.md}}", security: "{{artifact:audit.md}}" };
  const analystPrompt = preset =>
    lines(
      ANALYSIS_FOCUS[preset] || ANALYSIS_FOCUS.audit,
      "Read what you need (git ls-files, grep, rg, git log). Do not change any file and do not run the project.",
      "Answer with findings, one per line as `severity — path:line (or the log line) — problem — recommendation`,",
      'most severe first; severity is high, medium or low. If there are none, answer "No findings".',
      "",
      "The owner's question:",
      "{{task}}",
      ...(ANALYSIS_INPUT[preset] ? ["", ANALYSIS_INPUT[preset]] : [])
    );

  const ANALYSIS_ARBITER_PROMPT = lines(
    "You are the Arbiter of an analysis. Merge the analysts' findings below into one report: remove duplicates",
    "(the same problem in other words), drop findings that are wrong (check the code with read-only commands if you",
    "need to), and rank them by severity. Do not change any file.",
    "Answer with a short summary, then end with exactly one JSON block:",
    "```json",
    '{"summary": "Two or three sentences.", "findings": [{"severity": "high", "file": "src/a.js", "line": 12, "evidence": "src/a.js:12 or the log line", "problem": "...", "recommendation": "...", "confidence": 0.8, "reviewers": ["claude", "codex"]}]}',
    "```",
    "severity: high, medium or low. confidence: 0 to 1, how sure you are the finding is real.",
    "",
    "{{artifact:arbiter-input.md}}"
  );

  // With "Also prepare an operations plan": the Arbiter also proposes a runbook — Bayloob runs nothing by itself
  const RUNBOOK_PART = lines(
    "",
    "Also propose an operations plan: the commands that would fix or confirm the most important findings, in order.",
    'Add a "runbook" list to the same JSON block. Each step: {"host": one of the hosts below, "argv": ["systemctl", "restart", "php8.3-fpm"],',
    '"purpose": "why, citing a finding", "risk": "low" | "medium" | "high", "rollback": an argv or null, "timeoutSec": seconds}.',
    "argv is a list of words, never a shell string. Prefer read-only checks first. Nothing runs until the owner clicks Run on each step.",
    "Hosts:",
    "{{hosts}}"
  );

  const ANALYSIS_NAMES = {
    audit: "Code audit",
    security: "Security review",
    incident: "Incident / log analysis",
    perf: "Performance review",
    deps: "Dependency upgrade report",
    files: "Analyze files",
    warroom: "Incident war-room",
  };

  // Incident war-room: the analysts talk it through in turn (a discussion), then the Arbiter writes the report
  const WARROOM_ROLES = ["On-call", "Database", "Application", "Infrastructure", "Security"];
  const WARROOM_ARBITER_PROMPT = ANALYSIS_ARBITER_PROMPT.replace(
    "You are the Arbiter of an analysis. Merge the analysts' findings below into one report",
    "You are the Arbiter of an incident war-room. Turn the participants' discussion below (what they agreed on, and what is still open) into one report"
  );

  /** An analysis configuration as a template: collect (when there is something to collect) → analysts → Arbiter. */
  function analysisTemplate(a) {
    const preset = ANALYSIS_NAMES[a.preset] ? a.preset : "audit";
    const analysts = Object.entries(a.agents || {})
      .filter(([, n]) => n > 0)
      .map(([adapter, count]) => ({ adapter, count }));
    const sources = ["incident", "warroom"].includes(preset)
      ? (a.logSources || []).slice(0, 10)
      : [];
    const collect = sources.length || preset === "security";
    return {
      id: `analysis-${preset}`,
      name: ANALYSIS_NAMES[preset],
      description:
        "Analysts read in parallel, nothing is written; the Arbiter merges their findings into one report",
      stages: [
        ...(collect
          ? [
              {
                id: "collect",
                title: preset === "security" ? "Audit" : "Collect logs",
                role: "you",
                action: "collect",
                sources,
                audit: preset === "security",
                gate: "always",
              },
            ]
          : []),
        preset === "warroom"
          ? {
              id: "talk",
              title: "War-room",
              role: "discussion",
              mode: "read-only",
              format: "war-room",
              rounds: 3,
              topic: lines(
                "Incident war-room: find the root cause and the fix together. Share what you see in the logs and the code,",
                "challenge each other, and converge on one explanation.",
                "",
                "{{task}}",
                ...(sources.length
                  ? ["", "The logs Bayloob collected:", "{{artifact:logs.md}}"]
                  : [])
              ),
              participants: (analysts.length
                ? analysts
                : [{ adapter: "claude", count: 1 }]
              ).flatMap((x, i, all) =>
                Array.from({ length: x.count }, (_, k) => ({
                  adapter: x.adapter,
                  count: 1,
                  role: WARROOM_ROLES[
                    (all.slice(0, i).reduce((n, y) => n + y.count, 0) + k) % WARROOM_ROLES.length
                  ],
                }))
              ),
              gate: "human",
            }
          : {
              id: "analyse",
              title: "Analysts",
              role: "analyst",
              mode: "read-only",
              agents: analysts.length ? analysts : [{ adapter: "claude", count: 1 }],
              parallel: true,
              prompt: analystPrompt(preset),
              artifact: "analysis.md",
              gate: "always",
            },
        {
          id: "report",
          title: "Arbiter",
          role: "arbiter",
          mode: "read-only",
          agents: [{ adapter: a.arbiter || "codex", count: 1 }],
          // The runbook part goes before the (long) input, next to the JSON form it extends
          prompt: (base =>
            a.opsPlan
              ? base.replace(
                  "{{artifact:arbiter-input.md}}",
                  `${RUNBOOK_PART.trim()}\n\n{{artifact:arbiter-input.md}}`
                )
              : base)(preset === "warroom" ? WARROOM_ARBITER_PROMPT : ANALYSIS_ARBITER_PROMPT),
          artifact: "report.md",
          gate: "always",
          ...(a.opsPlan ? { runbook: true, hosts: Array.isArray(a.hosts) ? a.hosts : null } : {}),
        },
      ],
    };
  }

  const CODE_RUBRIC =
    "correctness against the task and the plan; tests passing; size and scope of the diff; risk; readability; review findings resolved";

  const arbiterStage = (gate = "arbiter") => ({
    id: "decide",
    title: "Arbiter",
    role: "arbiter",
    mode: "read-only",
    agents: [{ adapter: "codex", count: 1 }],
    prompt: ARBITER_PROMPT,
    rubric: CODE_RUBRIC,
    artifact: "decision.md",
    gate,
  });

  // Lead + team (28): one agent leads — plans and splits, reviews each part, fixes the integrated branch, sums up
  const LEAD_REVIEW_PROMPT = lines(
    "You lead this task: you made the plan and split it between the team. Review this change against your plan —",
    "one member's part, or (after integration) all parts together.",
    "Run `git diff {{base}}...{{branch}}` and read what you need. Do not change any file.",
    "Check that it does its subtask, stays in its own files, and fits the plan and the other parts.",
    "You can't run the tests here (only git commands); Bayloob runs them after integration.",
    'Answer with findings, one per line as `path:line — problem — what to do`, most important first. If it is right, answer "No findings".',
    "",
    "Its subtask (empty after integration):",
    "{{subtask}}",
    "",
    "Your plan:",
    "{{artifact:plan.md}}"
  );
  const LEAD_FIX_PROMPT = lines(
    "Your lead reviewed your part and asks for these changes:",
    "{{artifact:review.md}}",
    "",
    "Make them in your own files only — the other builders change the rest — then run the project's tests.",
    "",
    "Your subtask:",
    "{{subtask}}"
  );
  const LEAD_SUMMARY_PROMPT = lines(
    "You led this task. Write the summary for the owner, as Markdown: what was built (part by part), how it fits",
    "your plan, what the tests say, and what is left or risky. Run `git diff {{base}}...{{branch}}` if you need to.",
    "Do not change any file. You can't run the tests: Bayloob ran them on this branch, their output is below.",
    "",
    "Your plan:",
    "{{artifact:plan.md}}",
    "",
    "The project's tests on this branch (run by Bayloob):",
    "{{artifact:test-output}}"
  );

  // Design debate: who's who in the discussion, in the order the agents were picked
  const DEBATE_ROLES = [
    "Architect",
    "Skeptic",
    "Pragmatist",
    "Security reviewer",
    "Performance reviewer",
  ];
  const DEBATE_TOPIC = lines(
    "Discuss how to design this before anyone builds it: the approach, the trade-offs, what could go wrong.",
    "",
    "{{task}}"
  );

  const BUILTINS = {
    pipeline: {
      id: "pipeline",
      name: "Pipeline",
      description: "Plan → build → tests → review → you pick → you merge",
      builtin: true,
      stages: [
        {
          id: "plan",
          title: "Plan",
          role: "planner",
          mode: "plan",
          agents: [{ adapter: "claude", count: 1 }],
          prompt: PLAN_PROMPT,
          artifact: "plan.md",
          gate: "human",
        },
        {
          id: "build",
          title: "Build",
          role: "builder",
          mode: "writes",
          agents: [{ adapter: "claude", count: 1 }],
          parallel: true,
          prompt: BUILD_PROMPT,
          gate: "always",
        },
        {
          id: "tests",
          title: "Tests",
          role: "tester",
          action: "run-tests",
          perCandidate: true,
          gate: "tests-pass",
          onFail: { goto: "build", prompt: FIX_TESTS_PROMPT, maxLoops: 2 },
        },
        {
          id: "review",
          title: "Review",
          role: "reviewer",
          mode: "read-only",
          agents: [{ adapter: "codex", count: 1 }],
          perCandidate: true,
          prompt: REVIEW_PROMPT,
          artifact: "review.md",
          gate: "always",
        },
        arbiterStage(),
        { id: "merge", title: "Merge", role: "you", action: "merge", gate: "human" },
      ],
    },
    bestofn: {
      id: "bestofn",
      name: "Best-of-N",
      description: "Plan → N builders in parallel → tests on each → you pick the best → you merge",
      builtin: true,
      stages: [
        {
          id: "plan",
          title: "Plan",
          role: "planner",
          mode: "plan",
          agents: [{ adapter: "claude", count: 1 }],
          prompt: PLAN_PROMPT,
          artifact: "plan.md",
          gate: "human",
        },
        {
          id: "build",
          title: "Build",
          role: "builder",
          mode: "writes",
          agents: [
            { adapter: "claude", count: 2 },
            { adapter: "codex", count: 1 },
          ],
          parallel: true,
          prompt: BUILD_PROMPT,
          gate: "always",
        },
        {
          id: "tests",
          title: "Tests",
          role: "tester",
          action: "run-tests",
          perCandidate: true,
          gate: "tests-pass",
          onFail: { goto: "build", prompt: FIX_TESTS_PROMPT, maxLoops: 1 },
        },
        arbiterStage(),
        { id: "merge", title: "Merge", role: "you", action: "merge", gate: "human" },
      ],
    },
    split: {
      id: "split",
      name: "Split work",
      description:
        "Plan + split → one builder per subtask → integrate → tests → review → you merge",
      builtin: true,
      stages: [
        {
          id: "plan",
          title: "Plan + split",
          role: "planner",
          mode: "plan",
          split: true,
          agents: [{ adapter: "claude", count: 1 }],
          prompt: SPLIT_PLAN_PROMPT,
          artifact: "plan.md",
          gate: "human",
        },
        {
          id: "build",
          title: "Build",
          role: "builder",
          mode: "writes",
          split: true,
          agents: [
            { adapter: "claude", count: 2 },
            { adapter: "codex", count: 1 },
          ],
          parallel: true,
          prompt: SPLIT_BUILD_PROMPT,
          gate: "always",
        },
        { id: "integrate", title: "Integrate", role: "you", action: "integrate", gate: "always" },
        {
          id: "tests",
          title: "Tests",
          role: "tester",
          action: "run-tests",
          perCandidate: true,
          gate: "tests-pass",
          onFail: { goto: "build", prompt: FIX_TESTS_PROMPT, maxLoops: 2 },
        },
        {
          id: "review",
          title: "Review",
          role: "reviewer",
          mode: "read-only",
          agents: [{ adapter: "codex", count: 1 }],
          perCandidate: true,
          prompt: REVIEW_PROMPT,
          artifact: "review.md",
          gate: "always",
        },
        arbiterStage(),
        { id: "merge", title: "Merge", role: "you", action: "merge", gate: "human" },
      ],
    },
    lead: {
      id: "lead",
      name: "Lead + team",
      description:
        "One agent leads: it plans and splits, the team builds the parts, the lead reviews each one (changes go back to its builder), fixes the integrated branch and sums up → you merge",
      builtin: true,
      stages: [
        {
          id: "plan",
          title: "Lead plans + splits",
          role: "planner",
          mode: "plan",
          split: true,
          lead: true,
          agents: [{ adapter: "claude", count: 1 }],
          prompt: SPLIT_PLAN_PROMPT,
          artifact: "plan.md",
          gate: "human",
        },
        {
          id: "build",
          title: "Team builds",
          role: "builder",
          mode: "writes",
          split: true,
          agents: [
            { adapter: "claude", count: 1 },
            { adapter: "codex", count: 1 },
          ],
          parallel: true,
          prompt: SPLIT_BUILD_PROMPT,
          gate: "always",
        },
        {
          id: "review",
          title: "Lead reviews",
          role: "reviewer",
          mode: "read-only",
          lead: true,
          agents: [{ adapter: "claude", count: 1 }],
          perCandidate: true,
          prompt: LEAD_REVIEW_PROMPT,
          artifact: "review.md",
          gate: "no-findings",
          onFail: { goto: "build", prompt: LEAD_FIX_PROMPT, maxLoops: 2 },
        },
        // the integrated branch is the lead's: test failures there are fixed by the lead's agent
        {
          id: "integrate",
          title: "Integrate",
          role: "you",
          action: "integrate",
          by: "lead",
          gate: "always",
        },
        {
          id: "tests",
          title: "Tests",
          role: "tester",
          action: "run-tests",
          perCandidate: true,
          gate: "tests-pass",
          onFail: { goto: "build", prompt: FIX_TESTS_PROMPT, maxLoops: 2 },
        },
        {
          id: "summary",
          title: "Lead sums up",
          role: "reviewer",
          mode: "read-only",
          lead: true,
          agents: [{ adapter: "claude", count: 1 }],
          perCandidate: true,
          prompt: LEAD_SUMMARY_PROMPT,
          artifact: "summary.md",
          gate: "always",
        },
        { id: "merge", title: "Merge", role: "you", action: "merge", gate: "human" },
      ],
    },
    debate: {
      id: "debate",
      name: "Design debate",
      description:
        "Agents discuss the design in turn → the Arbiter writes the decision → plan → build → tests → review → you merge",
      builtin: true,
      stages: [
        {
          id: "talk",
          title: "Discuss",
          role: "discussion",
          mode: "read-only",
          format: "consensus",
          rounds: 3,
          topic: DEBATE_TOPIC,
          participants: [
            { adapter: "claude", count: 1, role: "Architect" },
            { adapter: "codex", count: 1, role: "Skeptic" },
          ],
          decider: { adapter: "codex" },
          // not decision.md: the Arbiter stage after the build writes that one
          artifact: "design.md",
          gate: "human",
        },
        {
          id: "plan",
          title: "Plan",
          role: "planner",
          mode: "plan",
          agents: [{ adapter: "claude", count: 1 }],
          prompt: lines(
            PLAN_PROMPT,
            "",
            "The design the discussion settled on (follow it):",
            "{{artifact:design.md}}"
          ),
          artifact: "plan.md",
          gate: "human",
        },
        {
          id: "build",
          title: "Build",
          role: "builder",
          mode: "writes",
          agents: [{ adapter: "claude", count: 1 }],
          prompt: BUILD_PROMPT,
          gate: "always",
        },
        {
          id: "tests",
          title: "Tests",
          role: "tester",
          action: "run-tests",
          perCandidate: true,
          gate: "tests-pass",
          onFail: { goto: "build", prompt: FIX_TESTS_PROMPT, maxLoops: 2 },
        },
        {
          id: "review",
          title: "Review",
          role: "reviewer",
          mode: "read-only",
          agents: [{ adapter: "codex", count: 1 }],
          perCandidate: true,
          prompt: REVIEW_PROMPT,
          artifact: "review.md",
          gate: "always",
        },
        arbiterStage(),
        { id: "merge", title: "Merge", role: "you", action: "merge", gate: "human" },
      ],
    },
    board: {
      id: "board",
      name: "Review board",
      description: "Reviewers × N, read-only, on your branch or your uncommitted changes",
      builtin: true,
      stages: [
        {
          id: "review",
          title: "Reviewers",
          role: "reviewer",
          mode: "read-only",
          agents: [
            { adapter: "claude", count: 1 },
            { adapter: "codex", count: 1 },
          ],
          parallel: true,
          prompt: BOARD_PROMPT,
          artifact: "review.md",
          gate: "always",
        },
        {
          id: "consolidate",
          title: "Arbiter",
          role: "arbiter",
          mode: "read-only",
          agents: [{ adapter: "codex", count: 1 }],
          prompt: BOARD_ARBITER_PROMPT,
          artifact: "report.md",
          gate: "always",
        },
      ],
    },
  };

  const clone = o => JSON.parse(JSON.stringify(o));

  /**
   * Plain-language problems with a template, each with the stage it belongs to ([] = fine) — the builder shows
   * them under that stage. `capacity`: { adapter: max } of the agents that can run here; counts above an
   * agent's max are allowed (they queue) but not above it × 4.
   */
  function templateIssues(t, { capacity = { claude: 4, codex: 2, gemini: 2 } } = {}) {
    const issues = []; // { stage: index | null, text }
    if (!t || typeof t !== "object") {
      return [{ stage: null, text: "The template is empty" }];
    }
    if (!ID.test(String(t.id))) {
      issues.push({
        stage: null,
        text: "The template id must be lowercase letters, digits and dashes (max 24)",
      });
    }
    if (!String(t.name || "").trim()) {
      issues.push({ stage: null, text: "The template needs a name" });
    }
    const stages = Array.isArray(t.stages) ? t.stages : [];
    if (!stages.length) {
      issues.push({ stage: null, text: "Add at least one stage" });
    }
    if (stages.length > MAX_STAGES) {
      issues.push({ stage: null, text: `At most ${MAX_STAGES} stages` });
    }
    const ids = stages.map(s => s?.id);
    let builders = false;
    let splitPlan = false;
    let splitBuild = false;
    stages.forEach((s, i) => {
      const add = text => issues.push({ stage: i, text });
      const name = `Stage ${i + 1}${s?.title ? ` "${s.title}"` : ""}`;
      if (!s || typeof s !== "object") {
        add(`${name} is empty`);
        return;
      }
      if (!ID.test(String(s.id))) {
        add(`${name}: the id must be lowercase letters, digits and dashes`);
      } else if (ids.indexOf(s.id) !== i) {
        add(`${name}: another stage already uses the id "${s.id}"`);
      }
      if (!ROLES.includes(s.role)) {
        add(`${name}: pick a role (${ROLES.join(", ")})`);
      }
      if (!GATES.includes(s.gate)) {
        add(`${name}: pick a gate (${GATES.join(", ")})`);
      }
      const deciding = s.role === "arbiter" && Array.isArray(s.agents) && s.agents.length > 0;
      const agentStage =
        !s.action &&
        s.role !== "you" &&
        s.role !== "discussion" &&
        (s.role !== "arbiter" || deciding);
      if (s.role === "discussion") {
        const ps = Array.isArray(s.participants) ? s.participants : [];
        const total = ps.reduce((a, x) => a + (Number(x?.count) || 0), 0);
        if (!ps.length) {
          add(`${name}: add the participants`);
        }
        for (const p of ps) {
          const max = capacity[p?.adapter];
          const n = Number(p?.count);
          if (!max) {
            add(`${name}: "${p?.adapter}" is not an agent that can run here`);
          } else if (!Number.isInteger(n) || n < 1 || n > max * 4) {
            add(`${name}: the count for ${p.adapter} must be 1–${max * 4}`);
          }
        }
        if (total > 8) {
          add(`${name}: at most 8 participants`);
        }
        if (!DISCUSSION_FORMATS.includes(s.format)) {
          add(`${name}: pick a format (${DISCUSSION_FORMATS.join(", ")})`);
        }
        if (["debate", "critique"].includes(s.format) && total < 2) {
          add(
            `${name}: a ${s.format === "debate" ? "debate" : "critique"} needs at least two participants`
          );
        }
        const rounds = Number(s.rounds);
        if (!Number.isInteger(rounds) || rounds < 1 || rounds > 10) {
          add(`${name}: rounds must be 1–10`);
        }
        if (s.mode !== "read-only") {
          add(`${name}: participants only read — the mode must be "read-only"`);
        }
        if (s.decider?.adapter && !capacity[s.decider.adapter]) {
          add(`${name}: the decider "${s.decider.adapter}" is not an agent that can run here`);
        }
        for (const v of unknownVariables(s.topic || "")) {
          add(`${name}: the topic uses {{${v}}}, which doesn't exist`);
        }
      }
      if (deciding) {
        const n = s.agents.reduce((a, x) => a + Number(x?.count || 0), 0);
        if (n !== 1) {
          add(`${name}: the Arbiter is exactly one agent`);
        }
        if (s.mode !== "read-only") {
          add(`${name}: the Arbiter only reads — its mode must be "read-only"`);
        }
        if (builders && s.gate !== "arbiter") {
          add(`${name}: an Arbiter after builders decides — its gate must be "Arbiter"`);
        }
      }
      if (s.action && !ACTIONS.includes(s.action)) {
        add(`${name}: unknown action "${s.action}"`);
      }
      if (s.action === "run-tests" && !builders) {
        add(`${name}: tests need a build stage before them`);
      }
      if (s.action === "integrate" && !splitBuild) {
        add(
          `${name}: integrate merges the parts of a split build — add a build stage split into subtasks before it`
        );
      }
      if (s.split && s.role === "builder" && !splitPlan) {
        add(`${name}: a build split into subtasks needs a planner that splits the plan before it`);
      }
      if (s.split && s.role !== "builder" && s.role !== "planner") {
        add(`${name}: only a planner (that splits) or a builder (one per subtask) can be split`);
      }
      if (s.action === "merge" && !builders) {
        add(`${name}: there is nothing to merge without a build stage before it`);
      }
      if (s.gate === "arbiter" && s.role !== "arbiter") {
        add(`${name}: the "Arbiter" gate belongs to an Arbiter stage`);
      }
      if (s.gate === "arbiter" && !builders) {
        add(`${name}: the Arbiter picks between candidates — add a build stage before it`);
      }
      if (s.gate === "tests-pass" && s.action !== "run-tests") {
        add(`${name}: the "tests pass" gate only fits a run-tests stage`);
      }
      if (agentStage) {
        if (!MODES.includes(s.mode)) {
          add(`${name}: pick a mode (${MODES.join(", ")})`);
        }
        if (s.role === "builder" && s.mode !== "writes") {
          add(`${name}: builders write — their mode must be "writes"`);
        }
        if (s.role !== "builder" && s.mode === "writes") {
          add(`${name}: only builders may write; use "read-only" or "plan"`);
        }
        const agents = Array.isArray(s.agents) ? s.agents : [];
        if (!agents.length) {
          add(`${name}: add at least one agent`);
        }
        for (const a of agents) {
          const max = capacity[a?.adapter];
          const n = Number(a?.count);
          if (!max) {
            add(`${name}: "${a?.adapter}" is not an agent that can run here`);
          } else if (!Number.isInteger(n) || n < 1 || n > max * 4) {
            add(`${name}: the count for ${a.adapter} must be 1–${max * 4}`);
          }
        }
        if (s.perCandidate && !builders) {
          add(`${name}: "once per candidate" needs a build stage before it`);
        }
        if (!String(s.prompt || "").trim()) {
          add(`${name}: write the prompt`);
        } else if (String(s.prompt).length > PROMPT_MAX) {
          add(`${name}: the prompt is longer than ${PROMPT_MAX} characters`);
        } else {
          for (const v of unknownVariables(s.prompt)) {
            add(`${name}: the prompt uses {{${v}}}, which doesn't exist`);
          }
        }
      }
      if (s.onFail) {
        const target = ids.indexOf(s.onFail.goto);
        if (target === -1 || target >= i) {
          add(`${name}: "on fail" must go back to an earlier stage`);
        }
        const loops = Number(s.onFail.maxLoops);
        if (!Number.isInteger(loops) || loops < 1 || loops > MAX_LOOPS) {
          add(`${name}: max loops must be 1–${MAX_LOOPS}`);
        }
        for (const v of unknownVariables(s.onFail.prompt || "")) {
          add(`${name}: the "on fail" prompt uses {{${v}}}, which doesn't exist`);
        }
      }
      if (s.role === "builder") {
        builders = true;
        splitBuild = splitBuild || !!s.split;
      }
      if (s.role === "planner" && s.split) {
        splitPlan = true;
      }
    });
    return issues;
  }

  /** The same problems as plain strings (the engine refuses a template with any). */
  function validateTemplate(t, opts) {
    return templateIssues(t, opts).map(i => i.text);
  }

  function unknownVariables(text) {
    const out = [];
    for (const [, v] of String(text).matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)) {
      const ok = v in VARIABLES || /^artifact:[\w.-]+$/.test(v);
      if (!ok && !out.includes(v)) {
        out.push(v);
      }
    }
    return out;
  }

  /**
   * Fills a prompt template. `artifact(name)` returns an artifact's text or null. Unknown values become a
   * short marker instead of disappearing, so a missing input is visible in the prompt the agent gets.
   */
  function renderPrompt(text, vars, artifact = () => null) {
    return String(text || "").replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, v) => {
      if (v.startsWith("artifact:")) {
        const body = artifact(v.slice("artifact:".length));
        return body == null ? `(no ${v.slice(9)} yet)` : body;
      }
      return vars[v] == null || vars[v] === "" ? `(no ${v})` : String(vars[v]);
    });
  }

  /**
   * The template a New task configuration runs (Workflow category): one of the owner's templates when the
   * dialog picked one (`own(id)` looks it up), else the preset for its pattern with the agents picked in the
   * dialog put into the planner, builder and reviewer slots.
   */
  function templateFor(config, own = () => null) {
    if (config?.category === "analysis") {
      return analysisTemplate(config.analysis || {});
    }
    const w = config?.workflow || {};
    // One of the owner's templates runs as saved: its stages say which agents run where
    if (w.template) {
      const t = own(w.template);
      if (!t) {
        throw new Error(`The template "${w.template}" doesn't exist any more — pick another one`);
      }
      return clone(t);
    }
    const preset = BUILTINS[w.pattern];
    if (!preset) {
      throw new Error(
        `${w.pattern ? `"${w.pattern}"` : "This pattern"} can't run yet — Pipeline, Best-of-N, Split work, Review board, Design debate and Lead + team can`
      );
    }
    const t = clone(preset);
    const builders = Object.entries(w.agents || {})
      .filter(([, n]) => n > 0)
      .map(([adapter, count]) => ({ adapter, count }));
    for (const s of t.stages) {
      if (s.role === "planner" && w.planner) {
        s.agents = [{ adapter: w.planner, count: 1 }];
      }
      if (s.role === "builder" && builders.length) {
        s.agents = builders;
      }
      if (s.role === "arbiter" && s.agents?.length && w.arbiter) {
        s.agents = [{ adapter: w.arbiter, count: 1 }];
      }
      // A Design debate: the agents picked discuss (roles in turn); the planner also builds; the Arbiter decides
      if (w.pattern === "debate") {
        if (s.role === "discussion" && builders.length) {
          let k = 0;
          s.participants = builders.flatMap(b =>
            Array.from({ length: b.count }, () => ({
              adapter: b.adapter,
              count: 1,
              role: DEBATE_ROLES[k++ % DEBATE_ROLES.length],
            }))
          );
          if (w.arbiter) {
            s.decider = { adapter: w.arbiter };
          }
        }
        if (s.role === "builder") {
          s.agents = [{ adapter: w.planner || "claude", count: 1 }];
        }
      }
      // Lead + team: the lead (the planner picked) also reviews and sums up; there is no separate reviewer
      if (s.lead) {
        s.agents = [{ adapter: w.planner || "claude", count: 1 }];
        continue;
      }
      // A Review board's reviewers are the agents picked in the dialog
      if (s.role === "reviewer" && w.pattern === "board" && builders.length) {
        s.agents = builders;
      } else if (s.role === "reviewer" && w.reviewer) {
        s.agents = [{ adapter: w.reviewer, count: 1 }];
      }
    }
    return t;
  }

  const builtin = id => (BUILTINS[id] ? clone(BUILTINS[id]) : null);

  const api = {
    DISCUSSION_FORMATS,
    CODE_RUBRIC,
    analysisTemplate,
    ROLES,
    MODES,
    ACTIONS,
    GATES,
    VARIABLES,
    BUILTINS,
    builtin,
    validateTemplate,
    templateIssues,
    unknownVariables,
    renderPrompt,
    templateFor,
  };
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.WorkflowTemplates = api;
  }
})(typeof globalThis === "undefined" ? this : globalThis);

# TaskForge Plan

## Goal

Build TaskForge, a lightweight, fast terminal orchestrator that coordinates work between configured coding agents, starting with Claude Code and Codex.

The default CLI command should be `tfg`.

The first supported workflow is:

1. Run planning in Claude Code.
2. Run planning in Codex.
3. Compare both plans for core parity.
4. Use Claude as the parity checker when the local comparison finds meaningful differences.
5. Ask the user to merge or choose a plan when the plans differ in core essence.
6. Execute the selected plan in Codex.
7. Review the resulting changes in Codex.

## Current Workspace State

The workspace is currently empty and is not a git repository. This should be treated as a greenfield CLI/TUI project.

`tfg` must verify that the target cwd is a git repository before running any workflow, because `codex review` requires one. A clear startup check should detect whether a git repo is present and prompt the user to run `git init` if not.

Available local tools observed by the planning worker:

- Node.js is installed.
- npm is installed.
- Python is installed.
- `claude` is available.
- `codex` is available.
- `codex exec` and `codex review` are available.
- Claude supports non-interactive JSON output via `--output-format json`.

## Recommended Stack

Use Node.js with TypeScript.

Dependencies should stay minimal:

- `ink` for the TUI (React-based, actively maintained, works reliably on Windows terminals).
- `zod` for config validation and runtime JSON schema enforcement.
- Node `child_process.spawn` for running agent CLIs.
- JSON config for the first version.

Rationale:

- `neo-blessed` has not had meaningful maintenance since ~2019 and has known rough edges in Windows terminals. `ink` provides a React model for CLI rendering and is actively maintained.
- The app is mainly subprocess orchestration plus terminal UI.
- Node is already available in the environment.
- TypeScript gives useful structure without slowing down the first build.
- JSON avoids introducing a config parser dependency beyond `zod`.

## CLI Naming

Use **TaskForge** as the project name and `tfg` as the installed CLI command.

Initial package binary shape:

```json
{
  "name": "taskforge",
  "bin": {
    "tfg": "./dist/index.js"
  }
}
```

Do not register `forge` as a default binary because that command is already used by other developer tools.

## Config Shape

Start with a single `taskforge.config.json` in the project root.

Example shape:

```json
{
  "defaults": {
    "effort": "medium",
    "roleEffort": {
      "plan": "high",
      "execute": "medium",
      "review": "high"
    }
  },
  "agents": {
    "claude": {
      "command": "claude",
      "roles": ["plan", "parity"],
      "effort": {
        "plan": "high",
        "parity": "medium"
      }
    },
    "codex": {
      "command": "codex",
      "roles": ["plan", "execute", "review"],
      "effort": {
        "plan": "high",
        "execute": "medium",
        "review": "high"
      }
    }
  },
  "workflow": {
    "planAgents": ["claude", "codex"],
    "parityAgent": "claude",
    "executeAgent": "codex",
    "reviewAgent": "codex"
  },
  "shell": {
    "preferred": "git-bash",
    "gitBashPath": "C:\\Program Files\\Git\\bin\\bash.exe",
    "fallback": "powershell"
  },
  "target": {
    "cwd": "."
  }
}
```

The first version should avoid a plugin system. Agent behavior should be declared by role and implemented by small built-in adapters.

Command execution should prefer Git Bash where possible. On Windows, the process runner should resolve Git Bash from `shell.gitBashPath` first, then from `PATH`, and only fall back to PowerShell when Git Bash is unavailable or a command requires PowerShell-specific behavior.

Agent CLI calls should still be built as argument arrays instead of shell-concatenated strings. When Git Bash is used as the shell wrapper, pass commands through `bash -lc` only at the final process boundary so quoting stays centralized in the process runner.

Effort levels are part of the config schema and must not be hardcoded in the workflow or adapter layer.

The config should support:

- a global default effort at `defaults.effort`
- default effort by role at `defaults.roleEffort.<role>`
- per-agent, per-role overrides at `agents.<agent>.effort.<role>`

The workflow layer resolves the effective effort before invoking an adapter. The adapter layer only translates the resolved value into the correct CLI-specific flags or prompt instructions.

Normalized effort values:

```ts
type EffortLevel = "low" | "medium" | "high";
```

`xhigh` is removed. Both the Claude and Codex CLIs use `low / medium / high` as their documented reasoning-effort scales. Mapping to a fourth level introduces an undocumented assumption. Use `high` for review.

Default role effort policy:

- planning: `high`
- execute: `medium`
- review: `high`
- all other roles: `medium`

Resolution order:

1. Use `agents.<agent>.effort.<role>` when present.
2. Fall back to `defaults.roleEffort.<role>` when present.
3. Fall back to `defaults.effort`.
4. If none is present, fail config validation with a clear error.

Adapter effort mapping:

| EffortLevel | Claude                        | Codex `--reasoning-effort` |
|-------------|-------------------------------|---------------------------|
| `low`       | injected via system prompt    | `low`                     |
| `medium`    | injected via system prompt    | `medium`                  |
| `high`      | injected via system prompt    | `high`                    |

The Claude CLI does not expose a stable reasoning-effort flag; inject effort preference into the system prompt. Codex uses `--reasoning-effort <level>`.

**CLI flag validation note:** The Codex command shapes below are based on documentation and must be validated live in Phase 0. All command templates live in `src/agents/codex.ts` so flags can be corrected without touching workflow logic.

## Planned File Layout

```text
package.json
tsconfig.json
.gitignore
README.md
orchestrator.config.json
CLI-FLAGS.md
src/index.ts
src/app.ts
src/config/loadConfig.ts
src/config/schema.ts
src/agents/types.ts
src/agents/claude.ts
src/agents/codex.ts
src/agents/runProcess.ts
src/workflows/planMode.ts
src/workflows/executeMode.ts
src/workflows/reviewMode.ts
src/compare/normalizePlan.ts
src/compare/comparePlans.ts
src/tui/App.tsx
src/tui/StatusBar.tsx
src/tui/AgentPane.tsx
src/tui/PlanPane.tsx
src/tui/InputRow.tsx
src/tui/Footer.tsx
```

## Core Data Model

Both planning agents should return a shared structured plan schema. Because the Claude CLI does not support a `--json-schema` flag, the adapter must:

1. Embed the target JSON schema in the prompt itself.
2. Extract the first valid JSON object from stdout.
3. Validate it with Zod and surface a clear error if parsing fails.

Initial schema:

```ts
type AgentPlan = {
  goal: string;
  summary: string;
  steps: Array<{
    id: string;
    title: string;
    detail: string;
    files?: string[];
    risks?: string[];
  }>;
  risks: string[];
  openQuestions: string[];
};
```

Normalize each plan into a compact essence before comparison:

```ts
type PlanEssence = {
  goal: string;
  stepTitles: string[];
  riskThemes: string[];
  openQuestionThemes: string[];
};
```

## Plan Comparison Rules

The local comparison is considered to find "meaningful differences" when any of the following is true:

1. Goal strings have a word-overlap ratio below 0.6 (after lowercasing and stripping punctuation).
2. The number of steps differs by more than 2.
3. More than 30% of step titles from one plan have no close match in the other (Levenshtein distance > 5 after normalization).
4. A top-level risk in one plan has no close analog in the other.

If none of these conditions are triggered, the plans are considered aligned and the Codex plan is selected by default without calling Claude.

These thresholds are named constants in `src/compare/comparePlans.ts` and can be tuned.

## Plan Mode Workflow

1. Load and validate `orchestrator.config.json`. Fail fast with a readable error if validation fails.
2. Check that the target cwd is a git repository. If not, show a clear message and exit.
3. Accept the user request from the TUI input.
4. Build a shared planning prompt that embeds the `AgentPlan` JSON schema and asks for structured output.
5. Start Claude planning and Codex planning in parallel.
6. Stream both agent outputs into the TUI.
7. Parse and Zod-validate each final structured plan.
8. If either agent fails, times out, or produces unparseable output:
   - Show the failure in the TUI with the raw output.
   - If only one agent succeeded, ask the user whether to proceed with the single plan or cancel.
   - If both failed, stop and surface errors.
9. Normalize both plans into `PlanEssence`.
10. Run the local comparison.
11. If aligned, select the Codex plan by default.
12. If meaningfully different, call Claude as the parity checker with both plans.
13. If Claude reports `same` or `compatible`, show the comparison and proceed with the Codex plan unless the user chooses otherwise.
14. If Claude reports `materially_different`, pause in the TUI and ask the user to:
    - use Claude plan (`1`)
    - use Codex plan (`2`)
    - open manual merge in `$EDITOR` (`e`)
    - cancel (`Ctrl+C`)

## Claude Adapter

Claude should be used for:

- planning
- parity checking

Effort should be read from `agents.claude.effort.plan` and `agents.claude.effort.parity`, and injected as a system prompt instruction.

Planning command shape:

```
claude -p --output-format json "<prompt with embedded AgentPlan schema>"
```

The adapter extracts the first `{...}` block from stdout and validates it with Zod. Malformed output is surfaced as a parse error, not silently ignored.

Parity command shape:

```
claude -p --output-format json "<prompt containing both plans and PlanParity schema>"
```

Parity response schema (Zod-validated):

```ts
type PlanParity = {
  classification: "same" | "compatible" | "materially_different";
  reason: string;
  coreDifferences: string[];
  recommendedAction: "proceed" | "ask_user_to_choose" | "ask_user_to_merge";
};
```

If the parity call fails or returns unparseable output, treat it as `materially_different` and ask the user to choose.

## Codex Adapter

Codex should be used for:

- planning
- execution
- review

Effort should be read from `agents.codex.effort.<role>` and passed as `--reasoning-effort <level>`.

Planning command shape (validate flags in Phase 0):

```
codex exec --skip-git-repo-check --reasoning-effort <level> "<prompt with embedded AgentPlan schema>"
```

If `--output-schema` and `-o` flags are confirmed after live validation, add them. Otherwise the adapter parses JSON from stdout using the same extract-and-validate approach as the Claude adapter.

Execution command shape:

```
codex exec --reasoning-effort <level> "<selected plan and original user request>"
```

Review command shape:

```
codex review --uncommitted
```

`codex review --uncommitted` requires a git repository. The startup check in the plan mode workflow enforces this precondition.

## TUI Design

Use `ink` with React functional components.

Primary regions:

- `StatusBar`: current phase, active agents, target cwd
- `AgentPane` (left): live agent logs and status updates
- `PlanPane` (right): selected plan, plan diff, parity result, or review findings
- `InputRow` (bottom): user prompt or confirmation
- `Footer`: compact key hints

Initial keybindings:

- `Ctrl+C`: quit or cancel current process
- `Tab`: switch focused pane
- `Enter`: submit prompt or confirm selected action
- `1`: choose Claude plan when prompted
- `2`: choose Codex plan when prompted
- `e`: open manual merge in `$EDITOR` when prompted
- `r`: run review after execution

Manual merge opens `$EDITOR` (or `notepad` as a Windows fallback if `$EDITOR` is unset) with a temp file containing both plans. When the editor exits, `tfg` reads the temp file as the merged plan.

## Execution Workflow

1. Receive selected or merged plan.
2. Build an execution prompt that includes the original user request, selected plan, workspace cwd, and an instruction to prefer Git Bash for repo operations.
3. Run Codex execution.
4. Stream Codex output to the TUI.
5. Capture exit code and final summary.
6. If execution fails, show failure details and stop before review.

## Review Workflow

1. Run Codex review after successful execution.
2. Stream review output to the TUI.
3. Present findings in the right pane.
4. Do not auto-apply review fixes in the first version.

## Decisions on Open Questions

1. **Target cwd**: `tfg` always targets the current working directory. No repo picker in v1.
2. **Config format**: Stay with JSON. TOML alignment with Codex conventions is a v2 consideration.
3. **Codex approval/sandbox defaults**: Not controlled by `taskforge.config.json` in v1. Users configure Codex approval behavior in their own Codex config.
4. **Manual merge**: Open `$EDITOR`. In-TUI multiline editing adds scope without clear value in v1.
5. **Review findings**: Informational only in v1. A follow-up "fix review findings" phase is a v2 feature.

## Implementation Phases

### Phase 0: CLI Flag Validation (prerequisite)

Before writing any adapter code, validate the following live and record results in `CLI-FLAGS.md`:

- Confirm exact `codex exec` flags: `--skip-git-repo-check`, `--reasoning-effort`, `--output-schema`, `-o`.
- Confirm `codex review --uncommitted` works in a git repo on this machine.
- Confirm `claude -p --output-format json` produces parseable JSON output.

### Phase 1: Project Skeleton

- Add Node/TypeScript project files with `ink` as the TUI dependency.
- Add config schema (Zod) and loader with startup git-repo check.
- Add process runner with streaming stdout, stderr, exit code, and cancellation.
- Add placeholder TUI that can accept a prompt and display streaming logs.

### Phase 2: Input Shortcuts

Implement the separate Phase 2 plan in `phase-2-input-shortcuts.md`.

### Phase 3: Agent Adapters

- Add Claude planning adapter (prompt-embedded schema, JSON extract + Zod validate).
- Add Claude parity adapter (same pattern, `PlanParity` schema).
- Add Codex planning adapter (using validated flags from Phase 0).
- Add Codex execution adapter.
- Add Codex review adapter.
- Keep all agent command construction in adapter files.

### Phase 4: Plan Comparison

- Add shared plan schema and Zod validators.
- Add plan normalization (`PlanEssence`).
- Add local comparison with defined thresholds.
- Add Claude parity fallback.
- Add TUI decision flow for materially different plans.
- Handle single-agent failure path.

### Phase 5: End-to-End Workflow

- Wire plan mode from prompt to selected plan.
- Wire Codex execution.
- Wire Codex review.
- Add cancellation handling.
- Add readable error states for missing CLIs, invalid config, parse failures, and failed subprocesses.
- Add `$EDITOR` merge handoff.

### Phase 6: Polish

- Improve TUI pane focus and resizing.
- Add persisted run logs under a configurable folder.
- Add README usage examples.
- Add existing test execution only if tests exist by then.

## Validation Plan

Do not create tests by default.

Validate with:

```bash
npm run build
npm run dev
```

Manual validation scenarios:

1. Start TUI.
2. Submit a small planning-only request.
3. Confirm Claude and Codex planning both run.
4. Confirm aligned plans proceed without a merge prompt.
5. Force different mock plans and confirm the TUI asks the user to choose or merge.
6. Confirm Codex execution starts only after a selected plan exists.
7. Confirm Codex review starts only after successful execution.
8. Confirm that running `tfg` in a non-git directory shows a clear error.
9. Confirm that killing one planning agent mid-run shows a recoverable error, not a crash.

If automated tests are later needed, request permission before creating or updating them.

## Risks

- Claude and Codex JSON output behavior may differ in practice; adapter parsing must be defensive and surface raw output on failure.
- `codex review` requires a git repository; enforce this at startup.
- Windows quoting can break command templates; use `spawn(command, args)` with argument arrays and centralize any Git Bash wrapping in the process runner.
- Full-screen TUI process cancellation needs careful cleanup to avoid leaving child processes running.
- `ink` React-based rendering may conflict with raw stdout from child processes; stream child output through ink state, not raw writes.
- CLI flags for Codex may differ from documentation; Phase 0 validation is a hard prerequisite for Phase 2.

# TaskForge Spec

## Goal

Build TaskForge, a lightweight and fast terminal UI for spec-driven multi-agent development.

TaskForge should coordinate configured coding agents, starting with Claude Code and Codex, while keeping the spec as the source of truth for planning, execution, and review.

The default CLI command should be `tfg`.

## Current Context

This spec captures the project direction as of 2026-05-14.

The current workspace is `C:\Users\Kira9\workspace\_ai\orchestrator`.

Existing plan artifacts:

- `phase-1.md`: main TaskForge implementation plan.
- `phase-2-input-shortcuts.md`: separate plan for `@` file references and `!` Git Bash command shortcuts.

Current project decisions:

- Tool name: TaskForge.
- CLI command: `tfg`.
- Preferred shell: Git Bash where possible.
- Fallback shell: PowerShell when Git Bash is unavailable or a Windows-specific command is required.
- Config file: JSON.
- TUI style: similar to Codex CLI, lightweight and fast.
- Development style: spec-driven development.
- Planning agents: Claude Code and Codex.
- Parity checker: Claude.
- Execution agent: Codex.
- Review agent: Codex.
- Planning effort: `high`.
- Execution effort: `medium`.
- Review effort: `high`.
- All other effort defaults: `medium`.

## Source Of Truth

The spec is the source of truth.

Plans, execution prompts, and reviews must be derived from the spec. If a plan proposes behavior that changes intended functionality, this spec must be updated before execution.

## Requirements

### R1: Config-Driven Agent Orchestration

TaskForge must load workflow behavior from a config file.

The config must support:

- configured agents
- agent roles
- workflow role assignment
- effort levels
- preferred shell settings
- target working directory

### R2: Agent Support

The first supported agents are:

- Claude Code
- Codex

Claude must support:

- planning
- parity checking

Codex must support:

- planning
- execution
- review

### R3: Spec-Driven Planning

Planning must run against the active spec.

Claude and Codex must both produce plans from the same spec context. Agent prompts must tell agents not to invent requirements outside the spec.

Each plan should identify which requirements or acceptance criteria it addresses.

### R4: Plan Parity

TaskForge must compare the Claude and Codex plans for core parity.

If plans differ in core essence, TaskForge must use Claude to check parity between both plans.

If the parity result says the plans materially differ, TaskForge must ask the user to choose or merge before execution.

### R5: Codex Execution

Execution must run in Codex.

Execution must receive:

- the active spec
- the selected or merged plan
- the original user request
- the target working directory

Execution must be instructed to stay within the spec.

### R6: Codex Review

Review must run in Codex.

Review must check whether the resulting changes satisfy the spec and selected plan.

Review must be informational only in the first version. It must not auto-apply fixes.

### R7: TUI

TaskForge must provide a lightweight terminal UI similar in workflow feel to Codex CLI.

The TUI should show:

- current phase
- active agents
- target cwd
- live agent output
- selected plan, comparison, parity result, or review findings
- prompt or confirmation input
- compact key hints

### R8: CLI Command

The installed command must be `tfg`.

The project should not register `forge` as a default binary.

### R9: Effort Levels

Effort levels must be part of the config.

Default effort policy:

- planning: `high`
- execution: `medium`
- review: `high`
- everything else: `medium`

### R10: Git Bash Preference

TaskForge should use Git Bash commands where possible.

The process runner must resolve Git Bash from config first, then from `PATH`, and fall back to PowerShell only when needed.

### R11: Phase 2 Input Shortcuts

TaskForge must support the Phase 2 input shortcut plan in `phase-2-input-shortcuts.md`.

Phase 2 includes:

- `@` file and folder references
- `!` Git Bash command execution

## Non-Goals

The first version will not:

- support arbitrary third-party agent plugins
- register `forge` as a CLI command
- auto-fix Codex review findings
- provide an in-TUI advanced merge editor
- create or update automated tests by default
- perform execution without a selected or merged plan
- treat plans as authoritative over the spec

## Acceptance Criteria

1. `tfg` can load a JSON config that defines Claude and Codex roles.
2. `tfg` can resolve configured effort levels using the default policy.
3. `tfg` can run Claude and Codex planning from the same active spec.
4. `tfg` can compare both plans and detect meaningful differences.
5. `tfg` can call Claude to classify plan parity when local comparison finds meaningful differences.
6. `tfg` pauses for user choice or merge when plans materially differ.
7. `tfg` executes the selected or merged plan in Codex.
8. `tfg` reviews resulting changes in Codex.
9. Review output is shown to the user without auto-applying fixes.
10. Git Bash is preferred for shell commands where possible.
11. Phase 2 shortcut behavior is documented separately and referenced from the main spec.

## Constraints

- Keep the implementation lightweight and fast.
- Keep dependencies minimal.
- Prefer direct subprocess execution with structured argument arrays.
- Centralize shell wrapping and quoting in the process runner.
- Stay within the configured target workspace.
- Do not hardcode effort levels in workflow or adapter code.
- Do not make execution decisions from a plan that conflicts with the spec.

## Risks

- Claude and Codex may return different structured output formats.
- Codex review may require the target directory to be a git repository.
- Windows command quoting can be fragile.
- Git Bash may not be installed at the configured path.
- Manual plan merge may need a better editor flow later.
- Spec validation can become too rigid if the required sections are overdefined too early.

## Open Questions

1. Should TaskForge generate the initial spec interactively from a user request?
2. Should each task have its own spec folder under `specs/<task-slug>/`?
3. Should TaskForge block execution if acceptance criteria are missing?
4. Should review require every finding to cite a spec requirement or acceptance criterion?
5. Should Phase 2 shortcuts be available while agents are running, or only before submission?

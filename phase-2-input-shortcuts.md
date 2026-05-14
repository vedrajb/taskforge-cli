# Phase 2: Input Shortcuts

## Goal

Add Codex-style input shortcuts to TaskForge:

- `@agent`: address one configured agent in the current prompt.
- `$skill`: access one configured skill in the current prompt.
- `#path/to/file`: attach a workspace file reference to the current prompt.
- `#path/to/folder`: attach a shallow workspace folder reference to the current prompt.
- `!command`: run a Git Bash command from the current target workspace.

## Planned Files

```text
src/input/parseUserInput.ts
src/input/loadSkills.ts
src/input/resolveFileReferences.ts
src/input/runBangCommand.ts
```

## Settings Storage

All TaskForge settings are stored under `~/.config/taskforge`.

Rules:

1. Keep user-level settings outside the target workspace.
2. Use `~/.config/taskforge` as the single settings root for Phase 2.
3. Store configurable input-shortcut settings there, including the optional skill source folder override.
4. Store TaskForge session info there so active session state is shared across runs without writing to the target workspace.
5. Keep `taskforge.config.json` focused on project/workflow configuration, not user-level settings or session state.

## `@` Agent Mentions

`@` mentions address configured agents by id.

Rules:

1. Resolve agent mentions against `agents.<agentId>` in `taskforge.config.json`.
2. Treat unknown agent mentions as unresolved and show them in the TUI before submitting the prompt.
3. Allow multiple agent mentions in one prompt.
4. If no agent is mentioned, keep the normal workflow-selected agent behavior.
5. Pass resolved agent mentions as structured routing context instead of leaving them only in raw prompt text.

## `$` Skill Access

`$` references access configured skills by id.

Rules:

1. Load skills from the user's `~/.codex` folder by default.
2. Allow the skills source folder to be overridden in settings stored under `~/.config/taskforge`.
3. Resolve skill references against the loaded skill registry for TaskForge.
4. Treat unknown skill references as unresolved and show them in the TUI before submitting the prompt.
5. Allow multiple skill references in one prompt.
6. Keep skill references separate from agent routing so a prompt can target both an agent and one or more skills.
7. Pass resolved skill references as structured execution context instead of leaving them only in raw prompt text.

## `#` File References

`#` references resolve relative to `target.cwd`.

Rules:

1. Only resolve files and folders inside the configured target workspace.
2. Reject absolute paths unless they resolve inside `target.cwd`.
3. Reject parent traversal that escapes `target.cwd`.
4. For files, include path, size, and text content when the file is reasonably small.
5. For folders, include a shallow listing first. Do not recursively read large folder trees by default.
6. Show unresolved references in the TUI before submitting the prompt.

Resolved references should be passed into agent prompts as labeled structured context. Do not paste file content into the raw user request without path labels.

## `!` Bash Commands

`!` commands run through Git Bash where possible.

Rules:

1. Run from `target.cwd`.
2. Prefer the configured Git Bash shell.
3. Stream stdout and stderr into the TUI.
4. Require confirmation before disruptive commands listed in the project guardrails.
5. Block commands that target paths outside the workspace unless explicitly confirmed.
6. Do not run `!` commands during active agent execution unless the current phase explicitly allows it.

Initial command shape:

```powershell
"C:\Program Files\Git\bin\bash.exe" -lc "<command>"
```

The input parser should produce a structured command request. `runProcess.ts` should be responsible for converting that request into the final process invocation so shell quoting stays centralized.

## Implementation Checklist

1. Add user input parsing for regular text, `@` agent mentions, `$` skill references, `#` file references, and `!` commands.
2. Add configured-agent resolution for `@` mentions.
3. Add skill loading from `~/.codex` by default.
4. Add `~/.config/taskforge` settings storage.
5. Add a settings option under `~/.config/taskforge` that overrides the skill source folder.
6. Add session info storage under `~/.config/taskforge`.
7. Add configured-skill resolution for `$` references.
8. Add workspace-bound path resolution for `#` references.
9. Add shallow folder summary generation.
10. Add TUI preview for resolved and unresolved references.
11. Add Git Bash command execution for `!` commands.
12. Add high-risk command detection and confirmation prompts.
13. Stream `!` command output through the same TUI log path used for agent output.

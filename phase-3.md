# Phase 3: Shared Sessions Across Agents

## Goal

Enable TaskForge to share session context across configured agents in the same run and across later `tfg` runs.

The shared session layer should let one agent publish useful state and another agent consume it without relying on raw terminal logs or workspace files.

Session state must be stored as user-level TaskForge data, not project data.

## Planned Files

```text
src/session/schema.ts
src/session/loadSession.ts
src/session/saveSession.ts
src/session/sessionStore.ts
src/session/buildSessionContext.ts
src/session/recordAgentHandoff.ts
```

## Session Model

A TaskForge session represents one ongoing user goal inside one `target.cwd`.

Initial session shape:

```ts
type TaskForgeSession = {
  id: string;
  targetCwd: string;
  createdAt: string;
  updatedAt: string;
  activeAgent?: string;
  requestedAgents: string[];
  requestedSkills: string[];
  prompts: Array<{
    id: string;
    text: string;
    createdAt: string;
  }>;
  agentRuns: Array<{
    id: string;
    agentId: string;
    role: "plan" | "parity" | "execute" | "review";
    status: "pending" | "running" | "completed" | "failed" | "cancelled";
    startedAt: string;
    endedAt?: string;
    summary?: string;
    outputRef?: string;
  }>;
  handoffs: Array<{
    fromAgent: string;
    toAgent: string;
    reason: string;
    contextRef?: string;
    createdAt: string;
  }>;
};
```

Rules:

1. Treat `target.cwd` as part of the session identity.
2. Store structured session state separately from raw agent output.
3. Keep enough metadata to let another agent understand the current goal, prior prompts, previous agent runs, and explicit handoffs.
4. Do not store large raw logs directly in the main session file; use `outputRef` or a similar reference when persisted output is needed.
5. Keep active session state separate from `taskforge.config.json`.

## Storage Scope

All shared session state is stored under `~/.config/taskforge`.

Recommended layout:

```text
~/.config/taskforge/
settings.json
sessions/
  index.json
  <session-id>/
    session.json
    outputs/
```

Rules:

1. Keep session info outside the target workspace.
2. Keep `taskforge.config.json` focused on project/workflow configuration.
3. Use the session index to map `target.cwd` to the most recent active session.
4. Update session files atomically where possible so interrupted agent runs do not corrupt active session state.
5. Store only portable paths or normalized absolute paths needed to identify the target workspace.

## Sharing Rules

Agents share state through the TaskForge session layer.

Rules:

1. Before an agent starts, build structured context from the active session.
2. Pass shared session context into agent adapters as labeled structured context, not raw pasted logs.
3. After an agent finishes, write its run status, summary, output reference, and any handoff metadata back into the session.
4. If multiple agents run in parallel, merge completed run records without overwriting unrelated agent state.
5. If two agents update the same session field, prefer append-only records unless a single owner is clearly defined.
6. Keep agent routing separate from session storage. `@agent` selects routing; the session layer records what happened.
7. Keep `$skill` resolution separate from session storage. The session records selected skills, not skill implementation files.

## Workflow Integration

Session sharing applies to planning, parity, execution, and review.

Workflow:

1. On startup, load settings from `~/.config/taskforge`.
2. Resolve the active session for the current `target.cwd`.
3. Create a new session when no active session exists or when the user explicitly starts fresh.
4. When the user submits a prompt, append it to the active session before dispatching agents.
5. Before each agent adapter call, call `buildSessionContext` with the active session and current routing context.
6. During agent execution, stream output to the TUI as before.
7. After agent execution, record status, summary, output reference, and handoff information.
8. When another agent starts, include the updated session context so it can continue from prior work.
9. On exit, persist the latest active session pointer for the `target.cwd`.

## TUI Requirements

The TUI should expose enough session state to make cross-agent sharing visible without becoming a full session browser.

Initial display:

1. Show the active session id in the status area.
2. Show the current active agent when one is running.
3. Show the latest handoff summary when one agent hands work to another.
4. Show a readable warning if session load or save fails.

## Implementation Checklist

1. Add Zod schemas for TaskForge session data.
2. Add `~/.config/taskforge` session storage helpers.
3. Add a session index keyed by `target.cwd`.
4. Add active session load/create behavior on startup.
5. Append submitted prompts to the active session.
6. Record requested `@agent` and `$skill` context in the session.
7. Build structured session context for agent adapters.
8. Record agent run status and summaries after each adapter run.
9. Record explicit handoffs between agents.
10. Update the TUI status area with active session details.
11. Handle interrupted or cancelled agent runs without corrupting session state.

## Validation Plan

Do not create tests by default.

Validate with:

```bash
npm run build
npm run dev
```

Manual validation scenarios:

1. Start `tfg` in a Git repo and confirm an active session is created under `~/.config/taskforge`.
2. Submit a prompt that routes to one agent and confirm the prompt is persisted in the session.
3. Route a later prompt to another agent and confirm it receives structured context from the same session.
4. Exit and restart `tfg` in the same `target.cwd`; confirm the active session is restored.
5. Start `tfg` in a different `target.cwd`; confirm it does not reuse the wrong active session.
6. Cancel an agent run and confirm the session records the cancellation without corrupting prior records.
7. Confirm no session state is written into the target workspace or `taskforge.config.json`.

## Risks

- Concurrent agents may update the same session at the same time; prefer append-only records and atomic writes.
- Stale sessions may cause an agent to continue from outdated context; the TUI should make the active session visible.
- Large agent outputs can make session files slow or noisy; store raw output by reference instead of embedding it in the main session file.
- Session sharing can blur user intent if routing is implicit; preserve explicit `@agent` and `$skill` selections in session metadata.
- Cross-run session restore must not leak context between unrelated workspaces.

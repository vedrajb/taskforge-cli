import React from 'react';
import {Static, Box} from 'ink';
import {TranscriptEntry} from './types.js';
import {UserMessage} from './entries/UserMessage.js';
import {SystemMessage} from './entries/SystemMessage.js';
import {AgentMessage} from './entries/AgentMessage.js';
import {PlanBlock} from './entries/PlanBlock.js';
import {ParityBlock} from './entries/ParityBlock.js';
import {PromptSplit} from './PromptSplit.js';

export type TranscriptProps = {
  finalizedEntries: TranscriptEntry[];
  activeEntry: Extract<TranscriptEntry, {kind: 'prompt_split'}> | null;
  showDiag: boolean;
};

function EntryView({entry, showDiag}: {entry: TranscriptEntry; showDiag: boolean}): React.ReactElement | null {
  switch (entry.kind) {
    case 'user':
      return <UserMessage text={entry.text} />;
    case 'system':
      return <SystemMessage text={entry.text} level={entry.level} />;
    case 'agent':
      return <AgentMessage agent={entry.agent} text={entry.text} level={entry.level} />;
    case 'plan':
      return <PlanBlock plan={entry.plan} source={entry.source} />;
    case 'parity':
      return (
        <ParityBlock
          claudePlan={entry.claudePlan}
          codexPlan={entry.codexPlan}
          classification={entry.classification}
          reason={entry.reason}
        />
      );
    case 'prompt_split':
      return <PromptSplit entry={entry} showDiag={showDiag} />;
    default:
      return null;
  }
}

export function Transcript({finalizedEntries, activeEntry, showDiag}: TranscriptProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Static items={finalizedEntries.map((e, i) => ({...e, _key: i}))}>
        {(entry) => (
          <EntryView
            key={(entry as typeof entry & {_key: number})._key}
            entry={entry}
            showDiag={showDiag}
          />
        )}
      </Static>
      {activeEntry && (
        <PromptSplit entry={activeEntry} showDiag={showDiag} />
      )}
    </Box>
  );
}

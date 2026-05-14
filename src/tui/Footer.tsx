import React from 'react';
import {Box, Text} from 'ink';

export type FooterProps = {
  phase?: string;
};

export function Footer({phase}: FooterProps): React.ReactElement {
  let hint = 'Ctrl+C exits.';

  if (phase === 'idle') {
    hint = 'Enter submits prompt. Ctrl+C exits.';
  } else if (phase === 'awaiting_choice') {
    // Keep the choice hint broad enough for defaulted and always-ask plan selection.
    hint = 'Enter to proceed. 1=Claude plan  2=Codex plan  m=auto-merge  Ctrl+C cancels.';
  } else if (phase === 'done') {
    hint = 'r=run review  Ctrl+C exits.';
  }

  return (
    <Box marginTop={1}>
      <Text color="gray">{hint}</Text>
    </Box>
  );
}

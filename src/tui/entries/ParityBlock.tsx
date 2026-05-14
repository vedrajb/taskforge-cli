import React from 'react';
import {Box, Text} from 'ink';
import {AgentPlan} from '../../agents/types.js';
import {roleColor} from '../theme.js';

export function ParityBlock({
  claudePlan,
  codexPlan,
  classification,
  reason,
}: {
  claudePlan: AgentPlan;
  codexPlan: AgentPlan;
  classification: string;
  reason: string;
}): React.ReactElement {
  const classColor =
    classification === 'same' ? 'green' : classification === 'compatible' ? 'yellow' : roleColor.error;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        <Text color={roleColor.system} bold>{'parity ›'}</Text>
        <Text color={classColor}> {classification}</Text>
        <Text dimColor wrap="truncate-end"> — {reason}</Text>
      </Box>
      <Box paddingLeft={10}>
        <Text color={roleColor.claude} wrap="truncate-end">claude: {claudePlan.summary}</Text>
      </Box>
      <Box paddingLeft={10}>
        <Text color={roleColor.codex} wrap="truncate-end">codex:  {codexPlan.summary}</Text>
      </Box>
    </Box>
  );
}

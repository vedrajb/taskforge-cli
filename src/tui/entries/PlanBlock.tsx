import React, {useState} from 'react';
import {Box, Text} from 'ink';
import {AgentPlan} from '../../agents/types.js';
import {roleColor} from '../theme.js';

export function PlanBlock({plan, source}: {plan: AgentPlan; source: string}): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const tag = 'plan   ›';

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        <Text color={roleColor.plan} bold>{tag}</Text>
        <Text wrap="truncate-end"> [{source}] {plan.goal}</Text>
      </Box>
      {!expanded && plan.steps.map((step, i) => (
        <Box key={step.id} paddingLeft={10}>
          <Text dimColor wrap="truncate-end">{i + 1}. {step.title}</Text>
        </Box>
      ))}
      {expanded && (
        <Box paddingLeft={10} flexDirection="column">
          <Text dimColor wrap="wrap">{JSON.stringify(plan, null, 2)}</Text>
        </Box>
      )}
      <Box paddingLeft={10}>
        <Text dimColor>{expanded ? '▾ /diff to collapse' : '▸ /diff to expand JSON'}</Text>
      </Box>
    </Box>
  );
}

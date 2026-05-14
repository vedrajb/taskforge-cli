import React from 'react';
import {Box, Text, useInput, useStdout} from 'ink';
import {AppAction} from './types.js';
import {parseCommand, isCommandMode, commandSuggestions} from './commands.js';

export type ComposerProps = {
  draft: string;
  dispatch: (action: AppAction) => void;
  onSubmit: (text: string) => void;
  onCommand: (name: string, args: string) => void;
  disabled?: boolean;
};

export function Composer({draft, dispatch, onSubmit, onCommand, disabled}: ComposerProps): React.ReactElement {
  const {stdout} = useStdout();
  const termWidth = stdout.columns ?? 80;

  useInput(
    (input, key) => {
      if (key.return) {
        const trimmed = draft.trim();
        if (!trimmed) return;
        const cmd = parseCommand(trimmed);
        if (cmd) {
          dispatch({type: 'draft', text: ''});
          onCommand(cmd.name, cmd.args);
        } else {
          dispatch({type: 'submit'});
          onSubmit(trimmed);
        }
        return;
      }

      if (key.upArrow) {
        dispatch({type: 'history_nav', dir: 'up'});
        return;
      }

      if (key.downArrow) {
        dispatch({type: 'history_nav', dir: 'down'});
        return;
      }

      if (key.backspace || key.delete) {
        dispatch({type: 'draft', text: draft.slice(0, -1)});
        return;
      }

      if (input && !key.ctrl && !key.meta) {
        dispatch({type: 'draft', text: draft + input});
      }
    },
    {isActive: !disabled}
  );

  const cmdMode = isCommandMode(draft);
  const suggestions = cmdMode ? commandSuggestions(draft.split(' ')[0] ?? '') : [];
  const showSuggestions = cmdMode && suggestions.length > 0 && suggestions[0] !== draft.split(' ')[0];

  // paddingX={1} on the parent Box consumes 2 cols; the rounded border consumes 2 more.
  // Leave the Box unconstrained and let Ink fill available width via flexGrow.
  return (
    <Box flexDirection="column" paddingX={1}>
      {showSuggestions && (
        <Box paddingLeft={2}>
          <Text dimColor>{suggestions.join('  ')}</Text>
        </Box>
      )}
      <Box borderStyle="round" width={termWidth - 2}>
        <Text color={cmdMode ? 'yellow' : 'cyan'} bold>{'>'}</Text>
        <Text wrap="truncate-end"> {draft}</Text>
        <Text color="gray">{'_'}</Text>
      </Box>
    </Box>
  );
}

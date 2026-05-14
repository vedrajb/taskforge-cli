import React from 'react';
import {Static, Box, Text} from 'ink';
import {LoadedConfig} from '../config/loadConfig.js';

const PKG_VERSION = '0.1.0';

export type BannerProps = {
  loadedConfig?: LoadedConfig;
};

export function Banner({loadedConfig}: BannerProps): React.ReactElement {
  const agents = loadedConfig ? Object.keys(loadedConfig.config.agents).join('+') : 'none';
  const cwd = loadedConfig?.targetCwd ?? process.cwd();
  const repo = loadedConfig?.repoRoot;
  const repoSuffix = repo ? ` (${repo.split('/').pop() ?? repo})` : '';

  const line = `taskforge v${PKG_VERSION}  ·  ${agents}  ·  ${cwd}${repoSuffix}`;

  return (
    <Static items={[{id: 'banner', line}]}>
      {(item) => (
        <Box key={item.id} paddingX={1}>
          <Text dimColor>{item.line}</Text>
        </Box>
      )}
    </Static>
  );
}

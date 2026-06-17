import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    alias: {
      vscode: fileURLToPath(new URL('./test/vscode.ts', import.meta.url)),
    },
  },
});

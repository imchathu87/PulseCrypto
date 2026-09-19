import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

// Root `pnpm -r run <x>` silently skips a package that lacks script <x>, so a missing script
// would drop that package from the gate without failing it.

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const PACKAGES = ['apps/api', 'apps/mobile', 'packages/contracts'] as const;
const GATES = ['typecheck', 'lint', 'test'] as const;

const PackageJsonSchema = z.object({ scripts: z.record(z.string(), z.string()).optional() });

function scriptsOf(pkg: string): Record<string, string> {
  const raw: unknown = JSON.parse(readFileSync(`${repoRoot}${pkg}/package.json`, 'utf8'));
  return PackageJsonSchema.parse(raw).scripts ?? {};
}

describe('workspace gates', () => {
  for (const pkg of PACKAGES) {
    it(`${pkg} defines typecheck, lint and test scripts`, () => {
      const scripts = scriptsOf(pkg);
      for (const gate of GATES) {
        expect(scripts[gate], `${pkg} is missing "${gate}"`).toMatch(/\S/);
      }
    });
  }
});

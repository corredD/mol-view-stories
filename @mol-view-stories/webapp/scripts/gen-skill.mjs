/**
 * Bundle mcp-server/SKILLS.md into a TypeScript constant.
 *
 * Why a generated module rather than fs.readFileSync at request time: a
 * `next build --output standalone` deploy ships no source tree, so runtime file
 * reads of repo content fail there (that is exactly how mvs_doc_* and example_*
 * ended up as 500s in production). Anything the MCP must always be able to serve
 * has to arrive through the module graph.
 *
 * Emitted as a JSON string literal, not a template literal: SKILLS.md is 475
 * lines of markdown full of backticks and ${...}, and JSON.stringify output is
 * valid TypeScript, so nothing needs hand-escaping.
 *
 * Run via `pnpm gen:skill` (wired into build + dev).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, '..', '..', 'mcp-server', 'SKILLS.md');
const OUT = resolve(here, '..', 'src', 'lib', 'mcp', 'skill.generated.ts');

const md = readFileSync(SRC, 'utf8');

const banner = `// GENERATED FILE — do not edit.
// Source: @mol-view-stories/mcp-server/SKILLS.md
// Regenerate: pnpm --filter @mol-view-stories/webapp gen:skill
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${banner}\nexport const MVS_SKILL: string = ${JSON.stringify(md)};\n`, 'utf8');

console.log(`gen-skill: ${md.length} bytes -> ${join('src', 'lib', 'mcp', 'skill.generated.ts')}`);

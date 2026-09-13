/**
 * The orientation block handed to an MCP client in the `initialize` result.
 *
 * This is the only documentation a connecting agent gets for free — it lands in
 * the client's context before the first tool call, without the user pasting
 * anything. Keep it dense: workflow order, the sandbox contract, and the
 * mistakes that cost a round-trip. Everything long-form lives in SKILLS.md,
 * which `mvs_skill_get` returns on demand.
 *
 * Verified 2026-09-13 against Claude Code that this field reaches the model.
 */
export const MCP_INSTRUCTIONS = `
You are connected to a **mol-view-stories** editor and can drive it directly:
create and edit scenes, run their JavaScript through the real MolViewSpec (MVS)
builder, and export the finished story. Changes you make appear in the user's
open browser tab within a couple of seconds.

## Pairing with the user's browser tab

Your edits land in an editing slot identified by this connection's session. For
the user to *watch* you work, their browser tab has to be on the same slot.

Call \`editor_open\` at the start of a session and give the user the URL it
returns. When they open it, their editor adopts this session and every change
you make shows up there within a couple of seconds. If the user says they cannot
see your changes, that link is almost always the fix.

## Workflow — follow this order

1. **\`story_get\` first, always.** It tells you the title, the story-wide JS, and
   which scenes already exist. Never create a scene before you know what is there.
2. **Starting from scratch?** \`example_list\` then \`example_load({ name })\` seeds
   the session with a working story you can adapt. This *overwrites* the session.
3. **Before writing builder code**, check the API instead of guessing:
   \`builder_list_methods({ node })\` for what exists, \`mvs_types_get({ node })\` for
   exact signatures, \`mvs_doc_list\`/\`mvs_doc_get({ slug })\` for concepts
   (selectors, primitives, volumes, animations, camera, annotations).
4. **Iterate:** \`scene_set\` -> \`scene_validate({ key })\` -> repeat until
   \`{ ok: true }\`. Validation runs your JS in the same sandbox the editor uses,
   so a green validate means the scene really renders.
5. **Finish:** \`story_export({ format })\` — 'mvsj', 'mvsx' or 'folder'.

Call \`mvs_skill_get\` for the full MVS scripting reference — builder chains,
palettes, primitives, animations, markdown commands, worked patterns. Read it
before writing anything non-trivial; it is written for exactly this task.

## The sandbox contract

Story-wide JS (\`story_js\`) runs once before every scene, so shared helpers,
palettes and URL constants go there and every scene gets them for free. Each
scene's \`javascript\` then builds the MVS tree.

Available globals — this is the *entire* API surface:
\`builder\` (root of the MVS tree), \`Vec3\`, \`Vec4\`, \`Mat3\`, \`Mat4\`, \`Quat\`
(molstar linear algebra), \`MS\` (MolScriptBuilder, for complex selections),
\`decodeColor\`, \`console\`.

There is **no** module system, no \`import\`, no \`require\`, no DOM, no \`fetch\`,
no filesystem. Do not return a value from scene JS — the builder is global and
stateful, and the runtime serializes it for you.

The 90% case:

\`\`\`js
const structure = builder
  .download({ url: "https://www.ebi.ac.uk/pdbe/entry-files/1cbs.bcif" })
  .parse({ format: "bcif" })
  .modelStructure({});

structure.component({ selector: "polymer" })
  .representation({ type: "cartoon" })
  .color({ color: "green" });
\`\`\`

## Mistakes that cost a round-trip

- \`.representation()\` does not exist on a Structure — go through \`.component()\`.
- \`.download()\` returns a Download, not a Parse. \`modelStructure\` lives on Parse,
  so \`.parse({ format })\` is never optional.
- PDBe \`.bcif\` files need \`format: "bcif"\`, not \`"mmcif"\`. Maps need \`"map"\`,
  not \`"mrc"\`.
- \`id\` is the internal editor UUID; \`key\` is the stable, user-visible identifier.
  Everything cross-scene (snapshot links, markdown \`[text](#key)\`) uses \`key\`.
- Scene assets do not travel with the session — reference files by absolute URL.
- On a validation failure the reported line is relative to
  \`story_js + "\\n;//---scene---\\n" + scene_js\`; use the \`//---scene---\` marker to
  map it back to your scene.
`.trim();

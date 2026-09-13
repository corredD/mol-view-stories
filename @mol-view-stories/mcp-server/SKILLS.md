# MVS Scripting Skill

You are writing JavaScript that drives the **MolViewSpec (MVS) builder** to produce
a 3D molecular scene inside the `mol-view-stories` editor. This file is the
self-contained reference: it should be enough on its own to write working scenes.
The MCP tools (see end of file) are for *actions* — querying state, mutating
scenes, validating, exporting. Use them for the verbs; use this file for the
nouns.

## 1. The shape of a story

A story has:

- **Story-wide JS** (`story_js`) — runs once before every scene. Put shared
  helpers, color palettes, URL constants, selector factories here.
- **Scenes**, each with its own `javascript` block that builds the MVS tree
  via the `builder` global. Each scene also has `name`, `description`
  (markdown shown in the side panel), `key` (stable identifier), and timings.

`story_js` and the scene's `javascript` are concatenated and run together in a
sandboxed Node `vm` — so anything defined at top-level in `story_js` is in scope
in every scene. There is no module system, no `import`, no `require`.

## 2. Globals available to your code

These are injected into the sandbox by both the dev validate route and the
in-browser scene runner. Don't try to import anything; just use them:

| Name | What it is |
|---|---|
| `builder` | Root of the MVS tree (`Root` instance). Start every scene from here. |
| `Vec3`, `Vec4`, `Mat3`, `Mat4`, `Quat` | molstar's `linear-algebra` helpers. |
| `MS` | `MolScriptBuilder` — for complex selection expressions. |
| `decodeColor` | Convert numeric/string colors to a canonical form. |
| `console` | Standard logging (stderr in validate, devtools in browser). |

That is the **entire** API surface. No DOM, no fetch, no fs.

## 3. The fluent builder chain

Each builder method returns a builder pointing to a different node type. The
node type determines what's callable next. The 90% case for a scene:

```js
const structure = builder
  .download({ url: "https://www.ebi.ac.uk/pdbe/entry-files/1cbs.bcif" })
  .parse({ format: "bcif" })
  .modelStructure({});

structure.component({ selector: "polymer" })
  .representation({ type: "cartoon" })
  .color({ color: "green" });

structure.component({ selector: "ligand" })
  .representation({ type: "ball_and_stick" })
  .color({ color: "#cc3399" })
  .focus({});
```

The node graph:

```
Root (builder)
 ├── .download({url})          → Download
 │     └── .parse({format})    → Parse
 │           ├── .modelStructure({})           → Structure
 │           ├── .assemblyStructure({assembly_id})
 │           ├── .symmetryStructure({ijk_min, ijk_max})
 │           ├── .symmetryMatesStructure({radius})
 │           └── .volume({})                   → Volume
 ├── .camera({...})            → Root  (sets initial camera)
 ├── .canvas({...})             → Root  (background, post-processing)
 ├── .primitives({...})         → Primitives  (shapes not tied to a structure)
 ├── .primitivesFromUri({...})  → PrimitivesFromUri
 ├── .animation({...})          → Animation
 └── .focus({...})              → Root  (frame the whole scene)

Structure
 ├── .component({selector})     → Component
 ├── .componentFromUri({...})   → Component   (annotation-driven selection)
 ├── .componentFromSource({...})→ Component   (CIF column selection)
 ├── .labelFromUri / .labelFromSource     → Structure
 ├── .tooltipFromUri / .tooltipFromSource → Structure
 ├── .transform({rotation, translation, matrix})
 └── .primitives({...})         → Primitives  (positions auto-resolve against the structure)

Component
 ├── .representation({type})    → Representation
 ├── .label({text})             → Component
 ├── .tooltip({text})           → Component
 ├── .focus({...})              → Component
 └── .transform({...})

Representation
 ├── .color({color, selector?})         → Representation
 ├── .colorFromUri({uri, schema, ...})  → Representation
 ├── .colorFromSource({category_name, field_name, ...})
 ├── .opacity({opacity})
 └── .clip({...})

Volume
 └── .representation({type})    → VolumeRepresentation  (isosurface | grid_slice)

Primitives
 ├── .sphere / .box / .tube / .arrow / .ellipse / .ellipsoid
 ├── .distance / .angle / .label
 └── .mesh / .lines                                    (low-level geometry)
```

## 4. String unions — the values that actually work

These are the closed enums you'll use most. Anything else will be rejected by
the builder.

**Parse formats** (`parse({format})`):
`mmcif`, `bcif`, `pdb`, `pdbqt`, `gro`, `xyz`, `mol`, `sdf`, `mol2`,
`lammpstrj`, `xtc`, `nctraj`, `dcd`, `trr`, `psf`, `prmtop`, `top`,
`map`, `dx`, `dxbin`.

**Component selectors** (predefined values for `component({selector})`):
`"all"`, `"polymer"`, `"protein"`, `"nucleic"`, `"branched"`, `"ligand"`,
`"ion"`, `"water"`, `"coarse"`.

**Component selector — object form** (for precise selections):
```js
.component({ selector: { label_asym_id: "A" } })               // chain A
.component({ selector: { label_seq_id: 42 } })                  // single residue
.component({
  selector: {
    auth_asym_id: "B",
    beg_auth_seq_id: 10,
    end_auth_seq_id: 20,
  },
})                                                              // range
```
Arrays of these are also accepted: `selector: [ {...}, {...} ]` is a union.

**Representation types** (`representation({type})`):
`cartoon`, `backbone`, `ball_and_stick`, `line`, `spacefill`,
`carbohydrate`, `surface`.

Each accepts `size_factor: number` and `ignore_hydrogens: boolean`. `cartoon`
also takes `tubular_helices: boolean`. `surface` takes
`surface_type: "gaussian" | "molecular"`.

**Volume representation types**: `isosurface`, `grid_slice`.

**Color**: X11 color name (`"red"`, `"tomato"`) or hex (`"#FF8800"`).
Numeric colors must be decoded via `decodeColor(0xff8800)`.

## 5. Patterns that come up constantly

### Helpers in `story_js`

```js
// story_js
const PDBE = (id) =>
  `https://www.ebi.ac.uk/pdbe/entry-files/${id.toLowerCase()}.bcif`;

function loadPdb(builder, id) {
  return builder.download({ url: PDBE(id) })
    .parse({ format: "bcif" })
    .modelStructure({});
}

function colorByChain(structure, palette) {
  // … return a color object or apply colors per chain
}
```

```js
// scene_js
const s = loadPdb(builder, "8upl");
s.component({ selector: "polymer" })
  .representation({ type: "cartoon" })
  .color({ color: "tomato" });
```

### Per-chain coloring with a palette

```js
const chains = ["A", "B", "C", "D"];
const palette = ["#ff5252", "#40c4ff", "#69f0ae", "#ffd740"];
const structure = builder.download({ url: PDBE("8ucs") })
  .parse({ format: "bcif" })
  .modelStructure({});

for (let i = 0; i < chains.length; i++) {
  structure.component({ selector: { label_asym_id: chains[i] } })
    .representation({ type: "cartoon" })
    .color({ color: palette[i] });
}
```

### Surface with transparency

```js
structure.component({ selector: "polymer" })
  .representation({ type: "surface", surface_type: "molecular" })
  .color({ color: "#888" })
  .opacity({ opacity: 0.4 });
```

### Primitives — labels, spheres, arrows

```js
// Free-floating primitives (root-level)
builder.primitives()
  .sphere({ center: [10, 20, 30], radius: 2.5, color: "red", tooltip: "active site" })
  .label({ position: [10, 22, 30], text: "Cys-123" });

// Structure-attached primitives — positions resolve against the structure
structure.primitives()
  .distance({
    start: { label_asym_id: "A", label_seq_id: 42 },
    end:   { label_asym_id: "B", label_seq_id: 17 },
  });
```

### Camera & canvas

```js
builder.canvas({ background_color: "white" });

// Either set camera explicitly:
builder.camera({
  position: [0, 0, 100],
  target:   [0, 0, 0],
  up:       [0, 1, 0],
});

// …or let a focus() call frame what matters:
structure.component({ selector: "ligand" }).focus({});
```

### Transforms (multiple copies of the same structure)

```js
const a = builder.download({ url: PDBE("8upl") }).parse({ format: "bcif" }).modelStructure({});
a.component({}).representation({ type: "cartoon" }).color({ color: "steelblue" });

a.component({})
  .transform({ translation: [50, 0, 0] })       // shifted copy
  .representation({ type: "cartoon" })
  .color({ color: "tomato" });
```

### Volume isosurface

```js
const vol = builder
  .download({ url: "https://example.org/density.map" })
  .parse({ format: "map" })
  .volume({});

vol.representation({ type: "isosurface", relative_isovalue: 1.5 })
  .color({ color: "#88ccff" })
  .opacity({ opacity: 0.6 });
```

### Color by secondary structure (no built-in keyword)

There's no `selector: "helix"` in MVS. To colour by secondary structure, lay
down a coil baseline then overlay helix / sheet ranges using
`beg_auth_seq_id` / `end_auth_seq_id`. Ranges come from DSSP, the PDB mmCIF
`_struct_conf` / `_struct_sheet_range` records, or your own data:

```js
const helixRanges = [{ beg_auth_seq_id: 7, end_auth_seq_id: 19 }];
const sheetRanges = [{ beg_auth_seq_id: 1, end_auth_seq_id: 4 }];

structure.component({ selector: "polymer" })
  .representation({ type: "cartoon" })
  .color({ color: "#dddddd" });                  // coil baseline

for (const h of helixRanges) {
  structure.component({ selector: h })
    .representation({ type: "cartoon" })
    .color({ color: "#e53935" });                // helix
}
for (const s of sheetRanges) {
  structure.component({ selector: s })
    .representation({ type: "cartoon" })
    .color({ color: "#ffc107" });                // sheet
}
```

### Pulsing illumination / glow on a side chain

Emissive ("illumination") isn't in the MVS schema directly — it's a molstar
extension under `custom.molstar_representation_params`. Animate the scalar
at a nested property path:

```js
structure.component({ selector: { auth_seq_id: 3 } })
  .representation({
    type: "ball_and_stick",
    custom: { molstar_representation_params: { emissive: 0.0 } },
    ref: "cys3_rep",
  })
  .color({ color: "#fff176" });

builder.animation().interpolate({
  kind: "scalar",
  target_ref: "cys3_rep",
  property: ["custom", "molstar_representation_params", "emissive"],
  start: 0.0,
  end: 1.0,
  duration_ms: 6000,
  frequency: 3,
  alternate_direction: true,
  easing: "sin-in-out",
});
```

Pair with `canvas.custom.molstar_postprocessing.enable_bloom: true` so the
emissive reads as a soft glow rather than a flat brightness change. Use the
same pattern with `kind: "color"` and `property: ["params", "color"]` on a
color node ref to cycle hues instead of glow.

## 6. Markdown features in the scene panel

The scene's `description` is rendered through Mol*'s `markdownExtensions`
plugin. Beyond standard markdown, two extra things matter — and they're the
*main reason* you should set `ref` strings in scene JS.

### 6a. Cross-scene navigation

- Scenes are addressed by their `key` (not their `id`). Set `key` when you
  create a scene; everything else references that.
- In a scene's markdown `description`, link to another scene with
  `[text](#scene-key)` — the editor turns these into clickable jumps.
- A scene can also be the target of a snapshot in `builder.camera()` /
  `.focus()` calls via `snapshot_key`.

### 6b. Interactive 3D commands — `[label](!key=value&...)`

Markdown links whose href starts with `!` are *commands*, not URLs. They
connect text in the panel to actions in the 3D viewer: hover a residue name
to highlight it, click a chain name to focus the camera, etc. This is the
killer feature of the markdown panel and the main reason to set `ref`
strings on builder nodes.

**Syntax.** `[label](!key=value&key=value)` — multiple keys joined by `&`,
values URL-encoded (spaces → `%20`, etc.).

**The connection to builder code.** Any `ref` you pass to a builder method
(`representation({ ref: "..." })`, `component({ ref: "..." })`, etc.) becomes
addressable from markdown via `highlight-refs` / `focus-refs`. Set refs
deliberately when you anticipate referencing things from prose.

**Commands you'll actually use:**

| Command | Value | Triggered on | What it does |
|---|---|---|---|
| `highlight-refs` | comma-separated ref names | hover | Highlight nodes carrying those refs; clears on mouse-leave |
| `focus-refs` | comma-separated ref names | click | Focus the camera on those refs |
| `focus-radius` | number | with `focus-refs` | Extra padding around the focused selection (default 3) |
| `query` + `lang` + `action` | expression / `mol-script`\|`pymol`\|`vmd`\|`jmol` / `highlight`\|`focus` | hover or click | Use a selection language instead of refs |
| `apply-snapshot` | scene key | click | Jump to another scene's snapshot |
| `next-snapshot` | `1` or `-1` | click | Step forward / back through scenes |
| `play-snapshots` | (none) | click | Auto-play through scenes |
| `play-transition` / `stop-animation` | (none) | click | Story playback controls |
| `center-camera` | (none) | click | Recenter the camera |

The Mol* docs say commands "can be executed on click, mouse enter, or mouse
leave"; the practical mapping is: `highlight-*` runs on hover, `focus-*` and
navigation commands run on click. Combine both in one link to get both
behaviours.

**Example — residue name that highlights on hover and focuses on click:**

```js
// scene_js
structure.component({ selector: { auth_seq_id: 3 } })
  .representation({ type: "ball_and_stick", ref: "cys3" })
  .color({ color: "#fff176" });
```

```markdown
<!-- description -->
The bridge **SS₁** connects
[Cys3](!highlight-refs=cys3&focus-refs=cys3) to
[Cys40](!highlight-refs=cys40&focus-refs=cys40).
```

**Example — query-based highlight without a ref:**

```markdown
The [heme group](!query=resn%20HEM&lang=pymol&action=highlight) sits in the
hydrophobic pocket.
```

**Example — scene-to-scene from markdown:**

```markdown
Continue to the [active site close-up](!apply-snapshot=active-site).
```

When you're writing scene markdown, **assume the reader will hover the
residue names**. Make sure every residue you call out by name has a `ref` on
its representation and a matching `highlight-refs=...` link.

## 7. The validation contract

Before declaring a scene done, validate it. The server runs your JS in the
same Node `vm` sandbox the editor uses, with the same globals.

- `scene_validate({ key })` — fetches the saved scene + `story_js`, runs them.
- `scene_validate({ scene_js, story_js? })` — preview without saving.

On success: `{ ok: true, mvsj: ... }` (you don't need to look at the mvsj —
just trust the `ok`).

On failure: `{ ok: false, error: { name, message, line, column, stack } }`.
The line number is relative to the combined `story_js + "\n;//---scene---\n" + scene_js`,
so subtract the `story_js` line count to find the offending line in your
scene. The marker `//---scene---` is your reference.

## 8. Common mistakes (read this before writing)

- **Calling `.representation()` on a Structure.** You must go through
  `.component()` first.
- **Skipping `.parse({ format })`.** `.download()` returns a Download, not a
  Parse. `modelStructure` lives on Parse.
- **Wrong `format`.** PDBe `.bcif` files require `format: "bcif"`, not
  `"mmcif"`. Maps require `"map"`, not `"mrc"`.
- **Returning a value from scene JS.** The builder is global and stateful;
  nothing is returned. The serialized snapshot comes from `builder.getState()`,
  which the runtime does for you.
- **Trying to `import` molstar.** No module loader in the sandbox; everything
  is on the globals listed in §2.
- **Mixing `id` and `key`.** Internal editor UUID is `id`; the user-visible,
  link-target identifier is `key`. Anything cross-scene uses `key`.
- **Assuming binary assets travel.** The dev session does not carry scene
  assets — when your code refers to a file, it must be an absolute URL the
  browser can reach.
- **Re-creating helpers per scene.** Put shared helpers in `story_js` once;
  scenes get them for free.

## 9. When to call which MCP tool

| Situation | Call |
|---|---|
| Start of session | `story_get` (always — know what's already there) |
| User needs to *see* your work | `editor_open` — give them the URL it returns |
| Before writing any non-trivial scene | `mvs_skill_get` (this file) |
| Need a curated starting point | `example_list` → `example_load({ name })` |
| Unsure a method exists | `builder_list_methods({ node })` |
| Need an exact signature | `mvs_types_get({ node, method })` |
| Conceptual question (selectors, primitives, animations, volumes, camera, annotations) | `mvs_doc_list` → `mvs_doc_get({ slug })` |
| Iterating on a scene | `scene_set` → `scene_validate({ key })` → repeat until `ok` |
| Done | `story_export({ format })` |

The reference tools (`mvs_types_get`, `builder_list_methods`, `mvs_doc_get`)
exist to fill gaps in this skill file — they are not the primary reference.
If you find yourself reaching for them on every turn, the answer probably
belongs *in this file* and the workflow is wrong.

## 10. Builder method index (cheatsheet)

Only the methods you actually need to know:

| Node | Methods |
|---|---|
| Root (`builder`) | `download`, `camera`, `canvas`, `primitives`, `primitivesFromUri`, `animation`, `focus`, `getState`, `getSnapshot` |
| Download | `parse` |
| Parse | `modelStructure`, `assemblyStructure`, `symmetryStructure`, `symmetryMatesStructure`, `volume`, `coordinates` |
| Structure | `component`, `componentFromUri`, `componentFromSource`, `labelFromUri`, `labelFromSource`, `tooltipFromUri`, `tooltipFromSource`, `transform`, `instance`, `primitives`, `primitivesFromUri` |
| Component | `representation`, `label`, `tooltip`, `focus`, `transform`, `instance` |
| Representation | `color`, `colorFromUri`, `colorFromSource`, `opacity`, `clip` |
| Volume | `representation`, `focus`, `transform`, `instance` |
| VolumeRepresentation | `color`, `opacity`, `focus`, `clip` |
| Primitives | `mesh`, `lines`, `tube`, `arrow`, `distance`, `angle`, `label`, `ellipse`, `ellipsoid`, `sphere`, `box`, `focus`, `clip` |
| Animation | `interpolate` |

For exact parameter shapes, use `mvs_types_get({ node, method })`.

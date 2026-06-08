# Embind silent-drop bug (upstream regression, ~emscripten 5.0.4)

## TL;DR

**Symptom**: any newly-added `.function()` or `class_<X>().function()` line in
Moorhen's `wasm_src/moorhen-wrappers.cc` or `wasm_src/moorhen-types-wrappers.cc`
silently fails to register at runtime. The binding name string appears in the
compiled WASM's data section, code references to `_embind_register_*` are
present, but the registration doesn't fire at WASM init. Pre-existing
bindings continue to work.

**Affected in PyKeko**: 8 bindings authored 2026-05-22 through 2026-06-07.
4 features have been silently no-op'ing in shipped PyKeko v0.2.x because of
this:
- Edit-Phi-Psi (calls `set_phi_psi`) — UI updates sliders but model doesn't change
- χ torsion display (calls `get_torsion`) — shows 0 instead of the real value
- "Place water" single shortcut (calls `add_water_at_position`) — no effect
- NCS ghost matrix retrieval (calls `get_ncs_ghost_matrix`) — returns null

The JS-side catch blocks in the UI swallow the TypeError silently, so users
see "nothing happened" rather than an error.

Plus the 4 covalent-link bindings shipped as part of task #148 (`make_covalent_link`,
`make_covalent_link_using_cids`, `delete_covalent_link`, `delete_covalent_link_using_cids`).

## The minimum repro (2026-06-07, confirmed against pristine upstream)

```bash
git clone https://github.com/moorhen-coot/Moorhen.git
cd Moorhen
# In wasm_src/moorhen-types-wrappers.cc, inside EMSCRIPTEN_BINDINGS(moorhen_types),
# right before `function("validate", &validate);`, add:
#    function("pk_test_int_only", +[](int a, int b) { return a + b; });
./get_sources
./moorhen_build.sh moorhen
# Build the dev page; open it in a browser.
# In the worker context: typeof cootModule.pk_test_int_only === "undefined"
# But:                    typeof cootModule.validate          === "function"
```

The new binding is in the WASM binary (`strings moorhen.wasm | grep
pk_test_int_only` returns it) but doesn't register at runtime.

## Not a recent version regression: bug exists in emscripten 5.0.3 too

**Tested 2026-06-08.** Installed emscripten 5.0.3 (the oldest version
Moorhen's README claims to support), cold-built pristine
`moorhen-coot/Moorhen` with the `pk_test_int_only` test binding.
Result: `cootModule.pk_test_int_only === undefined` while
`cootModule.validate === function`. **Same symptom as 5.0.7.**

So the bug is not an emscripten 5.0.4-5.0.7 regression — it's older.
It's been latent for at least 3 months (since 5.0.3 was released
2026-03-14), and likely much longer. Moorhen upstream probably hasn't
added a new binding in months, so the regression hasn't bitten them.
PyKeko and any other fork that actively extends the binding surface
will hit it.

This pretty much rules out an emscripten version downgrade as a fix —
the affected behavior is wherever it is in either:
- A long-standing emscripten/binaryen embind interaction with Moorhen's
  specific build configuration (LTO + -O2 + -pthread + -fwasm-exceptions
  + static-init order across libcoot.a)
- Something in Moorhen's build infrastructure (the cmake setup,
  the EMSCRIPTEN_BINDINGS macro placement, linker flags) that's been
  silently broken for some time

## Refuted hypothesis #1: EMSCRIPTEN macro change → ODR violation

Per the [emscripten 5.0.4 changelog (2026-03-23)](https://github.com/emscripten-core/emscripten/blob/main/ChangeLog.md):

> The deprecated `EMSCRIPTEN` macro is now defined in `emscripten.h` rather
> than on the command line (`__EMSCRIPTEN__`, which is built into LLVM,
> should be used instead).

In **5.0.3 and earlier**, the `EMSCRIPTEN` macro was defined on the command
line. Any `#ifdef EMSCRIPTEN` block was true regardless of headers.

In **5.0.4 and later**, the `EMSCRIPTEN` macro is only defined when a TU
explicitly includes `<emscripten.h>`. Most coot .cc files (which Moorhen
links against) do NOT include `<emscripten.h>`. Several headers used by
those .cc files use `#ifdef EMSCRIPTEN` to switch class layouts.

**Concrete example.** `checkout/coot-1.0/api/validation-information.hh`
defines `coot::validation_information_t` two ways:

```cpp
#ifdef EMSCRIPTEN
   std::string type;                                     // (A)
   validation_information_t() : ..., type("UNSET") {}
   validation_information_t(const std::string &gdt, ...) : ..., type(gdt) {}
#else
   enum graph_data_type type;                            // (B)
   validation_information_t() : ..., type(UNSET) {}
   validation_information_t(graph_data_type gdt, ...) : ..., type(gdt) {}
#endif
```

On emscripten 5.0.4+:
- `wasm_src/moorhen-wrappers.cc` includes `moorhen-wrappers-helpers.h`,
  which `#include <emscripten.h>` (line 56) — so `EMSCRIPTEN` is defined,
  and `validation_information_t` has the `std::string type` layout (A).
- `checkout/coot-1.0/api/molecules-container.cc` does NOT include
  `<emscripten.h>` (the maintainers expected `EMSCRIPTEN` to be a
  command-line define) — so `EMSCRIPTEN` is undefined, and
  `validation_information_t` has the `enum type` layout (B).

This is a **One Definition Rule violation**: the same class compiled with
different layouts in different TUs. `wasm-ld` happily merges the .o files;
runtime behavior is undefined. The undefined behavior manifests as
embind's internal binding registry getting corrupted — newly-added
registrations write to the wrong place or get overwritten.

Other affected files in coot's `api/`:
- `molecules-container-maps.cc` (lines 167, 279)
- `molecules-container.cc` (lines 1460, 1547, 1581, 1615)
- `molecules-container-ligand-fitting.cc` (line 137)
- `validation-information.hh` (lines 33, 45)

None of them include `<emscripten.h>`.

## Fixes (in increasing order of upstream-correctness)

### 0. Workaround: do the work on the JS side
For features that need to mutate the molecule (like covalent-link
declaration), the work can be done by reading the model's mmCIF via
`molecule_to_mmCIF_string_with_gemmi` (works — pre-existing binding),
mutating the text in JS, and writing it back via
`replace_molecule_by_model_from_string` (also works). For pure-read
features (like a torsion angle), parse the mmCIF and compute in JS.

Pieces of this approach shipped 2026-06-07/08:

| Broken WASM binding | JS-side replacement | File |
|---|---|---|
| `make_covalent_link_using_cids` | `appendStructConnLoop` (struct_conn surgery, returns augmented mmCIF for refmac) | `baby-gru/src/utils/MoorhenCovalentLinkSurgery.ts` |
| `get_torsion` | `getTorsionFromMmcif` / `getTorsionJs` (parse 4 atom coords + cross-product dihedral) | `baby-gru/src/utils/MoorhenEmbindWorkarounds.ts` |
| `add_water_at_position` | `addWaterAtPositionJs` (append HETATM HOH row, auto-increments seqNum in solvent chain, falls back to chain "X" if no solvent chain exists) | `baby-gru/src/utils/MoorhenEmbindWorkarounds.ts` |

Verified end-to-end on 8FD9 in PyKekoDev:
- `get_torsion`: CYS A:481 χ1 (N-CA-CB-SG) = 62.4° (realistic)
- `add_water_at_position`: three sequential adds produced `/1/X/1`,
  `/1/X/2`, `/1/X/3`; atom count grew 4757 → 4760

**Still TODO** (medium-cost workarounds, not yet written):
- `set_phi_psi`: needs Rodrigues rotation matrix applied to specific
  atom sets in the model mmCIF (~3-4 hours)
- `get_ncs_ghost_matrix`: needs JS Kabsch/SVD superposition, or wrap
  an existing working coot `lsq_*` binding if one exists (~2-8 hours
  depending on which path)
- All four `make_covalent_link*` / `delete_covalent_link*` family —
  the `make_covalent_link_using_cids` path is covered by the
  struct_conn surgery; the others have no current caller.

### 1. Quick fix: force-define EMSCRIPTEN in CMakeLists.txt
Add `-DEMSCRIPTEN` to the build flags:
```cmake
add_compile_definitions(EMSCRIPTEN)
```
or via the existing C_DEFINES list. This would restore the 5.0.3 behavior
across all TUs.

**Tested 2026-06-08: did NOT fix the bug.** Added `-DEMSCRIPTEN` to
`CMAKE_CXX_FLAGS` via CMakeCache.txt, touched the suspect coot .cc files
to force recompile, rebuilt `~/Moorhen-dev/CCP4_WASM_BUILD`. Verified the
flag landed in `wasm_src/CMakeFiles/coot.dir/flags.make` and in
`wasm_src/CMakeFiles/moorhen.dir/flags.make`. The 4 PyKeko subclass
bindings (set_phi_psi, get_torsion, add_water_at_position,
get_ncs_ghost_matrix) and the 4 covalent-link bindings (make/delete×
plain/_using_cids) all still register as `undefined` while
flipPeptide_cid and side_chain_180 still register as `function`. So
the `validation_information_t` ODR-violation hypothesis is wrong — or
at least, fixing that one ODR site doesn't fix the bug.

The bug is deeper than the EMSCRIPTEN-macro change. Possibly there's
another ODR violation elsewhere in coot's headers, or the regression
is something other than the 5.0.4 macro change.

### 2. Proper fix: migrate coot to `__EMSCRIPTEN__`
Replace every `#ifdef EMSCRIPTEN` with `#ifdef __EMSCRIPTEN__` in coot's
sources. `__EMSCRIPTEN__` is a clang builtin, always defined under em++,
no header include required. This is what the emscripten changelog
explicitly recommends:

> `__EMSCRIPTEN__`, which is built into LLVM, should be used instead.

Touches ~10 files in `checkout/coot-1.0/api/` and `MoleculesToTriangles/`.
Could be a patch in `coot-patches/`, or a PR upstream to
`https://github.com/pemsley/coot`.

### 3. Header hygiene: have each affected coot .cc include <emscripten.h>
Less invasive than (2) but only fixes the affected files; future code
re-uses the same trap.

## Diagnostic state as of 2026-06-08

What we've ruled out (each tested against pristine upstream + cold-built
or relinked):

| Hypothesis | Test | Result |
|---|---|---|
| ODR violation from 5.0.4 EMSCRIPTEN macro change | `-DEMSCRIPTEN` injected into CMAKE_CXX_FLAGS, verified in coot.dir/flags.make, suspect .cc files recompiled | Refuted — bug persists |
| emscripten version regression (5.0.4-5.0.7 vs 5.0.3) | Installed emscripten 5.0.3, cold-built pristine | Refuted — bug present in 5.0.3 too |
| Static-init order across the link | Added pk_test_in_last_file binding in a brand-new pk_test_last.cc, placed LAST in the moorhen target's source list | Refuted — last-linked file's binding also undefined |
| wasm-opt post-process dropping registrations | Relinked at `-O0` (skips wasm-opt), WASM grew from 19MB to 23MB confirming wasm-opt didn't run | Refuted — bug persists |

What's left to investigate (in cost order):

- **Interaction with `-pthread` or `-fwasm-exceptions`** — both are in
  Moorhen's link flags. Try a link without each.
- **`--bind` flag behavior** — embind's `--bind` link arg might have
  changed behavior. Check the version-pinned binaryen behavior under
  it.
- **A specific cap or threshold inside embind's JS-side type registry**
  — when `_embind_register_class_function` is called, JS-side
  bookkeeping happens. Maybe an array index or counter wraps for
  large class registries. (Moorhen has 300+ bindings registered.)
  Could test by removing some existing bindings.

The pattern "8 of 312 source bindings silently fail, and they're
exactly the most-recently-added ones" suggests the bug is something
that DEPENDS on the binding REGISTERED INDEX rather than its source
position. That would happen if, e.g., embind's `__getTypeName` table
or a similar JS-side array overflows past a 256/512/1024 entry.

## TODOs

- [x] Verify the -DEMSCRIPTEN fix — refuted
- [x] Test against emscripten 5.0.3 — refuted
- [x] Test static-init order with a last-linked .cc — refuted
- [x] Test without wasm-opt (-O0 link) — refuted
- [ ] **Fix the PyKeko fork relationship** — `hilgersmt/Moorhen-PyKeko`
      currently isn't a proper GitHub fork of `moorhen-coot/Moorhen`.
      Convert it before filing the upstream issue.
- [ ] **File the upstream issue** at `moorhen-coot/Moorhen`. Min repro:
      single `function("pk_test_int_only", +[](int a, int b) { return
      a + b; });` in `wasm_src/moorhen-types-wrappers.cc`, cold build,
      observe `cootModule.pk_test_int_only === undefined` while
      `cootModule.validate === function`. Include the refuted-hypothesis
      table above so upstream knows what's already been tried.

## Diagnostic process (for future-me)

I ruled these hypotheses out before landing on the ODR theory:
- Cross-TU method-pointer linking — refuted by inlining
  `add_water_at_position` into `molecules-container.cc` directly
- `select_overload` signature mismatch — refuted by `probe_zzz_TOP`
  byte-identical to a working `flipPeptide_cid`
- Lambda vs named function — both fail equally
- atom_spec_t not bound — IS bound as value_object in
  `moorhen-types-wrappers.cc:448`
- Per-TU bug — pristine upstream reproduces in any TU
- Stale build cache — cold `rm -rf CCP4_WASM_BUILD; ./moorhen_build.sh moorhen`
  still reproduces
- PyKeko patches specifically — pristine `moorhen-coot/Moorhen` with no
  patches reproduces

The git-blame correlation ("only my commits fail") was actually consistent
with "only new bindings fail" — Stuart's bindings were old enough to have
been added before 5.0.4 changed the macro semantics, so their behavior is
grandfathered in.

## See also
- [`covalent-ligand-plan.md`](covalent-ligand-plan.md) §5 (the originally
  planned `make_covalent_link` WASM binding that this bug blocks)
- The auto-memory entry `feedback_moorhen_embind_silent_drop` (private)
- Emscripten changelog 5.0.4 entry, PR
  [emscripten-core/emscripten#26417](https://github.com/emscripten-core/emscripten/pull/26417)

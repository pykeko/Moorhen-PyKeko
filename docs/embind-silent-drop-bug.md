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

## Root cause hypothesis: emscripten 5.0.4 `EMSCRIPTEN` macro change → ODR violation

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
declaration), the bond can be expressed by injecting a `_struct_conn`
loop into the model's mmCIF as a post-export step. See
[`covalent-ligand-plan.md`](covalent-ligand-plan.md) and the
`MoorhenCovalentLinkSurgery.ts` helpers shipped at commit `77c8d490`.

This sidesteps the bug entirely — no new WASM binding needed.

### 1. Quick fix: force-define EMSCRIPTEN in CMakeLists.txt
Add `-DEMSCRIPTEN` to the build flags:
```cmake
add_compile_definitions(EMSCRIPTEN)
```
or via the existing C_DEFINES list. This restores the 5.0.3 behavior
across all TUs. Should make the bug disappear with no source changes.

**Verification (in progress 2026-06-08)**: rebuilding `~/Moorhen-dev`'s
CCP4_WASM_BUILD with `CMAKE_CXX_FLAGS+=-DEMSCRIPTEN`. If
`pk_test_int_only` (or any of the 8 PyKeko bindings) registers after
this rebuild, hypothesis confirmed.

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

## TODOs

- [ ] **Verify the -DEMSCRIPTEN fix** (in progress, build log at
      `/tmp/emscripten-fix-build.log`). Probe via the CDP harness:
      after the build lands, swap WASM into PyKekoDev, reload, check
      `typeof cootModule.pk_test_int_only` and `typeof
      molecules_container.set_phi_psi`.
- [ ] **Fix the PyKeko fork relationship** — `hilgersmt/Moorhen-PyKeko`
      currently isn't set up as a proper GitHub fork of
      `moorhen-coot/Moorhen`. Convert it so PRs / issues / fork-aware
      tooling work normally. Until then, filing an upstream issue from
      our user identity will look like an unaffiliated bug report.
- [ ] **File the upstream issue** at `moorhen-coot/Moorhen` (after the
      fork relationship is fixed). Min repro is above; include the
      ChangeLog citation + the validation_information.hh ODR example.
      Suggest fix #2 (migrate to `__EMSCRIPTEN__`).
- [ ] If upstream picks (2), unblock PyKeko's 4 silently-broken
      features in the next release.
- [ ] If `-DEMSCRIPTEN` fixes it cleanly, consider shipping that as a
      patch in `coot-patches/` or as a tweak to `wasm_src/CMakeLists.txt`
      (a 1-line change). That avoids waiting on upstream.

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

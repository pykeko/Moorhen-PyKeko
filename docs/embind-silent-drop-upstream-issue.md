# Upstream issue body — embind silent-drop

Ready-to-paste body for an issue to be filed at
[`moorhen-coot/Moorhen`](https://github.com/moorhen-coot/Moorhen/issues).
Goes alongside [`embind-silent-drop-bug.md`](embind-silent-drop-bug.md),
which has the full local diagnostic write-up.

To file via the CLI once the PyKeko fork relationship is sorted:

```bash
gh issue create \
  --repo moorhen-coot/Moorhen \
  --title "embind: newly-added function bindings silently fail to register" \
  --body-file docs/embind-silent-drop-upstream-issue.md
```

Or paste the body below into the GitHub web UI.

---

## Symptom

Any newly-added `.function()` line in `wasm_src/moorhen-wrappers.cc` or `wasm_src/moorhen-types-wrappers.cc` silently fails to register at runtime. The binding name string is in the compiled WASM data section, and the code references to `_embind_register_*` are present in `.o` files, but the registration doesn't fire at WASM init. Pre-existing bindings (`validate`, `flipPeptide_cid`, `side_chain_180`, etc.) work fine.

`cootModule.<newName>` is `undefined` at runtime; the broken bindings throw `TypeError: Cannot read properties of undefined (reading 'apply')` when called from the JS dispatcher.

## Minimum repro

```bash
git clone https://github.com/moorhen-coot/Moorhen.git
cd Moorhen

# Add ONE binding to moorhen-types-wrappers.cc, immediately before
# `function("validate", &validate);`:
#    function("pk_test_int_only", +[](int a, int b) { return a + b; });

./get_sources
./moorhen_build.sh moorhen
```

In the running app:

```js
typeof cootModule.pk_test_int_only  // "undefined"  ← bug
typeof cootModule.validate          // "function"   ← works
strings moorhen.wasm | grep pk_test_int_only  // present in WASM
```

I observed this in PyKeko (a fork that's been actively adding bindings — `set_phi_psi`, `get_torsion`, `add_water_at_position`, `get_ncs_ghost_matrix`, plus a covalent-link family). All four shipped features had been silent no-ops in production; the JS-side `try/catch` blocks at the call sites swallowed the `TypeError` so the UI looked like it worked but nothing changed.

## Hypotheses we ruled out

| Hypothesis | Test result |
|---|---|
| Recent emscripten regression | Refuted — reproduces in 5.0.3 (the version your README cites as known-good) AND 5.0.7 |
| The 5.0.4 `EMSCRIPTEN` macro change → ODR violation | Refuted — adding `-DEMSCRIPTEN` to `CMAKE_CXX_FLAGS` (so the macro stays globally defined as it was pre-5.0.4) doesn't fix it |
| Stale build cache | Refuted — `rm -rf CCP4_WASM_BUILD; ./moorhen_build.sh moorhen` from scratch still reproduces |
| Static-init order across the link | Refuted — added the test binding in a new `pk_test_last.cc` placed last in the moorhen-target source list; still undefined while previously-existing bindings work |
| `wasm-opt` post-process dropping registrations | Refuted — relinked at `-O0` (skips wasm-opt; binary grew 19MB → 23MB confirming), bug persists |
| Cross-TU method-pointer linking for patched .cc files | Refuted — inlined the patched function bodies into upstream `api/molecules-container.cc`, no help |
| `select_overload<>` ambiguity | Refuted — `probe_zzz_TOP` byte-identical to the working `flipPeptide_cid` on the adjacent line also silently fails |

## What I think remains to investigate

- Interaction with `-pthread` / `-fwasm-exceptions` / `--bind` link flags (didn't probe individually)
- JS-side embind type-registry state at high binding counts — Moorhen has 300+ class methods registered; might overflow some internal index. Worth testing whether removing N old bindings frees up the new one.
- Something in cmake's `add_executable(moorhen ...)` source ordering or `libcoot.a` build that's been quietly broken since the codebase grew past some threshold

## Workaround (for forks affected today)

We're routing the affected paths through pre-existing working bindings (`molecule_to_mmCIF_string_with_gemmi`, `replace_molecule_by_model_from_string`) in JS. Pure-JS replacements for the four broken member-function bindings (Rodrigues rotation for `set_phi_psi`, Kabsch superposition for `get_ncs_ghost_matrix`, etc.) live in [`baby-gru/src/utils/MoorhenEmbindWorkarounds.ts`](https://github.com/pykeko/Moorhen-PyKeko/blob/main/baby-gru/src/utils/MoorhenEmbindWorkarounds.ts) on our fork.

## Full diagnostic write-up

The detailed write-up — including which `.o` files we inspected, what `wasm-dis` output showed for the data-section string offsets vs the code references, and the deduction order — lives at [`docs/embind-silent-drop-bug.md`](https://github.com/pykeko/Moorhen-PyKeko/blob/main/docs/embind-silent-drop-bug.md) on our fork. Happy to fold it into this thread if you'd find it more discoverable here.

## Environment

- macOS 15.5 (Tahoe), arm64
- emscripten 5.0.3 (REPRODUCES) and 5.0.7 (REPRODUCES)
- Moorhen `main` as of 2026-06-07
- Build via `./get_sources && ./moorhen_build.sh moorhen`

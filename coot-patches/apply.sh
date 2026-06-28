#!/bin/bash
# Apply PyKeko coot patches to the coot-1.0 checkout.
# Run after `./moorhen_build.sh` has cloned coot but before building moorhen target.
#
# Current patch set:
#   - NCS ghosts (molecules-container-ncs-ghost.cc)
#   - Single-water-at-position (molecules-container-add-water-at-position.cc)
#   - Phi/psi setter (molecules-container-set-phi-psi.cc)
#   - Colour-rule CID-selector fix on bond reps (v0.2.18 — coot-molecule-bonds-userdef-color-cid-fix.patch)
#   - make_covalent_link / delete_covalent_link (molecules-container-make-covalent-link.cc)

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COOT_DIR="$(dirname "$SCRIPT_DIR")/checkout/coot-1.0"

if [ ! -d "$COOT_DIR" ]; then
    echo "Error: coot-1.0 not found at $COOT_DIR"
    echo "Run ./moorhen_build.sh first (it will clone coot, then fail)"
    exit 1
fi

# Copy the new .cc files
cp "$SCRIPT_DIR/molecules-container-ncs-ghost.cc" "$COOT_DIR/api/"
cp "$SCRIPT_DIR/molecules-container-add-water-at-position.cc" "$COOT_DIR/api/"
cp "$SCRIPT_DIR/molecules-container-set-phi-psi.cc" "$COOT_DIR/api/"
cp "$SCRIPT_DIR/molecules-container-make-covalent-link.cc" "$COOT_DIR/api/"

# Apply the header patch (declares get_ncs_ghost_matrix + add_water_at_position)
cd "$COOT_DIR"
if ! grep -q "get_ncs_ghost_matrix" api/molecules-container.hh; then
    git apply "$SCRIPT_DIR/molecules-container.hh.patch"
fi

# Declare set_phi_psi just after add_water_at_position. Done by in-place insertion
# (not a git diff) so it's robust to upstream line drift in molecules-container.hh.
if ! grep -q "set_phi_psi" api/molecules-container.hh; then
    perl -i -pe 's/(std::string add_water_at_position\(int imol, float x, float y, float z\);)/$1\n   int set_phi_psi(int imol, const std::string \&residue_cid, double phi, double psi);/' api/molecules-container.hh
    grep -q "set_phi_psi" api/molecules-container.hh || { echo "ERROR: failed to insert set_phi_psi decl"; exit 1; }
fi

# Apply the userdef-colour CID-selector fix (v0.2.18 → v0.3.1) on coot-molecule-bonds.cc.
# Marker grep is permissive ("PyKeko patch") so both the v0.2.18 whole-chain
# variant and the v0.3.1 generalised CID-matcher variant are detected.
if ! grep -q "PyKeko patch" api/coot-molecule-bonds.cc; then
    patch -p1 --no-backup-if-mismatch < "$SCRIPT_DIR/coot-molecule-bonds-userdef-color-cid-fix.patch" || exit 1
fi

# Declare make_covalent_link + delete_covalent_link on coot::molecule_t
# (just after delete_atom in api/coot-molecule.hh)
if ! grep -q "make_covalent_link" api/coot-molecule.hh; then
    perl -i -pe 's/(int delete_atom\(atom_spec_t &atom_spec\);)/$1\n      int make_covalent_link(const coot::atom_spec_t \&spec_1, const coot::atom_spec_t \&spec_2, const std::string \&link_name, float length, const coot::protein_geometry \&geom);\n      int delete_covalent_link(const coot::atom_spec_t \&spec_1, const coot::atom_spec_t \&spec_2);/' api/coot-molecule.hh
    grep -q "make_covalent_link" api/coot-molecule.hh || { echo "ERROR: failed to insert make_covalent_link decl on coot::molecule_t"; exit 1; }
fi

# Declare make_covalent_link* + delete_covalent_link* on molecules_container_t
# (just after set_phi_psi in api/molecules-container.hh)
if ! grep -q "make_covalent_link" api/molecules-container.hh; then
    perl -i -pe 's/(int set_phi_psi\(int imol, const std::string \&residue_cid, double phi, double psi\);)/$1\n   int make_covalent_link(int imol, const coot::atom_spec_t \&spec_1, const coot::atom_spec_t \&spec_2, const std::string \&link_name);\n   int make_covalent_link_using_cids(int imol, const std::string \&atom_cid_1, const std::string \&atom_cid_2, const std::string \&link_name);\n   int delete_covalent_link(int imol, const coot::atom_spec_t \&spec_1, const coot::atom_spec_t \&spec_2);\n   int delete_covalent_link_using_cids(int imol, const std::string \&atom_cid_1, const std::string \&atom_cid_2);/' api/molecules-container.hh
    grep -q "make_covalent_link" api/molecules-container.hh || { echo "ERROR: failed to insert make_covalent_link decls on molecules_container_t"; exit 1; }
fi

# Add nanobind bindings for the 4 new entry points just after the
# flip_peptide_using_cid binding in molecules-container-nanobind.cc
if ! grep -q "make_covalent_link" api/molecules-container-nanobind.cc; then
    perl -0777 -i -pe 's/(\.def\("flip_peptide_using_cid",\s*\n\s+nb::overload_cast<int, const std::string&, const std::string&>\(\&molecules_container_t::flip_peptide_using_cid\),\s*\n\s+get_docstring_from_xml\("flip_peptide_using_cid"\)\.c_str\(\)\))/$1\n    .def("make_covalent_link",\n         &molecules_container_t::make_covalent_link,\n         nb::arg("imol"), nb::arg("spec_1"), nb::arg("spec_2"), nb::arg("link_name"))\n    .def("make_covalent_link_using_cids",\n         &molecules_container_t::make_covalent_link_using_cids,\n         nb::arg("imol"), nb::arg("atom_cid_1"), nb::arg("atom_cid_2"), nb::arg("link_name"))\n    .def("delete_covalent_link",\n         \&molecules_container_t::delete_covalent_link,\n         nb::arg("imol"), nb::arg("spec_1"), nb::arg("spec_2"))\n    .def("delete_covalent_link_using_cids",\n         \&molecules_container_t::delete_covalent_link_using_cids,\n         nb::arg("imol"), nb::arg("atom_cid_1"), nb::arg("atom_cid_2"))/sm' api/molecules-container-nanobind.cc
    grep -q "make_covalent_link" api/molecules-container-nanobind.cc || { echo "ERROR: failed to insert nanobind bindings for make_covalent_link"; exit 1; }
fi

# Wire the new .cc into the WASM build's source list at
# ~/Moorhen-dev/wasm_src/CMakeLists.txt — append a new line right after
# molecules-container-set-phi-psi.cc. (The Moorhen WASM build doesn't use
# coot-1.0's api/Makefile.am or api/CMakeLists.txt — wasm_src/CMakeLists.txt
# explicitly enumerates every .cc in libcoot_api.)
MOORHEN_DEV_DIR="$(dirname "$SCRIPT_DIR")"
WASM_CMAKE="$MOORHEN_DEV_DIR/wasm_src/CMakeLists.txt"
if [ -f "$WASM_CMAKE" ] && ! grep -q "molecules-container-make-covalent-link.cc" "$WASM_CMAKE"; then
    perl -i -pe 's{(\$\{coot_src\}/api/molecules-container-set-phi-psi\.cc)}{$1\n\$\{coot_src\}/api/molecules-container-make-covalent-link.cc}' "$WASM_CMAKE"
    grep -q "molecules-container-make-covalent-link.cc" "$WASM_CMAKE" || { echo "ERROR: failed to add make-covalent-link.cc to wasm_src/CMakeLists.txt"; exit 1; }
    echo "  added molecules-container-make-covalent-link.cc to wasm_src/CMakeLists.txt"
fi

# add-linked-cho.cc provides coot::cho::make_link which our new wrapper calls.
# The upstream wasm_src/CMakeLists.txt doesn't include it (the add-linked-cho
# functionality is only used from the legacy desktop glycan workflow, which
# isn't compiled into the WASM). Add it so the linker can resolve our call.
if [ -f "$WASM_CMAKE" ] && ! grep -q "ideal/add-linked-cho.cc" "$WASM_CMAKE"; then
    perl -i -pe 's{(\$\{coot_src\}/ideal/pepflip\.cc)}{$1\n\$\{coot_src\}/ideal/add-linked-cho.cc}' "$WASM_CMAKE"
    grep -q "ideal/add-linked-cho.cc" "$WASM_CMAKE" || { echo "ERROR: failed to add add-linked-cho.cc to wasm_src/CMakeLists.txt"; exit 1; }
    echo "  added ideal/add-linked-cho.cc to wasm_src/CMakeLists.txt"
fi

# moorhen-wrappers.cc embind bindings (the actual JS-facing API surface).
# This file is part of the Moorhen repo proper (not the coot-1.0 checkout),
# so we don't need a patch — the edits live committed in wasm_src/moorhen-wrappers.cc
# directly. apply.sh just sanity-checks that the binding registrations are present.
if ! grep -q "make_covalent_link" "$MOORHEN_DEV_DIR/wasm_src/moorhen-wrappers.cc"; then
    echo "ERROR: wasm_src/moorhen-wrappers.cc is missing make_covalent_link embind registrations."
    echo "       Check the file is in sync with the canonical version in ~/Moorhen/wasm_src/."
    exit 1
fi

# Commit so the build script's version check passes. We commit ON the checked-out
# main branch, which advances main to this commit directly — no `git branch -f`
# needed (and it would fail anyway: git refuses to force-update a branch that's
# checked out in a worktree).
git add api/
git -c user.email="build@local" -c user.name="Build" commit -m "Apply PyKeko coot patches (NCS ghost, single-water, set_phi_psi, colour-CID-fix, make_covalent_link)" --allow-empty > /dev/null
NEW_HASH=$(git rev-parse --short=10 HEAD)

# Update VERSIONS to match
cd "$(dirname "$SCRIPT_DIR")"
sed -i.bak "s/coot_commit=\".*\"/coot_commit=\"$NEW_HASH\"/" VERSIONS
rm -f VERSIONS.bak

echo "Patches applied. coot_commit pinned to $NEW_HASH"

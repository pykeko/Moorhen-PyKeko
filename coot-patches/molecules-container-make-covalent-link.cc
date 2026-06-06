// PyKeko covalent-ligand workflow — make_covalent_link / delete_covalent_link
//
// Wraps the existing coot::cho::make_link (ideal/add-linked-cho.cc:510) as a
// coot::molecule_t method + exposes it on molecules_container_t with both
// atom_spec and CID-string entry points.
//
// `coot::cho::make_link` already implements the full mmdb::Link allocation +
// chem_mod application (delete leaving atoms per the loaded link dictionary's
// `_chem_mod_atom function=delete` rows). We add:
//   * a backup-aware wrapper on coot::molecule_t (sets have_unsaved_changes)
//   * a delete-by-atom-pair lookup that walks model_p->GetLink(i)
//   * molecules_container_t entry points using the container-owned `geom`
//
// Companion header declarations are added by apply.sh via perl-insertion
// (not a .patch file) so they survive upstream line drift.
//
// Refinement integration: once the link is in mmdb's link container AND a
// matching CCP4-ML link dictionary has been imported via
// import_cif_dictionary(), `refine_residues_using_atom_cid` picks it up
// automatically — `make_link_restraints_from_links` in ideal/link-restraints.cc
// walks `mol->GetModel(1)->GetLink(i)` directly. No additional refinement-API
// code needed. See Plan-doc §1.7 + ~/Moorhen/docs/refs/yamashita-2023-gemmi-servalcat.pdf
// for the modern Servalcat / refmacat refinement frontend that also auto-perceives
// these from _struct_conn.

#include "molecules-container.hh"
#include "ideal/add-linked-cho.hh"
#include "coot-utils/coot-coord-utils.hh"
#include <mmdb2/mmdb_manager.h>


// =====================================================================
// coot::molecule_t::make_covalent_link
//
// Adds an mmdb::Link record between spec_1 and spec_2 and applies any
// chem_mod operations defined by the dictionary entry that matches the
// resulting (comp_id_1, group_1, comp_id_2, group_2) tuple in `geom`.
//
// `link_name` is currently informational only — mmdb::Link doesn't store
// an ID field. Refmac matches links by (resname, group, atom-name) lookup,
// not by name. Kept on the signature for symmetry with desktop Coot's
// make_link_py.
//
// `length` (target bond distance) is similarly informational at the
// `make_link` stage — the actual restraint comes from the link CIF's
// `_chem_link_bond.value_dist`. Kept for the same symmetry reason.
//
// Returns 1 on success (atoms found + link recorded), 0 on failure.
// =====================================================================
int
coot::molecule_t::make_covalent_link(const coot::atom_spec_t &spec_1,
                                     const coot::atom_spec_t &spec_2,
                                     const std::string &link_name,
                                     float length,
                                     const coot::protein_geometry &geom) {
   if (! atom_sel.mol) return 0;
   if (! coot::util::get_atom(spec_1, atom_sel.mol)) return 0;
   if (! coot::util::get_atom(spec_2, atom_sel.mol)) return 0;
   make_backup("make_covalent_link");
   coot::cho::make_link(atom_sel.mol, spec_1, spec_2, link_name, length, geom);
   have_unsaved_changes_flag = 1;
   return 1;
}


// =====================================================================
// coot::molecule_t::delete_covalent_link
//
// Removes the mmdb::Link record between spec_1 and spec_2 if present.
// Walks model_p->GetLink(i) and matches by chain id + seqNum + atom name
// in either direction (link could have been stored A→B or B→A).
//
// Returns 1 if a matching link was found and removed; 0 otherwise.
//
// Note: this does NOT reverse the chem_mod atom deletions from
// make_covalent_link — those are permanent model edits. If the user wants
// to "undo" a covalent link they should use the molecule-level undo
// (which restores from the backup made before make_covalent_link).
// =====================================================================
int
coot::molecule_t::delete_covalent_link(const coot::atom_spec_t &spec_1,
                                       const coot::atom_spec_t &spec_2) {
   if (! atom_sel.mol) return 0;
   mmdb::Atom *at_1 = coot::util::get_atom(spec_1, atom_sel.mol);
   mmdb::Atom *at_2 = coot::util::get_atom(spec_2, atom_sel.mol);
   if (! at_1 || ! at_2) return 0;
   mmdb::Model *model_p = at_1->GetModel();
   if (model_p != at_2->GetModel()) return 0;

   auto match = [](mmdb::Link *l, mmdb::Atom *a, mmdb::Atom *b) -> bool {
      return std::string(l->atName1)  == std::string(a->GetAtomName())
          && l->seqNum1                == a->GetSeqNum()
          && std::string(l->chainID1) == std::string(a->GetChainID())
          && std::string(l->atName2)  == std::string(b->GetAtomName())
          && l->seqNum2                == b->GetSeqNum()
          && std::string(l->chainID2) == std::string(b->GetChainID());
   };

   int n_links = model_p->GetNumberOfLinks();
   for (int ilink = 1; ilink <= n_links; ++ilink) {
      mmdb::Link *link_p = model_p->GetLink(ilink);
      if (! link_p) continue;
      if (match(link_p, at_1, at_2) || match(link_p, at_2, at_1)) {
         make_backup("delete_covalent_link");
         delete_link(link_p, model_p);
         have_unsaved_changes_flag = 1;
         atom_sel.mol->FinishStructEdit();
         return 1;
      }
   }
   return 0;
}


// =====================================================================
// molecules_container_t entry points
// =====================================================================

int
molecules_container_t::make_covalent_link(int imol,
                                          const coot::atom_spec_t &spec_1,
                                          const coot::atom_spec_t &spec_2,
                                          const std::string &link_name) {
   if (! is_valid_model_molecule(imol)) return 0;
   return molecules[imol].make_covalent_link(spec_1, spec_2, link_name, 1.0f, geom);
}

int
molecules_container_t::make_covalent_link_using_cids(int imol,
                                                     const std::string &atom_cid_1,
                                                     const std::string &atom_cid_2,
                                                     const std::string &link_name) {
   if (! is_valid_model_molecule(imol)) return 0;
   coot::atom_spec_t spec_1 = atom_cid_to_atom_spec(imol, atom_cid_1);
   coot::atom_spec_t spec_2 = atom_cid_to_atom_spec(imol, atom_cid_2);
   if (spec_1.empty() || spec_2.empty()) return 0;
   return molecules[imol].make_covalent_link(spec_1, spec_2, link_name, 1.0f, geom);
}

int
molecules_container_t::delete_covalent_link(int imol,
                                            const coot::atom_spec_t &spec_1,
                                            const coot::atom_spec_t &spec_2) {
   if (! is_valid_model_molecule(imol)) return 0;
   return molecules[imol].delete_covalent_link(spec_1, spec_2);
}

int
molecules_container_t::delete_covalent_link_using_cids(int imol,
                                                       const std::string &atom_cid_1,
                                                       const std::string &atom_cid_2) {
   if (! is_valid_model_molecule(imol)) return 0;
   coot::atom_spec_t spec_1 = atom_cid_to_atom_spec(imol, atom_cid_1);
   coot::atom_spec_t spec_2 = atom_cid_to_atom_spec(imol, atom_cid_2);
   if (spec_1.empty() || spec_2.empty()) return 0;
   return molecules[imol].delete_covalent_link(spec_1, spec_2);
}

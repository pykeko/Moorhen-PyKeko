// PyKeko v0.3.2 — shared Moorhen-shorthand CID matcher.
//
// mmdb's Select() mis-parses Moorhen-shorthand CIDs ("//A", "//A/911",
// "//A/911/CA", "//A/*/CA+CB+CG", "//A/911/*||//B/908/*", …). v0.2.18
// patched the whole-chain case in coot-molecule-bonds.cc; v0.3.1
// generalised to all CID shapes in the same file; v0.3.2 shares the
// matcher between coot-molecule-bonds.cc and CompoundSelection.cpp
// (the M2T surface-renderer path).
//
// This header defines a self-contained function `pykeko_select_atoms(mol, cid)`
// that returns a vector of mmdb::Atom* matching the CID. Callers apply
// their own per-atom action (colour rule application, surface bitmask,
// etc.). Handles:
//   - compound "||"-joined CIDs (split and union)
//   - "*" wildcard at any of {model, chain, res, atom}
//   - residue-range specs: "911", "911-915", "911+920", "100-200+205-210"
//   - atom-name lists: "CA", "CA+CB+CG"
//   - optional ":<altloc>" suffix

#ifndef PYKEKO_CID_MATCHER_HH
#define PYKEKO_CID_MATCHER_HH

#include <string>
#include <vector>
#include <set>
#include <utility>
#include <cstdlib>

#include <mmdb2/mmdb_manager.h>

namespace pykeko {

namespace detail {

inline std::vector<std::string> split(const std::string &s, char sep) {
    std::vector<std::string> out;
    std::string cur;
    for (char c : s) { if (c == sep) { out.push_back(cur); cur.clear(); } else cur += c; }
    out.push_back(cur);
    return out;
}

inline std::vector<std::string> split_pipe(const std::string &s) {
    std::vector<std::string> out;
    std::string cur;
    for (size_t i = 0; i < s.size(); ) {
        if (i + 1 < s.size() && s[i] == '|' && s[i + 1] == '|') {
            out.push_back(cur); cur.clear(); i += 2;
        } else { cur += s[i]; i++; }
    }
    out.push_back(cur);
    return out;
}

inline std::string trim(std::string s) {
    while (!s.empty() && (s.front() == ' ' || s.front() == '\t')) s.erase(0, 1);
    while (!s.empty() && (s.back()  == ' ' || s.back()  == '\t')) s.pop_back();
    return s;
}

inline std::vector<std::pair<int,int>> parse_res(const std::string &spec) {
    std::vector<std::pair<int,int>> out;
    if (spec.empty() || spec == "*") return out;
    for (const auto &chunk : split(spec, '+')) {
        if (chunk.empty() || chunk == "*") return {};
        size_t dash = chunk.find('-', chunk[0] == '-' ? 1 : 0);
        int lo, hi;
        if (dash == std::string::npos) {
            lo = hi = std::atoi(chunk.c_str());
        } else {
            lo = std::atoi(chunk.substr(0, dash).c_str());
            hi = std::atoi(chunk.substr(dash + 1).c_str());
            if (hi < lo) std::swap(lo, hi);
        }
        out.push_back({lo, hi});
    }
    return out;
}

inline std::set<std::string> parse_atom(const std::string &spec) {
    std::set<std::string> out;
    if (spec.empty() || spec == "*") return out;
    for (const auto &chunk : split(spec, '+')) {
        if (chunk.empty() || chunk == "*") return {};
        out.insert(chunk);
    }
    return out;
}

struct MatchSpec {
    bool any_model;
    int model_no;
    bool any_chain;
    std::string chain;
    std::vector<std::pair<int,int>> res_ranges;
    std::set<std::string> atom_names;
    bool any_altloc;
    std::string altloc;
};

inline MatchSpec parse_one(const std::string &raw) {
    MatchSpec ms;
    ms.any_model = true; ms.model_no = 0;
    ms.any_chain = true;
    ms.any_altloc = true;
    std::string main_cid = raw;
    size_t colon = raw.find(':');
    if (colon != std::string::npos) {
        main_cid = raw.substr(0, colon);
        std::string al = trim(raw.substr(colon + 1));
        if (!al.empty() && al != "*") { ms.any_altloc = false; ms.altloc = al; }
    }
    auto toks = split(main_cid, '/');
    while (toks.size() < 5) toks.push_back("*");
    const std::string &model_tok = toks[1];
    const std::string &chain_tok = toks[2];
    const std::string &res_tok   = toks[3];
    const std::string &atom_tok  = toks[4];
    if (!model_tok.empty() && model_tok != "*") {
        ms.any_model = false;
        ms.model_no = std::atoi(model_tok.c_str());
    }
    if (!chain_tok.empty() && chain_tok != "*") {
        ms.any_chain = false;
        ms.chain = chain_tok;
    }
    ms.res_ranges = parse_res(res_tok);
    ms.atom_names = parse_atom(atom_tok);
    return ms;
}

inline bool matches(mmdb::Atom *at, int model_no_atom, const std::vector<MatchSpec> &specs) {
    if (!at) return false;
    std::string atom_name = trim(at->name ? at->name : "");
    const char *chain_cstr = at->GetChainID();
    std::string chain_id = chain_cstr ? chain_cstr : "";
    int res_no = at->GetSeqNum();
    std::string altloc = at->altLoc ? at->altLoc : "";
    for (const auto &ms : specs) {
        if (!ms.any_model && ms.model_no != 0 && ms.model_no != model_no_atom) continue;
        if (!ms.any_chain && ms.chain != chain_id) continue;
        if (!ms.res_ranges.empty()) {
            bool hit = false;
            for (const auto &r : ms.res_ranges)
                if (res_no >= r.first && res_no <= r.second) { hit = true; break; }
            if (!hit) continue;
        }
        if (!ms.atom_names.empty() && ms.atom_names.count(atom_name) == 0) continue;
        if (!ms.any_altloc && ms.altloc != altloc) continue;
        return true;
    }
    return false;
}

} // namespace detail

// Return every atom in `mol` matching the (possibly compound) Moorhen-shorthand
// CID. Returns an empty vector for empty CIDs or invalid input.
inline std::vector<mmdb::Atom*> select_atoms(mmdb::Manager *mol, const std::string &cid) {
    std::vector<mmdb::Atom*> out;
    if (!mol || cid.empty()) return out;
    std::vector<detail::MatchSpec> specs;
    for (const auto &sub : detail::split_pipe(cid)) {
        std::string t = detail::trim(sub);
        if (!t.empty()) specs.push_back(detail::parse_one(t));
    }
    if (specs.empty()) return out;
    for (int imod = 1; imod <= mol->GetNumberOfModels(); ++imod) {
        mmdb::Model *mdl = mol->GetModel(imod);
        if (!mdl) continue;
        int nc = mdl->GetNumberOfChains();
        for (int ic = 0; ic < nc; ++ic) {
            mmdb::Chain *ch = mdl->GetChain(ic);
            if (!ch) continue;
            int nr = ch->GetNumberOfResidues();
            for (int ir = 0; ir < nr; ++ir) {
                mmdb::Residue *r = ch->GetResidue(ir);
                if (!r) continue;
                int na = r->GetNumberOfAtoms();
                for (int ia = 0; ia < na; ++ia) {
                    mmdb::Atom *at = r->GetAtom(ia);
                    if (at && detail::matches(at, imod, specs)) out.push_back(at);
                }
            }
        }
    }
    return out;
}

// Populate an mmdb selection handle with the matched atoms. Caller retains
// ownership of the handle (must call mmdb->DeleteSelection(handle) later).
// Used to plug the matcher into upstream call sites that already have a
// selection handle and expect the atoms to be reachable via GetSelIndex.
inline void populate_selection(mmdb::Manager *mol, int selHnd, const std::string &cid) {
    if (!mol || selHnd < 0) return;
    auto atoms = select_atoms(mol, cid);
    for (mmdb::Atom *at : atoms) {
        mol->SelectAtom(selHnd, at, mmdb::SKEY_OR, false);
    }
    // Materialise the selection so subsequent GetSelIndex sees it.
    mol->MakeSelIndex(selHnd);
}

} // namespace pykeko

#endif // PYKEKO_CID_MATCHER_HH

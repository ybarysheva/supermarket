#!/usr/bin/env python3
"""Pull DOB NOW records for NYC center-based child care and summarize them.

Steps
  1. Download Active NYC Health Code Regulated Child Care Programs (gy3q-4tzp)
     and build the list of BINs.
  2. Pull DOB NOW: Build - Job Application Filings (w9ak-ipjd) and
     DOB NOW: Certificate of Occupancy (pkdm-hqz6) for those BINs, in batches
     that keep each request URL short.
  3. Separately pull w9ak-ipjd filings whose job_description mentions child
     care terms (day care, child care, preschool, pre-K, nursery school,
     early childhood).
  4. Save everything as CSVs next to this script (or --out DIR).
  5. Write summary tables and childcare_dob_summary.md.

Before any query, each dataset's column list is read from the Socrata
metadata endpoint, saved to dataset_columns.csv, and the fields this script
needs are resolved against it. If a required field is missing the script
stops and prints the columns it found.

Usage
  pip install pandas requests
  python3 childcare_dob_pull.py            # optional: SODA_APP_TOKEN=... for higher rate limits
"""

import argparse
import os
import re
import sys
import time
from datetime import datetime
from urllib.parse import urlencode

import pandas as pd
import requests

DOMAIN = "https://data.cityofnewyork.us"
CHILDCARE = "gy3q-4tzp"
FILINGS = "w9ak-ipjd"
COS = "pkdm-hqz6"

PAGE = 50000
MAX_URL = 1800  # characters, including the domain and all parameters

# DOB uses these BINs for lots with no assigned building; they match
# thousands of unrelated filings, so they are left out of the BIN list.
PLACEHOLDER_BINS = {"0", "1000000", "2000000", "3000000", "4000000", "5000000"}

# A BIN is flagged as a large building when it has many separate jobs or
# many stories. Filings there are mostly not the child care program's.
LARGE_JOBS = 20
LARGE_STORIES = 6

# Server-side LIKE patterns (broad) followed by a local regex (precise),
# so that e.g. "PRE K" cannot match "PRE KITCHEN".
LIKE_TERMS = [
    "DAY CARE", "DAYCARE", "DAY-CARE", "CHILD CARE", "CHILDCARE", "CHILD-CARE",
    "PRESCHOOL", "PRE-SCHOOL", "PRE SCHOOL", "PRE-K", "PRE K", "PREK",
    "UPK", "NURSERY SCHOOL", "EARLY CHILDHOOD",
]
TERM_REGEX = {
    "day care": r"\bDAY[\s-]?CARE\b",
    "child care": r"\bCHILD[\s-]?CARE\b",
    "preschool": r"\bPRE[\s-]?SCHOOL",
    "pre-K": r"\bPRE[\s-]?K\b|\bPRE[\s-]?KINDERGARTEN|\bUPK\b",
    "nursery school": r"\bNURSERY\s+SCHOOLS?\b",
    "early childhood": r"\bEARLY\s+CHILDHOOD\b",
}

# Fields this script uses, as candidate names in order of preference.
FIELDS = {
    CHILDCARE: {
        "bin": ["bin", "building_identification_number", "buildingidentificationnumber"],
        "name": ["centername", "center_name", "legalname", "legal_name"],
        "program_type": ["programtype", "program_type", "childcaretype", "facilitytype"],
    },
    FILINGS: {
        "bin": ["bin", "bin_"],
        "job_filing_number": ["job_filing_number", "job_filing_no", "jobfilingnumber"],
        "job_type": ["job_type", "jobtype"],
        "job_description": ["job_description", "jobdescription"],
        "filing_date": ["filing_date", "filingdate"],
        "approved_date": ["approved_date", "approveddate", "approval_date"],
        "first_permit_date": ["first_permit_date", "firstpermitdate", "permit_issue_date"],
        "current_status_date": ["current_status_date", "currentstatusdate"],
        "filing_status": ["filing_status", "filingstatus", "current_status"],
        "work_type": ["work_type", "worktype"],
        "existing_stories": ["existing_stories", "existing_no_of_stories", "existingstories"],
        "borough": ["borough"],
    },
    COS: {
        "bin": ["bin", "bin_"],
        "job_number": ["job_filing_name", "job_number", "job_filing_number", "jobnumber"],
        "co_date": ["c_of_o_issuance_date", "c_o_issue_date", "co_issue_date", "issuance_date",
                    "c_of_o_issue_date"],
        "co_type": ["c_of_o_filing_type", "filing_type", "co_type", "c_of_o_type"],
        "co_status": ["c_of_o_status", "co_status", "status"],
    },
}
REQUIRED = {
    CHILDCARE: ["bin"],
    FILINGS: ["bin", "job_filing_number", "job_type", "job_description", "filing_date"],
    COS: ["bin", "job_number", "co_date"],
}

NEGATIVE_STATUS = r"WITHDRAW|DISAPPROV|TERMINAT|REJECT|CANCEL|VOID|DENIED"
SIGNED_OFF_STATUS = r"SIGN[\s-]*OFF|SIGNED[\s-]*OFF|LOC ISSUED|LETTER OF COMPLETION|C OF O|CO ISSUED|COMPLETED"


# ---------------------------------------------------------------- SODA access

class Soda:
    def __init__(self, token=None):
        self.s = requests.Session()
        if token:
            self.s.headers["X-App-Token"] = token

    def _get(self, url):
        for attempt in range(6):
            r = self.s.get(url, timeout=180)
            if r.status_code in (429, 500, 502, 503, 504):
                time.sleep(2 ** attempt)
                continue
            r.raise_for_status()
            return r.json()
        r.raise_for_status()

    def columns(self, ds):
        """[(fieldName, dataTypeName, name)] from the dataset metadata."""
        meta = self._get(f"{DOMAIN}/api/views/{ds}.json")
        return [(c["fieldName"], c.get("dataTypeName", ""), c.get("name", ""))
                for c in meta.get("columns", []) if not c["fieldName"].startswith(":")]

    def url(self, ds, params):
        return f"{DOMAIN}/resource/{ds}.json?{urlencode(params)}"

    def query(self, ds, params):
        """All rows matching params, paged."""
        rows, offset = [], 0
        while True:
            page = self._get(self.url(ds, {**params, "$limit": PAGE, "$offset": offset,
                                           "$order": ":id"}))
            rows += page
            if len(page) < PAGE:
                return rows
            offset += PAGE


def resolve(ds, cols):
    """Map this script's field names to the dataset's actual columns."""
    names = [c[0] for c in cols]
    found = {}
    for key, cands in FIELDS[ds].items():
        hit = next((c for c in cands if c in names), None)
        if hit is None:  # loose match: same letters ignoring underscores
            squash = {n.replace("_", ""): n for n in names}
            hit = next((squash[c.replace("_", "")] for c in cands if c.replace("_", "") in squash), None)
        if hit:
            found[key] = hit
    missing = [k for k in REQUIRED[ds] if k not in found]
    if missing:
        sys.exit(f"{ds}: could not find column(s) {missing}.\nColumns available: {names}")
    return found


def in_batches(soda, ds, field, values, quote, extra_where=None):
    """Query `field in (...)` in batches sized so each URL stays under MAX_URL."""
    lit = (lambda v: "'" + str(v).replace("'", "''") + "'") if quote else str
    rows, batch, n = [], [], 0

    def where(b):
        w = f"{field} in ({','.join(lit(v) for v in b)})"
        return f"({w}) AND ({extra_where})" if extra_where else w

    def flush(b):
        nonlocal n
        n += 1
        rows.extend(soda.query(ds, {"$where": where(b)}))

    for v in values:
        trial = batch + [v]
        if batch and len(soda.url(ds, {"$where": where(trial), "$limit": PAGE,
                                       "$offset": 10 ** 7, "$order": ":id"})) > MAX_URL:
            flush(batch)
            batch = [v]
        else:
            batch = trial
    if batch:
        flush(batch)
    print(f"  {ds}: {len(values)} values in {n} batches -> {len(rows)} rows")
    return rows


# ---------------------------------------------------------------- helpers

def norm_bin(v):
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    s = re.sub(r"\.0+$", "", str(v).strip())
    return s if re.fullmatch(r"\d{7}", s) else None


def to_dt(s):
    return pd.to_datetime(s, errors="coerce", format="mixed")


def base_job(s):
    m = re.match(r"\s*([A-Z]\d{8})", str(s or "").upper())
    return m.group(1) if m else None


def filing_kind(s):
    m = re.search(r"-([A-Z])(\d+)\s*$", str(s or "").upper())
    if not m:
        return "unknown"
    return {"I": "initial", "P": "post-approval amendment", "S": "subsequent"}.get(m.group(1), m.group(1))


def matched_terms(text):
    t = str(text or "").upper()
    return "; ".join(k for k, rx in TERM_REGEX.items() if re.search(rx, t))


def needs_co(job_type):
    t = str(job_type or "").upper()
    return "CO" in re.findall(r"[A-Z]+", t) or "NEW BUILDING" in t


def days(a, b):
    d = (b - a).dt.days
    return d.where(d >= 0)  # negative intervals are data errors


def stats(s):
    s = s.dropna()
    if s.empty:
        return {"n": 0, "median_days": None, "p25_days": None, "p75_days": None, "mean_days": None}
    return {"n": int(s.size), "median_days": float(s.median()), "p25_days": float(s.quantile(.25)),
            "p75_days": float(s.quantile(.75)), "mean_days": round(float(s.mean()), 1)}


def md_table(df, maxrows=40):
    if df is None or df.empty:
        return "_(none)_\n"
    df = df.head(maxrows)
    cols = [str(c) for c in df.columns]
    out = ["| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
    for _, r in df.iterrows():
        out.append("| " + " | ".join("" if pd.isna(v) else (f"{v:g}" if isinstance(v, float) else str(v))
                                     for v in r) + " |")
    return "\n".join(out) + "\n"


# ---------------------------------------------------------------- analysis

def prepare_filings(df, f, co_by_job):
    """One row per job filing number with milestones and stage."""
    df = df.copy()
    df["_filing"] = df[f["job_filing_number"]].astype(str).str.strip().str.upper()
    df["_job"] = df["_filing"].map(base_job)
    df["_kind"] = df["_filing"].map(filing_kind)
    for k in ("filing_date", "approved_date", "first_permit_date", "current_status_date"):
        df["_" + k] = to_dt(df[f[k]]) if k in f else pd.NaT
    df["_status"] = df[f["filing_status"]].fillna("").astype(str) if "filing_status" in f else ""
    df["_job_type"] = df[f["job_type"]].fillna("(blank)").astype(str)
    # DOB NOW can list a filing once per work type; keep one row per filing
    # with the earliest date of each milestone.
    agg = {"_job": "first", "_kind": "first", "_job_type": "first", "_status": "first",
           "_filing_date": "min", "_approved_date": "min", "_first_permit_date": "min",
           "_current_status_date": "max"}
    one = df.groupby("_filing", as_index=False).agg(agg)
    one = one.merge(co_by_job, how="left", left_on="_job", right_index=True)
    one["_needs_co"] = one["_job_type"].map(needs_co)
    return one


def stage(r, today):
    st = r["_status"].upper()
    if re.search(NEGATIVE_STATUS, st):
        return "closed without completion (withdrawn/disapproved/etc.)"
    if pd.isna(r["_approved_date"]) and pd.isna(r["_first_permit_date"]):
        return "1 not yet approved"
    if pd.isna(r["_first_permit_date"]):
        return "2 approved, no permit yet"
    if r["_needs_co"]:
        return "4 CO issued" if pd.notna(r["_first_co_date"]) else "3 permitted, no CO yet"
    return "4 permitted (no CO required)"


def summarize(name, raw, f, co_by_job, today):
    """Tables for one population of filings."""
    one = prepare_filings(raw, f, co_by_job)
    kinds = one["_kind"].value_counts().rename_axis("filing_kind").reset_index(name="filings")
    ini = one[one["_kind"] == "initial"].copy()
    ini["stage"] = pd.Series([stage(r, today) for _, r in ini.iterrows()], index=ini.index, dtype=object)

    jt = (one.groupby(["_job_type", "_kind"]).size().unstack(fill_value=0)
          .rename_axis(index="job_type", columns=None).reset_index())
    jt["total"] = jt.drop(columns="job_type").sum(axis=1)
    jt = jt.sort_values("total", ascending=False)

    # Post-approval amendments per job, joined back to the initial filing's job type
    paa = one[one["_kind"] == "post-approval amendment"].groupby("_job").size()
    ini["paa_count"] = ini["_job"].map(paa).fillna(0).astype(int)

    ini["filing_to_approval"] = days(ini["_filing_date"], ini["_approved_date"])
    ini["approval_to_permit"] = days(ini["_approved_date"], ini["_first_permit_date"])
    ini["permit_to_first_co"] = days(ini["_first_permit_date"], ini["_first_co_date"])
    ini["permit_to_final_co"] = days(ini["_first_permit_date"], ini["_final_co_date"])
    ini["filing_to_first_co"] = days(ini["_filing_date"], ini["_first_co_date"])

    rows = []
    for jtype, g in [("ALL", ini)] + list(ini.groupby("_job_type")):
        for interval in ("filing_to_approval", "approval_to_permit", "permit_to_first_co",
                         "permit_to_final_co", "filing_to_first_co"):
            if interval.endswith("co") and not g["_needs_co"].any():
                continue
            sub = g[g["_needs_co"]] if "co" in interval else g
            rows.append({"population": name, "job_type": jtype, "interval": interval, **stats(sub[interval])})
    timelines = pd.DataFrame(rows)

    stages = (ini.groupby(["_job_type", "stage"]).size().unstack(fill_value=0)
              .rename_axis(index="job_type", columns=None).reset_index())

    unf = ini[ini["stage"].astype(str).str.match(r"[123] ")].copy()
    unf["days_since_filing"] = (today - unf["_filing_date"]).dt.days
    unf["days_in_current_status"] = (today - unf["_current_status_date"]).dt.days
    stuck = (unf.groupby(["stage", "_job_type", "_status"])
             .agg(filings=("_filing", "size"),
                  median_days_since_filing=("days_since_filing", "median"),
                  median_days_in_status=("days_in_current_status", "median"))
             .reset_index().rename(columns={"_job_type": "job_type", "_status": "filing_status"})
             .sort_values(["stage", "filings"], ascending=[True, False]))

    for t in (kinds, jt, stages, stuck):
        t.insert(0, "population", name)
    return {"one": one, "initial": ini, "kinds": kinds, "job_types": jt,
            "timelines": timelines, "stages": stages, "stuck": stuck}


def review_tables(name, raw, cols, f):
    """Distribution of every review-related column (names found at run time)."""
    names = [c for c, _, _ in cols if re.search(r"review|prof.*cert|cert.*prof|work_type|building_code", c)]
    if "work_type" in f and f["work_type"] not in names:
        names.append(f["work_type"])
    out = []
    jt = f["job_type"]
    for c in names:
        if c not in raw.columns:
            continue
        t = (raw.groupby([raw[jt].fillna("(blank)"), raw[c].fillna("(blank)")]).size()
             .reset_index(name="rows").rename(columns={jt: "job_type", c: "value"}))
        t.insert(0, "column", c)
        t.insert(0, "population", name)
        out.append(t)
    # Current statuses that name a review track (e.g. "Prof Cert" QA statuses)
    if "filing_status" in f:
        st = raw[f["filing_status"]].fillna("")
        track = st.str.upper().str.contains(r"PROF\w*\s*CERT|PC QA", regex=True).map(
            {True: "status names professional certification", False: "status does not name it"})
        t = raw.groupby([raw[jt].fillna("(blank)"), track]).size().reset_index(name="rows")
        t.columns = ["job_type", "value", "rows"]
        t.insert(0, "column", f"{f['filing_status']} (derived)")
        t.insert(0, "population", name)
        out.append(t)
    return pd.concat(out, ignore_index=True) if out else pd.DataFrame()


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=os.path.dirname(os.path.abspath(__file__)))
    args = ap.parse_args()
    out = args.out
    os.makedirs(out, exist_ok=True)
    save = lambda df, fn: (df.to_csv(os.path.join(out, fn), index=False), print(f"  wrote {fn} ({len(df)} rows)"))
    today = pd.Timestamp(datetime.now().date())
    soda = Soda(os.environ.get("SODA_APP_TOKEN"))

    # -- Column check
    print("Reading column lists")
    cols, f, types = {}, {}, {}
    for ds in (CHILDCARE, FILINGS, COS):
        cols[ds] = soda.columns(ds)
        f[ds] = resolve(ds, cols[ds])
        types[ds] = {c: t for c, t, _ in cols[ds]}
        print(f"  {ds}: {len(cols[ds])} columns; using {f[ds]}")
    save(pd.DataFrame([{"dataset": ds, "field_name": c, "data_type": t, "display_name": n}
                       for ds in cols for c, t, n in cols[ds]]), "dataset_columns.csv")
    quote = {ds: types[ds][f[ds]["bin"]] != "number" for ds in cols}

    # -- 1. Child care programs and BINs
    print("1. Child care programs")
    cc = pd.DataFrame(soda.query(CHILDCARE, {}))
    save(cc, "childcare_programs.csv")
    ccf = f[CHILDCARE]
    cc["_bin"] = cc[ccf["bin"]].map(norm_bin)
    bad = cc["_bin"].isna() | cc["_bin"].isin(PLACEHOLDER_BINS)
    grp = cc[~bad].groupby("_bin")
    bins = pd.DataFrame({
        "bin": grp.size().index,
        "programs_at_bin": grp.size().values,
        "center_names": grp[ccf["name"]].agg(lambda s: "; ".join(sorted(set(s.dropna().astype(str))))).values
        if "name" in ccf else "",
        "program_types": grp[ccf["program_type"]].agg(lambda s: "; ".join(sorted(set(s.dropna().astype(str))))).values
        if "program_type" in ccf else "",
    })
    save(bins, "childcare_bins.csv")
    print(f"  {len(cc)} programs, {len(bins)} distinct valid BINs, "
          f"{int(bad.sum())} programs with missing/placeholder BIN")
    bin_list = sorted(bins["bin"])

    # -- 2. DOB NOW filings and COs by BIN
    print("2. DOB NOW records for child care BINs")
    ff, cf = f[FILINGS], f[COS]
    fil_bin = pd.DataFrame(in_batches(soda, FILINGS, ff["bin"], bin_list, quote[FILINGS]))
    co_bin = pd.DataFrame(in_batches(soda, COS, cf["bin"], bin_list, quote[COS]))
    if fil_bin.empty:
        fil_bin = pd.DataFrame(columns=[ff["bin"], ff["job_filing_number"], ff["job_type"],
                                        ff["job_description"], ff["filing_date"]])
    fil_bin["_bin"] = fil_bin[ff["bin"]].map(norm_bin)
    fil_bin["childcare_terms_in_description"] = fil_bin[ff["job_description"]].map(matched_terms)
    jobs_at_bin = fil_bin.assign(_job=fil_bin[ff["job_filing_number"]].map(base_job)) \
        .groupby("_bin")["_job"].nunique()
    stories = (pd.to_numeric(fil_bin[ff["existing_stories"]], errors="coerce").groupby(fil_bin["_bin"]).max()
               if "existing_stories" in ff else pd.Series(dtype=float))
    fil_bin["jobs_at_bin"] = fil_bin["_bin"].map(jobs_at_bin)
    fil_bin["max_existing_stories_at_bin"] = fil_bin["_bin"].map(stories)
    fil_bin["large_building_flag"] = (fil_bin["jobs_at_bin"] >= LARGE_JOBS) | \
                                     (fil_bin["max_existing_stories_at_bin"] >= LARGE_STORIES)
    fil_bin["match_note"] = fil_bin.apply(
        lambda r: "child care terms in description" if r["childcare_terms_in_description"]
        else ("BIN match only - large building, likely unrelated work" if r["large_building_flag"]
              else "BIN match only - may be unrelated work"), axis=1)
    fil_bin = fil_bin.merge(bins.rename(columns={"bin": "_bin"}), on="_bin", how="left")
    save(fil_bin.drop(columns="_bin"), "dob_now_filings_by_childcare_bin.csv")
    save(co_bin, "dob_now_co_by_childcare_bin.csv")

    # -- 3. Keyword search
    print("3. DOB NOW filings mentioning child care")
    desc = ff["job_description"]
    where = " OR ".join(f"upper({desc}) like '%{t}%'" for t in LIKE_TERMS)
    kw = pd.DataFrame(soda.query(FILINGS, {"$where": where}))
    if kw.empty:
        kw = pd.DataFrame(columns=fil_bin.columns)
    kw["childcare_terms_in_description"] = kw[desc].map(matched_terms)
    dropped = int((kw["childcare_terms_in_description"] == "").sum())
    kw = kw[kw["childcare_terms_in_description"] != ""].copy()
    kw["_bin"] = kw[ff["bin"]].map(norm_bin)
    kw["bin_has_active_childcare_program"] = kw["_bin"].isin(set(bin_list))
    print(f"  {len(kw)} rows kept, {dropped} dropped by the precise term check")
    save(kw.drop(columns="_bin"), "dob_now_filings_childcare_keyword.csv")

    # COs for keyword filings at BINs not already pulled
    extra = sorted(set(kw["_bin"].dropna()) - set(bin_list) - PLACEHOLDER_BINS)
    co_kw = pd.DataFrame(in_batches(soda, COS, cf["bin"], extra, quote[COS])) if extra else pd.DataFrame()
    save(co_kw, "dob_now_co_for_keyword_filing_bins.csv")

    # -- 5. Summary
    print("5. Summary")
    co_all = pd.concat([co_bin, co_kw], ignore_index=True)
    if co_all.empty:
        co_all = pd.DataFrame(columns=[cf["job_number"], cf["co_date"]])
    co_all["_job"] = co_all[cf["job_number"]].map(base_job)
    co_all["_date"] = to_dt(co_all[cf["co_date"]])
    co_all["_final"] = co_all[cf["co_type"]].astype(str).str.upper().str.contains("FINAL") \
        if "co_type" in cf else False
    co_by_job = pd.DataFrame({
        "_first_co_date": co_all.groupby("_job")["_date"].min(),
        "_final_co_date": co_all[co_all["_final"]].groupby("_job")["_date"].min(),
    })

    pops = {
        "keyword match (citywide)": kw,
        "child care BIN + keyword": fil_bin[fil_bin["childcare_terms_in_description"] != ""],
        "child care BIN, small bldg, all work": fil_bin[~fil_bin["large_building_flag"].fillna(False).astype(bool)],
        "child care BIN, all work (noisy)": fil_bin,
    }
    res = {p: summarize(p, d, ff, co_by_job, today) for p, d in pops.items()}
    cat = lambda k: pd.concat([r[k] for r in res.values()], ignore_index=True)
    reviews = pd.concat([review_tables(p, d, cols[FILINGS], ff) for p, d in pops.items()], ignore_index=True)

    save(cat("job_types"), "summary_job_types.csv")
    save(reviews, "summary_review_types.csv")
    save(cat("timelines"), "summary_timelines.csv")
    save(cat("stages"), "summary_stages.csv")
    save(cat("stuck"), "summary_unfinished_by_status.csv")
    kwi = res["keyword match (citywide)"]["initial"]
    save(kwi.drop(columns=["_needs_co"]).rename(columns=lambda c: c.lstrip("_")),
         "keyword_initial_filings_with_milestones.csv")

    # Markdown report
    co_types = co_all[cf["co_type"]].value_counts().rename_axis("co_type").reset_index(name="records") \
        if "co_type" in cf else pd.DataFrame()
    large = fil_bin.drop_duplicates("_bin") if "_bin" in fil_bin else fil_bin
    lines = [
        "# DOB NOW records for NYC center-based child care",
        f"Generated {today.date()} from data.cityofnewyork.us.\n",
        "## Data pulled",
        f"- Child care programs ({CHILDCARE}): {len(cc)} rows, {len(bins)} distinct valid BINs "
        f"({int(bad.sum())} programs had a missing or placeholder BIN).",
        f"- Filings at those BINs ({FILINGS}): {len(fil_bin)} rows at {fil_bin['_bin'].nunique()} BINs. "
        f"{int(large['large_building_flag'].sum())} BINs are flagged as large buildings "
        f"(>= {LARGE_JOBS} jobs or >= {LARGE_STORIES} stories). "
        f"**BIN matches include all work in the building, much of it unrelated to the child care program**; "
        f"only {int((fil_bin['childcare_terms_in_description'] != '').sum())} rows mention child care terms.",
        f"- COs at those BINs ({COS}): {len(co_bin)} rows; COs at other keyword-filing BINs: {len(co_kw)} rows.",
        f"- Keyword filings ({FILINGS}): {len(kw)} rows ({dropped} LIKE hits dropped by the word-boundary check); "
        f"{int(kw['bin_has_active_childcare_program'].sum())} are at a BIN with an active program.\n",
        "Rules: timelines use initial filings (`-I1`, etc.); `-P` filings are counted as post-approval "
        "amendments, `-S` as subsequent filings. Milestones are the earliest date per filing. "
        "CO dates are matched by job number (filing number without suffix). Negative intervals are dropped. "
        "Medians cover finished steps only; unfinished filings are counted separately below.\n",
    ]
    for p, r in res.items():
        lines += [f"## {p}", "### Filings by job type and filing kind", md_table(r["job_types"].drop(columns="population")),
                  "### Timelines (initial filings, days)",
                  md_table(r["timelines"].drop(columns="population")),
                  "### Stage reached (initial filings)", md_table(r["stages"].drop(columns="population")),
                  "### Unfinished initial filings by current status",
                  md_table(r["stuck"].drop(columns="population"), maxrows=30)]
        rv = reviews[reviews["population"] == p].drop(columns="population") if not reviews.empty else reviews
        lines += ["### Review-related columns by job type", md_table(rv, maxrows=60)]
    lines += ["## CO filing types (all pulled CO records)", md_table(co_types)]
    with open(os.path.join(out, "childcare_dob_summary.md"), "w") as fh:
        fh.write("\n".join(lines))
    print("  wrote childcare_dob_summary.md")


if __name__ == "__main__":
    main()

"""Side-by-side view of how the source files differ, column by column."""
import pandas as pd

MAX_LISTED = 12


def _describe(col):
    values = col.dropna()
    if values.empty:
        return "all blank"
    numeric = pd.to_numeric(values, errors="coerce")
    if numeric.notna().all():
        lo, hi = numeric.min(), numeric.max()
        if (numeric % 1 == 0).all() and not pd.api.types.is_float_dtype(values):
            return f"{int(lo)} to {int(hi)}"
        return f"{float(lo)} to {float(hi)}"
    distinct = sorted(values.astype(str).unique())
    if len(distinct) <= MAX_LISTED:
        return ", ".join(distinct)
    return f"{len(distinct)} distinct"


def compare_sources(frames):
    """One row per column name, one column per source, plus a `differs` flag."""
    names = []
    for df in frames.values():
        names += [c for c in df.columns if c not in names]
    table = pd.DataFrame(
        {label: [_describe(df[c]) if c in df.columns else "absent" for c in names]
         for label, df in frames.items()},
        index=pd.Index(names, name="column"),
    )
    table["differs"] = table.nunique(axis=1) > 1
    return table

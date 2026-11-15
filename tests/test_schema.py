import pandas as pd
from harmonize.schema import unify, clean


def _modis(**kw):
    row = dict(latitude=49.15, longitude=-78.55, brightness=303.7, scan=2.7, track=1.6,
               acq_date="2000-11-07", acq_time="1549", satellite="Terra", instrument="MODIS",
               confidence="57", version="6.03", bright_t31=276.4, frp=40.7, daynight="D", type=0)
    row.update(kw)
    return pd.DataFrame([row])


def _viirs_nrt(**kw):
    row = dict(latitude=45.3, longitude=-73.5, brightness=299.4, scan=0.57, track=0.52,
               acq_date="2026-08-01", acq_time="0625", satellite="SNPP", instrument="SNPP",
               confidence="n", version="2.0NRT", bright_t31=285.2, frp=1.7, daynight="N")
    row.update(kw)
    return pd.DataFrame([row])


def test_same_columns_for_every_dataset():
    a = unify(_modis(), "modis", "archive")
    b = unify(_viirs_nrt(), "viirs_snpp", "nrt")
    assert list(a.columns) == list(b.columns)


def test_missing_type_is_flagged_not_dropped():
    b = unify(_viirs_nrt(), "viirs_snpp", "nrt")
    assert b["type"].isna().all() and b["type_missing"].all()
    assert not unify(_modis(), "modis", "archive")["type_missing"].any()


def test_snpp_instrument_label_becomes_viirs():
    assert unify(_viirs_nrt(), "viirs_snpp", "nrt")["sensor"].iloc[0] == "VIIRS"


def test_confidence_levels():
    lv = lambda c: unify(_modis(confidence=c), "modis", "archive")["confidence_level"].iloc[0]
    assert [lv("0"), lv("29"), lv("30"), lv("79"), lv("80"), lv("100")] == \
           ["low", "low", "nominal", "nominal", "high", "high"]
    v = lambda c: unify(_viirs_nrt(confidence=c), "viirs_snpp", "nrt")["confidence_level"].iloc[0]
    assert [v("l"), v("n"), v("h")] == ["low", "nominal", "high"]


def test_clean_drops_type_2_and_3_keeps_missing():
    df = pd.concat([unify(_modis(type=t), "modis", "archive") for t in (0, 2, 3)]
                   + [unify(_viirs_nrt(), "viirs_snpp", "nrt")])
    out = clean(df)
    assert len(out) == 2 and set(out["type"].dropna()) == {0}


def test_unlabelled_rows_on_known_static_sources_are_dropped():
    from harmonize.schema import flag_static
    smelter = dict(latitude=48.2541, longitude=-79.0229)
    df = pd.concat(
        [unify(_modis(type=2, **smelter), "modis", "archive") for _ in range(3)]
        + [unify(_modis(type=2, latitude=50.0, longitude=-70.0), "modis", "archive")]  # seen once only
        + [unify(_viirs_nrt(**smelter), "viirs_snpp", "nrt"),                      # on the smelter
           unify(_viirs_nrt(latitude=50.001, longitude=-69.999), "viirs_snpp", "nrt"),  # one-off spot
           unify(_viirs_nrt(), "viirs_snpp", "nrt")],                             # open country
        ignore_index=True)
    flagged = flag_static(df)
    assert flagged["likely_static"].tolist() == [True, True, True, False, True, False, False]
    out = clean(df)
    assert len(out) == 2 and out["type_missing"].all()
    assert not out["likely_static"].any()


def test_unify_uses_categories_for_repeated_text():
    out = unify(_modis(), "modis", "archive")
    for col in ("sensor", "satellite", "dataset", "source_file", "confidence_level", "daynight", "version"):
        assert isinstance(out[col].dtype, pd.CategoricalDtype), col

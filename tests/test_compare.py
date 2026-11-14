import pandas as pd
from harmonize.compare import compare_sources


def test_absent_column_and_differs_flag():
    a = pd.DataFrame({"confidence": ["57", "30"], "type": [0, 2], "daynight": ["D", "N"]})
    b = pd.DataFrame({"confidence": ["n", "h"], "daynight": ["D", "N"]})
    t = compare_sources({"modis archive": a, "viirs nrt": b})
    assert t.loc["type", "viirs nrt"] == "absent"
    assert t.loc["type", "differs"] and t.loc["confidence", "differs"]
    assert not t.loc["daynight", "differs"]
    assert t.loc["daynight", "modis archive"] == "D, N"


def test_numeric_range():
    t = compare_sources({"x": pd.DataFrame({"scan": [1.0, 2.7, 4.8]})})
    assert t.loc["scan", "x"] == "1.0 to 4.8"

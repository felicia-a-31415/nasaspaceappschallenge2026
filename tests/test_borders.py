import numpy as np
from harmonize.borders import coverage, in_canada, in_canada_mask


def test_coverage():
    assert coverage(49.9, -74.4, 100) == "canada"      # Chibougamau
    assert coverage(45.5, -73.6, 100) == "partial"     # Montréal, circle reaches New York State
    assert coverage(44.6, -63.6, 100) == "canada"      # Halifax, circle reaches the sea only
    assert coverage(64.8, -147.7, 100) == "outside"    # Fairbanks, inside Canada's bounding box
    assert coverage(38.5, -121.5, 100) == "outside"    # Sacramento
    assert coverage(0.0, -30.0, 50) == "outside"       # mid-Atlantic


def test_in_canada_mask_matches_single_points():
    lats = np.array([49.9, 64.8, 45.5, 38.5])
    lons = np.array([-74.4, -147.7, -73.6, -121.5])
    assert in_canada_mask(lats, lons).tolist() == [True, False, True, False]
    assert in_canada(49.9, -74.4) and not in_canada(64.8, -147.7)

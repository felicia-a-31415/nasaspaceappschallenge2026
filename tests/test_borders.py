import numpy as np
from harmonize.borders import BOX, coverage, in_quebec, in_quebec_mask


def test_coverage():
    assert coverage(49.9, -74.4, 100) == "inside"      # Chibougamau
    assert coverage(45.5, -73.6, 100) == "partial"     # Montréal, circle reaches Ontario and New York State
    assert coverage(49.5, -63.0, 50) == "inside"       # Anticosti Island, circle reaches the sea only
    assert coverage(53.3, -60.4, 100) == "outside"     # Goose Bay, Labrador: inside Quebec's bounding box
    assert coverage(45.4, -75.7, 100) == "outside"     # Ottawa, across the river
    assert coverage(38.5, -121.5, 100) == "outside"    # Sacramento
    assert coverage(0.0, -30.0, 50) == "outside"       # mid-Atlantic


def test_in_quebec_mask_matches_single_points():
    lats = np.array([49.9, 53.3, 45.5, 38.5])
    lons = np.array([-74.4, -60.4, -73.6, -121.5])
    assert in_quebec_mask(lats, lons).tolist() == [True, False, True, False]
    assert in_quebec(49.9, -74.4) and not in_quebec(53.3, -60.4)


def test_box_holds_quebec():
    west, south, east, north = BOX
    assert west < -79 and south < 45.1 and east > -58 and north > 62

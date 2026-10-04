import numpy as np

from atlas.temporal import persistent_changes, track_events, viterbi_types


def test_viterbi_ignores_single_outlier_month():
    emit = np.zeros((10, 1, 2))
    emit[:, 0, 0] = 0.0
    emit[:, 0, 1] = -5.0
    emit[4, 0] = [-5.0, 0.0]
    path = viterbi_types(emit, p_switch=0.01)
    assert (path[:, 0] == 0).all()


def test_viterbi_follows_lasting_change():
    emit = np.zeros((12, 1, 2))
    emit[:6, 0] = [0.0, -5.0]
    emit[6:, 0] = [-5.0, 0.0]
    path = viterbi_types(emit, p_switch=0.01)
    assert path[0, 0] == 0 and path[-1, 0] == 1
    ch = persistent_changes(path, min_run=6)
    assert len(ch) == 1 and ch.iloc[0]["t"] == 6


def test_split_is_detected():
    a = np.array([0] * 10 + [1] * 10)
    b = np.array([0] * 5 + [2] * 5 + [1] * 10)
    ev = track_events(np.array([a, b]), theta=0.3)
    assert "распад" in set(ev.event)

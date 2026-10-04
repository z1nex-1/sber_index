import pandas as pd

from atlas.rank import aggregate, borda, copeland, kendall_w


def test_unanimous_criteria():
    S = pd.DataFrame({"a": [3, 2, 1], "b": [30, 20, 10]}, index=["x", "y", "z"])
    assert kendall_w(S) == 1.0
    agg = aggregate(S)
    assert list(agg.sort_values("kemeny_rank").index) == ["x", "y", "z"]


def test_copeland_counts_pairwise_majorities():
    S = pd.DataFrame({"a": [3, 1, 2], "b": [3, 2, 1], "c": [1, 3, 2]}, index=["x", "y", "z"])
    c = copeland(S)
    assert c["x"] == 2
    assert borda(S)["x"] == S.rank().sum(axis=1)["x"] - 3

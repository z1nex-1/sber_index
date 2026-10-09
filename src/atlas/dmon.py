"""DMoN, Deep Modularity Networks (Tsitsulin, Palowitch, Perozzi, Müller, JMLR 2023).

Кодировщик: двухслойная GCN по признакам и нормированной смежности, на выходе мягкое
назначение C (n x k). Потери: -Tr(C^T B C) / 2m (спектральная модулярность)
плюс sqrt(k)/n * ||sum_i C_i|| - 1 как штраф за схлопывание в один кластер.
"""
import numpy as np
import scipy.sparse as sp


def fit_dmon(X, A, k, seed, hidden=64, epochs=400, lr=1e-3, dropout=0.3, collapse=1.0):
    import torch

    torch.manual_seed(seed)
    torch.set_num_threads(1)
    A = sp.csr_matrix(A)
    n = A.shape[0]
    At = torch.tensor(A.toarray(), dtype=torch.float32)
    deg = At.sum(1)
    m2 = deg.sum()
    Ah = At + torch.eye(n)
    dh = Ah.sum(1).rsqrt()
    Ah = dh[:, None] * Ah * dh[None, :]
    Xt = torch.tensor(X, dtype=torch.float32)

    w1 = torch.nn.Linear(X.shape[1], hidden)
    w2 = torch.nn.Linear(hidden, hidden)
    head = torch.nn.Linear(hidden, k)
    params = [*w1.parameters(), *w2.parameters(), *head.parameters()]
    opt = torch.optim.Adam(params, lr=lr)
    drop = torch.nn.Dropout(dropout)

    def forward(train):
        drop.train(train)
        h = torch.selu(Ah @ w1(Xt))
        h = torch.selu(Ah @ w2(drop(h)))
        return torch.softmax(head(drop(h)), dim=1)

    for _ in range(epochs):
        opt.zero_grad()
        C = forward(True)
        ac = At @ C
        dc = deg @ C
        spectral = -(torch.trace(C.T @ ac) - (dc @ dc) / m2) / m2
        reg = torch.linalg.norm(C.sum(0)) / n * np.sqrt(k) - 1
        (spectral + collapse * reg).backward()
        opt.step()
    with torch.no_grad():
        labels = forward(False).argmax(1).numpy()
    return np.unique(labels, return_inverse=True)[1]

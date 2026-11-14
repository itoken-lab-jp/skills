"""pytest-xdist の -n を付けたときと付けないときの、時間と CPU を比べる。

1件が軽いテストを N 件（既定 500）作り、`pytest -q` と `pytest -q -n <ワーカー数>` を
それぞれ3回走らせて、中央値を出す。CPU は子のプロセスの user+sys の合計。
--sleep を付けると、1件ごとにその秒数だけ待つ（DB や画面のような、1件が重いテストの代わり）。

使い方: python3 bench_xdist.py [--tests 500] [--sleep 0] [--workers 4]
要るもの: Python 3、pytest、pytest-xdist（Linux か Mac。CPU の測り方が Windows に無いため）
"""
import argparse
import os
import resource
import statistics
import subprocess
import sys
import tempfile
import time

p = argparse.ArgumentParser()
p.add_argument("--tests", type=int, default=500)
p.add_argument("--sleep", type=float, default=0.0)
p.add_argument("--workers", default="4")
p.add_argument("--runs", type=int, default=3)
a = p.parse_args()

d = tempfile.mkdtemp(prefix="bench-xdist-")
body = ["import time"]
for i in range(a.tests):
    wait = f"\n    time.sleep({a.sleep})" if a.sleep else ""
    body.append(f"def test_{i}():{wait}\n    assert sum(range(20000)) > 0")
with open(os.path.join(d, "test_many.py"), "w") as f:
    f.write("\n".join(body) + "\n")


def run(extra):
    walls, cpus = [], []
    for _ in range(a.runs):
        before = resource.getrusage(resource.RUSAGE_CHILDREN)
        t = time.perf_counter()
        r = subprocess.run([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", *extra, "test_many.py"],
                           cwd=d, capture_output=True, text=True)
        walls.append(time.perf_counter() - t)
        after = resource.getrusage(resource.RUSAGE_CHILDREN)
        cpus.append((after.ru_utime - before.ru_utime) + (after.ru_stime - before.ru_stime))
        if r.returncode != 0 or f"{a.tests} passed" not in r.stdout:
            sys.exit(f"pytest が失敗した: {extra}\n{r.stdout[-2000:]}\n{r.stderr[-2000:]}")
    return statistics.median(walls), statistics.median(cpus)


base = run([])
par = run(["-n", a.workers])
print(f"テスト {a.tests} 件、1件の待ち {a.sleep} 秒、{a.runs} 回の中央値、CPU {os.cpu_count()} コア")
print(f"-n なし      : {base[0]:.2f} 秒、CPU {base[1]:.2f} 秒")
print(f"-n {a.workers:<9}: {par[0]:.2f} 秒、CPU {par[1]:.2f} 秒（時間 {par[0] / base[0]:.1f} 倍、CPU {par[1] / base[1]:.1f} 倍）")

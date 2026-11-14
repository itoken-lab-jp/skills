# data-query の手順（DuckDB の SQL で CSV を集計する）が、pandas などのスクリプトと比べてどれだけ速く、メモリを食わないかを測る。
#   python3 tools/data-query/bench.py [--rows 2000000] [--repeat 3] [--duckdb <duckdb の CLI>] [--dir <作業フォルダー>]
# 要るもの（Linux か Mac。メモリを resource で測るため）：Python 3 と pandas。polars と duckdb（Python のモジュール）は、入っていれば測る。
# --duckdb で CLI を渡すと、DuckDB は CLI で測る。渡さなければ Python のモジュールで測る（中の処理は同じ）。
# 測ること：売上の明細（日付・部門・商品・数量・金額）と商品の一覧の CSV を作り、3つの集計を、道具ごとに別のプロセスで走らせて、
#   時間と最大のメモリを出す。結果の合計を突き合わせ、道具の間で答えが違えば止める。
#   1. 部門ごとの合計　2. 部門ごとの金額の上位3件（窓関数）　3. 商品の一覧と結合して分類ごとの合計
import argparse, json, os, platform, random, shutil, statistics, subprocess, sys, tempfile, time

SQL = {
    'group': "SELECT 部門, SUM(CAST(金額 AS DECIMAL(18, 2))) AS 金額 FROM '{s}' GROUP BY ALL ORDER BY 部門",
    'window': "SELECT 部門, 商品, 金額 FROM '{s}' QUALIFY ROW_NUMBER() OVER (PARTITION BY 部門 ORDER BY 金額 DESC, 商品) <= 3 ORDER BY 部門, 金額 DESC",
    'join': "SELECT m.分類, SUM(CAST(s.金額 AS DECIMAL(18, 2))) AS 金額 FROM '{s}' s JOIN '{m}' m USING (商品) GROUP BY ALL ORDER BY m.分類",
}

def total(rows):  # 答えの突き合わせに使う、最後の列の合計
    return round(sum(float(r[-1]) for r in rows), 2)

def pandas_run(q, s, m):
    import pandas as pd
    df = pd.read_csv(s)
    if q == 'group':
        r = df.groupby('部門', as_index=False)['金額'].sum().sort_values('部門')
    elif q == 'window':
        r = df.sort_values(['部門', '金額', '商品'], ascending=[True, False, True]).groupby('部門').head(3)[['部門', '商品', '金額']]
    else:
        r = df.merge(pd.read_csv(m), on='商品').groupby('分類', as_index=False)['金額'].sum().sort_values('分類')
    return r.values.tolist()

def polars_run(q, s, m):
    import polars as pl
    df = pl.read_csv(s)
    if q == 'group':
        r = df.group_by('部門').agg(pl.col('金額').sum()).sort('部門')
    elif q == 'window':
        r = df.sort(['部門', '金額', '商品'], descending=[False, True, False]).group_by('部門', maintain_order=True).head(3).select('部門', '商品', '金額')
    else:
        r = df.join(pl.read_csv(m), on='商品').group_by('分類').agg(pl.col('金額').sum()).sort('分類')
    return r.rows()

def duckdb_run(q, s, m):
    import duckdb
    return duckdb.sql(SQL[q].format(s=s, m=m)).fetchall()

def worker(engine, q, s, m, cli):
    t = time.perf_counter()
    if engine == 'duckdb' and cli:
        out = subprocess.run([cli, '-csv', '-noheader', '-c', SQL[q].format(s=s, m=m)], capture_output=True, text=True, check=True).stdout
        rows = [line.split(',') for line in out.splitlines() if line]
    else:
        rows = {'pandas': pandas_run, 'polars': polars_run, 'duckdb': duckdb_run}[engine](q, s, m)
    sec = time.perf_counter() - t
    import resource
    rss = max(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss, resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss)
    print(json.dumps([sec, rss / 1024 if platform.system() == 'Linux' else rss / 1024 / 1024, total(rows)]))  # MB（Linux は KB、Mac はバイト）

def make_data(d, n):
    r = random.Random(1)
    s, m = os.path.join(d, 'sales.csv'), os.path.join(d, 'items.csv')
    items = [f'商品{i:04d}' for i in range(2000)]
    with open(m, 'w', encoding='utf-8') as f:
        f.write('商品,分類\n')
        for i, it in enumerate(items): f.write(f'{it},分類{i % 20:02d}\n')
    with open(s, 'w', encoding='utf-8') as f:
        f.write('日付,部門,商品,数量,金額\n')
        for _ in range(n):
            q = r.randint(1, 20)
            f.write(f'2026-{r.randint(1, 12):02d}-{r.randint(1, 28):02d},部門{r.randint(1, 30):02d},{r.choice(items)},{q},{q * r.randint(100, 50000) / 10:.1f}\n')
    return s, m

def main():
    if len(sys.argv) > 1 and sys.argv[1] == '--run':
        return worker(*sys.argv[2:6], sys.argv[6] if len(sys.argv) > 6 else '')
    ap = argparse.ArgumentParser()
    ap.add_argument('--rows', type=int, default=2_000_000); ap.add_argument('--repeat', type=int, default=3)
    ap.add_argument('--duckdb', default=''); ap.add_argument('--dir')
    a = ap.parse_args()
    engines = ['duckdb', 'pandas']
    for mod in ('polars',):
        try: __import__(mod); engines.append(mod)
        except ImportError: pass
    if not a.duckdb:
        try: __import__('duckdb')
        except ImportError: raise SystemExit('duckdb の CLI（--duckdb）か Python のモジュールが要る')
    d = a.dir or tempfile.mkdtemp()
    try:
        bench(a, engines, *make_data(d, a.rows))
    finally:
        if not a.dir: shutil.rmtree(d, ignore_errors=True)  # 作った CSV（既定で 82MB）を残さない

def bench(a, engines, s, m):
    print(f'# {a.rows:,} 行・{os.path.getsize(s) / 1e6:.0f}MB の CSV、{platform.system()} {platform.machine()}、{os.cpu_count()} コア、各 {a.repeat} 回の中央値')
    print('| 集計 | 道具 | 時間（秒） | 最大のメモリ（MB） |')
    print('|---|---|---:|---:|')
    for q in SQL:
        answer = None
        for e in engines:
            runs = [json.loads(subprocess.check_output([sys.executable, __file__, '--run', e, q, s, m, a.duckdb if e == 'duckdb' else ''])) for _ in range(a.repeat)]
            if answer is None: answer = runs[0][2]
            elif abs(runs[0][2] - answer) > 0.01: raise SystemExit(f'{q}: {e} の答え {runs[0][2]} が {answer} と違う')
            name = e + ('（CLI）' if e == 'duckdb' and a.duckdb else '（Python）' if e == 'duckdb' else '')
            print(f'| {q} | {name} | {statistics.median(r[0] for r in runs):.2f} | {statistics.median(r[1] for r in runs):.0f} |')

if __name__ == '__main__':
    main()

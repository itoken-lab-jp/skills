# excel-read と Python（openpyxl・pandas）で、同じブックを読む時間とメモリを比べる。
#   python3 tools/excel-read/bench/bench.py [--rows 1000,10000,100000] [--repeat 3]
# 要るもの：Linux（x64）か Mac（Apple シリコン）、Python 3 と openpyxl・pandas（比べる相手。excel-read 自身は要らない）。
# ブックはその場で作る（10列：連番・日付・文字・数値5列・文字・式1列）。各回を別のプロセスで走らせ、
# かかった時間（Python の起動と import を含む）の中央値と、最大のメモリ（RSS）を出す。
# 比べる作業：
#   dump  全部のセルを値と式つきで JSON Lines に出す（excel-read dump / openpyxl の read_only で同じ形を書く）
#   table 1行目を見出しにした表を CSV に出す（excel-read table / pandas.read_excel → to_csv）
import argparse, json, os, platform, resource, statistics, subprocess, sys, tempfile, time

here = os.path.dirname(os.path.abspath(__file__))
root = os.path.normpath(os.path.join(here, '../../..'))
# メモリを resource で測るため、Linux と Mac だけで動く
plat = {('Linux', 'x86_64'): 'linux-x64/excel-read', ('Darwin', 'arm64'): 'mac-arm64/excel-read'}[(platform.system(), platform.machine())]
exe = os.path.join(root, 'skills/excel-read/scripts', plat)

PY_DUMP = r'''
import json, sys, openpyxl
wb = openpyxl.load_workbook(sys.argv[1], read_only=True, data_only=False)
wb2 = openpyxl.load_workbook(sys.argv[1], read_only=True, data_only=True)
with open(sys.argv[2], 'w', encoding='utf-8') as out:
    for ws, ws2 in zip(wb.worksheets, wb2.worksheets):
        for row, row2 in zip(ws.iter_rows(), ws2.iter_rows()):
            for c, c2 in zip(row, row2):
                if c.value is None: continue
                d = {'s': ws.title, 'a': c.coordinate, 'v': c2.value}
                if isinstance(c.value, str) and c.value.startswith('='): d['f'] = c.value[1:]
                out.write(json.dumps(d, ensure_ascii=False, default=str) + '\n')
'''
PY_TABLE = r'''
import sys, pandas
pandas.read_excel(sys.argv[1], sheet_name=0).to_csv(sys.argv[2], index=False)
'''

def make_book(path, rows):
    import datetime, openpyxl
    wb = openpyxl.Workbook(write_only=True); ws = wb.create_sheet('データ')
    ws.append(['番号', '日付', '取引先', '数量', '単価', '金額', '原価', '粗利', '備考', '税込'])
    d0 = datetime.date(2026, 1, 1)
    for i in range(1, rows + 1):
        q = i % 97 + 1; p = (i * 37) % 5000 + 100
        ws.append([i, d0 + datetime.timedelta(days=i % 365), f'取引先{i % 50:03}', q, p, q * p, q * p * 0.7,
                   q * p * 0.3, '至急' if i % 13 == 0 else None, f'=F{i + 1}*1.1'])
    wb.save(path)

def run(cmd):
    # 子プロセスの最大 RSS は、それまでに終わった子の最大になるので、1回ずつ新しいラッパーで測る
    wrap = ('import resource,subprocess,sys,time,json;t=time.perf_counter();'
            'r=subprocess.run(sys.argv[1:],stdout=subprocess.DEVNULL);'
            'e=time.perf_counter()-t;m=resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss;'
            'print(json.dumps([r.returncode,e,m]))')
    rc, sec, rss = json.loads(subprocess.check_output([sys.executable, '-c', wrap, *cmd]))
    if rc != 0: raise SystemExit(f'失敗：{cmd}')
    return sec, rss / 1024 if platform.system() == 'Linux' else rss / 1024 / 1024  # MB（Linux は KB、Mac はバイト）

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--rows', default='1000,10000,100000'); ap.add_argument('--repeat', type=int, default=3)
    a = ap.parse_args()
    import openpyxl, pandas
    print(f'# {platform.system()} {platform.machine()} / Python {platform.python_version()} / openpyxl {openpyxl.__version__} / pandas {pandas.__version__}')
    print(subprocess.check_output([exe, '--version'], text=True).strip())
    print('| 行 | ブック | 作業 | excel-read | Python | 倍 |')
    print('|---:|---:|---|---|---|---:|')
    with tempfile.TemporaryDirectory() as tmp:
        dump_py = os.path.join(tmp, 'dump.py'); open(dump_py, 'w').write(PY_DUMP)
        table_py = os.path.join(tmp, 'table.py'); open(table_py, 'w').write(PY_TABLE)
        out = os.path.join(tmp, 'out')
        for rows in [int(x) for x in a.rows.split(',')]:
            book = os.path.join(tmp, f'book-{rows}.xlsx'); make_book(book, rows)
            size = os.path.getsize(book) / 1024 / 1024
            jobs = {
                'dump': ([exe, 'dump', book, '--format', 'jsonl', '--out', out], [sys.executable, dump_py, book, out]),
                'table': ([exe, 'table', book, '--out', out], [sys.executable, table_py, book, out]),
            }
            for name, (er, py) in jobs.items():
                res = {}
                for k, cmd in (('er', er), ('py', py)):
                    rs = [run(cmd) for _ in range(a.repeat)]
                    res[k] = (statistics.median(r[0] for r in rs), max(r[1] for r in rs))
                (es, em), (ps, pm) = res['er'], res['py']
                print(f'| {rows:,} | {size:.1f}MB | {name} | {es:.2f}秒・{em:.0f}MB | {ps:.2f}秒・{pm:.0f}MB | {ps / es:.0f} |')

main()

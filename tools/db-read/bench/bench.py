# db-read と、同じ CSV を作る Python のスクリプト（ドライバと標準の csv、pandas の read_sql）を比べる。
# 4つの DB を Docker で立ててから走らせる（パスワードは試験の fixtures/ci.toml の CI と同じ）：
#   docker run -d -e POSTGRES_PASSWORD=Pg_test_1234 -p 5432:5432 postgres:17
#   docker run -d -e MYSQL_ROOT_PASSWORD=My_test_1234 -e MYSQL_DATABASE=app -p 3306:3306 mysql:8.4
#   docker run -d -e ACCEPT_EULA=Y -e MSSQL_SA_PASSWORD=Ms_test_12345678 -p 1433:1433 mcr.microsoft.com/mssql/server:2022-latest
#   docker run -d -e ORACLE_PASSWORD=Ora_test_1234 -e APP_USER=app -e APP_USER_PASSWORD=App_test_1234 -p 1521:1521 gvenzl/oracle-free:23-slim
#   pip install "psycopg[binary]" pymysql pymssql oracledb pandas
#   python3 tools/db-read/bench/bench.py --rows 200000 --repeat 3 [--dbs pg,my,ms,ora]
# 表 bench（連番・日付・文字・金額・日時の5列）を、そのつど作り直して行を入れる。
# Linux では GNU time（apt install time）が要る。
# 時間は、それぞれ別のプロセスで起動してから CSV を書き終わるまで（Python は import も含む）の中央値。メモリは最大の RSS。Linux と Mac で動く。
import argparse, os, re, statistics, subprocess, sys, tempfile, time

here = os.path.dirname(os.path.abspath(__file__))
exe = os.path.join(here, '../../../skills/db-read/scripts', 'mac-arm64/db-read' if sys.platform == 'darwin' else 'linux-x64/db-read')

DBS = {
    'pg': dict(kind='postgres', port=5432, database='postgres', user='postgres', pw='Pg_test_1234', extra=''),
    'my': dict(kind='mysql', port=3306, database='app', user='root', pw='My_test_1234', extra=''),
    'ms': dict(kind='sqlserver', port=1433, database='master', user='sa', pw='Ms_test_12345678', extra='trust_cert = true\n'),
    'ora': dict(kind='oracle', port=1521, database='FREEPDB1', user='app', pw='App_test_1234', extra=''),
}

# Python の側の接続（ドライバごと）。スクリプトの文字としてもそのまま使う
CONNECT = {
    'pg': "import psycopg; c = psycopg.connect(host='127.0.0.1', port=5432, dbname='postgres', user='postgres', password='Pg_test_1234')",
    'my': "import pymysql; c = pymysql.connect(host='127.0.0.1', port=3306, database='app', user='root', password='My_test_1234')",
    'ms': "import pymssql; c = pymssql.connect(server='127.0.0.1', port=1433, database='master', user='sa', password='Ms_test_12345678')",
    'ora': "import oracledb; c = oracledb.connect(user='app', password='App_test_1234', dsn='127.0.0.1:1521/FREEPDB1')",
}

def setup(db, rows):
    ns = {}
    exec(CONNECT[db], ns)
    c = ns['c']; cur = c.cursor()
    try: cur.execute('DROP TABLE bench')
    except Exception: c.rollback()
    text = 'VARCHAR2(40)' if db == 'ora' else 'VARCHAR(40)'
    ts = {'pg': 'TIMESTAMP', 'my': 'DATETIME', 'ms': 'DATETIME2', 'ora': 'TIMESTAMP'}[db]
    cur.execute(f'CREATE TABLE bench (id INTEGER, d DATE, name {text}, amount DECIMAL(12,2), at {ts})')
    import datetime as dt
    base = dt.datetime(2026, 1, 1, 9, 0, 0)
    ph = {'pg': '%s', 'my': '%s', 'ms': '%s', 'ora': ':1'}[db]
    marks = ', '.join([ph] * 5) if db != 'ora' else ':1, :2, :3, :4, :5'
    data = [(i, (base + dt.timedelta(days=i % 365)).date(), f'商品{i % 1000:04d}', (i * 37 % 100000) / 100, base + dt.timedelta(seconds=i)) for i in range(rows)]
    for k in range(0, rows, 10000):
        cur.executemany(f'INSERT INTO bench VALUES ({marks})', data[k:k + 10000])
    c.commit(); c.close()

def measure(cmd, env=None):
    # 最大の RSS は /usr/bin/time で測る（この Python から直に fork すると、子の RSS の最大にこのプロセスの分が入る）
    timer = ['/usr/bin/time', '-l'] if sys.platform == 'darwin' else ['/usr/bin/time', '-f', 'MAXRSS %M']
    t = time.perf_counter()
    p = subprocess.run(timer + cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, env=env)
    sec = time.perf_counter() - t
    err = p.stderr.decode(errors='replace')
    if p.returncode != 0: sys.exit(f'失敗：{" ".join(cmd)}\n{err}')
    if sys.platform == 'darwin':
        rss = int(re.search(r'(\d+)\s+maximum resident set size', err).group(1)) / 1024 / 1024
    else:
        rss = int(re.search(r'MAXRSS (\d+)', err).group(1)) / 1024
    return sec, rss

def lines(path):
    with open(path, 'rb') as f: return sum(1 for _ in f)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--rows', type=int, default=200000)
    ap.add_argument('--repeat', type=int, default=3)
    ap.add_argument('--dbs', default='pg,my,ms,ora')
    a = ap.parse_args()
    tmp = tempfile.mkdtemp()
    cfg = os.path.join(tmp, 'db.toml')
    with open(cfg, 'w') as f:
        for name, d in DBS.items():
            f.write(f"[{name}]\nkind = \"{d['kind']}\"\nhost = \"127.0.0.1\"\nport = {d['port']}\ndatabase = \"{d['database']}\"\nuser = \"{d['user']}\"\npassword_env = \"PW_{name}\"\n{d['extra']}\n")
    env = dict(os.environ, DB_READ_CONFIG=cfg, **{f'PW_{n}': d['pw'] for n, d in DBS.items()})
    out = os.path.join(tmp, 'out.csv')
    sql = 'SELECT * FROM bench'
    print(f'| DB | db-read | Python のドライバと csv | pandas の read_sql |')
    print('|---|---|---|---|')
    for db in a.dbs.split(','):
        setup(db, a.rows)
        if db == 'ora': time.sleep(5)  # 作り直した直後の表は、読み取り専用のトランザクションで ORA-01466 になる
        plain = CONNECT[db] + f"\nimport csv\ncur = c.cursor(); cur.execute({sql!r})\nw = csv.writer(open({out!r}, 'w', newline='', encoding='utf-8'))\nw.writerow([x[0] for x in cur.description])\nwhile True:\n    rs = cur.fetchmany(10000)\n    if not rs: break\n    w.writerows(rs)\n"
        pandas = CONNECT[db] + f"\nimport warnings; warnings.simplefilter('ignore')\nimport pandas as pd\npd.read_sql({sql!r}, c).to_csv({out!r}, index=False)\n"
        cmds = {
            'db-read': [exe, 'query', db, sql, '--max-rows', '0', '--out', out],
            'plain': [sys.executable, '-c', plain],
            'pandas': [sys.executable, '-c', pandas],
        }
        cells = []
        for k, cmd in cmds.items():
            rs = [measure(cmd, env) for _ in range(a.repeat)]
            if lines(out) != a.rows + 1: sys.exit(f'{db} {k}：行数が {lines(out) - 1}（{a.rows} のはず）')
            cells.append(f'{statistics.median(r[0] for r in rs):.2f}秒・{max(r[1] for r in rs):.0f}MB')
        print(f"| {DBS[db]['kind']} | " + ' | '.join(cells) + ' |', flush=True)

main()

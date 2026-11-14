# skills/excel-read/THIRD_PARTY_NOTICES.md を作り直す。Cargo.lock か Rust の版を変えたら tools/excel-read で走らせる：
#   python3 make-notices.py ../../skills/excel-read/THIRD_PARTY_NOTICES.md
# 載せるもの（build-all.sh と同じ道具がある Linux で走らせる）
#   - 3つの target の通常の依存（cargo metadata。proc-macro はコンパイル時にだけ動くので除く）。各ライブラリの LICENSE などの文を写す
#   - 静的にリンクされるランタイム：Rust の標準ライブラリ（ツールチェーンの COPYRIGHT-library.html）、
#     Linux 版の musl（licenses/ の COPYRIGHT。Rust が同梱する libc.a の版と合うかを見る）、
#     Windows 版の mingw-w64 の CRT（Debian の mingw-w64-x86-64-dev の copyright）
# ライセンスの文が見つからないものが1つでもあれば、書き出さずに終了コード 1。
# 先頭に Cargo.lock の指紋（sha256。改行は LF にそろえる）を書き、test/excel-read.test.mjs が作り直し忘れを赤にする。
import hashlib, html, json, os, re, subprocess, sys

here = os.path.dirname(os.path.abspath(__file__))
TARGETS = ['x86_64-unknown-linux-musl', 'x86_64-pc-windows-gnu', 'aarch64-apple-darwin']
MUSL = '1.2.5'
problems = []

def lock_hash():
    b = open(os.path.join(here, 'Cargo.lock'), 'rb').read().replace(b'\r\n', b'\n')
    return hashlib.sha256(b).hexdigest()

def is_proc_macro(p):
    return any('proc-macro' in t['kind'] for t in p['targets'])

pkgs = {}
for t in TARGETS:
    d = json.loads(subprocess.check_output(['cargo', 'metadata', '--format-version', '1', '--filter-platform', t], cwd=here))
    res = {n['id']: n for n in d['resolve']['nodes']}
    pk = {p['id']: p for p in d['packages']}
    root = d['resolve']['root']; st = [root]; seen = set()
    while st:
        i = st.pop()
        if i in seen: continue
        seen.add(i)
        for dep in res[i]['deps']:
            if any(k['kind'] is None for k in dep['dep_kinds']) and not is_proc_macro(pk[dep['pkg']]):
                st.append(dep['pkg'])
    seen.discard(root)
    for i in seen: pkgs[i] = pk[i]

def block(title, txt):
    return [f'### {title}', '', '```', txt.strip(), '```', '']

out = ['# 第三者の表示（excel-read の実行ファイル）', '',
       f'<!-- Cargo.lock sha256: {lock_hash()} -->', '',
       '`scripts/` の実行ファイル（Windows x64・Mac arm64・Linux x64）には、次の Rust のライブラリと、静的にリンクしたランタイムを組み込んでいます。'
       'ライブラリの版は `tools/excel-read/Cargo.lock` のとおりです。各ライセンスの文を、配布物に含まれるとおりに載せます。', '',
       '# Rust のライブラリ', '']
for p in sorted(pkgs.values(), key=lambda p: (p['name'], p['version'])):
    d = os.path.dirname(p['manifest_path'])
    lic = p['license'] or (f"license-file: {p['license_file']}" if p.get('license_file') else None)
    if not lic: problems.append(f"{p['name']} {p['version']}: Cargo.toml にライセンスが無い")
    out += [f"## {p['name']} {p['version']}（{lic}）", '']
    if p.get('repository'): out += [p['repository'], '']
    names = sorted(f for f in os.listdir(d) if f.upper().startswith(('LICENSE', 'LICENCE', 'COPYING', 'UNLICENSE', 'NOTICE')))
    if p.get('license_file'):
        lf = os.path.normpath(os.path.join(d, p['license_file']))
        if os.path.relpath(lf, d) not in names: names.append(os.path.relpath(lf, d))
    n_text = 0
    for f in names:
        fp = os.path.join(d, f)
        if os.path.isdir(fp):
            for g in sorted(os.listdir(fp)):
                out += block(f'{f}/{g}', open(os.path.join(fp, g), encoding='utf-8', errors='replace').read()); n_text += 1
        elif os.path.isfile(fp):
            out += block(f, open(fp, encoding='utf-8', errors='replace').read()); n_text += 1
    if n_text == 0: problems.append(f"{p['name']} {p['version']}: ライセンスの文のファイルが無い")

out += ['# 静的にリンクしたランタイム', '']
sysroot = subprocess.check_output(['rustc', '--print', 'sysroot'], text=True).strip()
rustv = subprocess.check_output(['rustc', '--version'], text=True).strip()
rustc_commit = re.search(r'commit-hash: (\w+)', subprocess.check_output(['rustc', '-vV'], text=True)).group(1)
cp = os.path.join(sysroot, 'share/doc/rust/COPYRIGHT-library.html')
if os.path.isfile(cp):
    t = html.unescape(re.sub(r'<[^>]+>', '', open(cp, encoding='utf-8').read()))
    t = re.sub(r'[ \t]+\n', '\n', t); t = re.sub(r'\n{3,}', '\n\n', t)
    out += [f'## Rust の標準ライブラリ（{rustv}。3つとも）', '', f'https://github.com/rust-lang/rust/tree/{rustc_commit}', '']
    out += block('COPYRIGHT-library', t)
else: problems.append(f'Rust の標準ライブラリ：{cp} が無い')

libc = os.path.join(sysroot, 'lib/rustlib/x86_64-unknown-linux-musl/lib/self-contained/libc.a')
musl_cr = os.path.join(here, f'licenses/musl-{MUSL}-COPYRIGHT')
if not os.path.isfile(libc): problems.append(f'musl：{libc} が無い（rustup target add x86_64-unknown-linux-musl）')
elif MUSL.encode() not in open(libc, 'rb').read(): problems.append(f'musl：Rust が同梱する libc.a が {MUSL} ではない。licenses/ の COPYRIGHT を取り直す')
else:
    out += [f'## musl {MUSL}（MIT。Linux 版）', '', 'https://musl.libc.org/', '']
    out += block('COPYRIGHT', open(musl_cr, encoding='utf-8').read())

mw = '/usr/share/doc/mingw-w64-x86-64-dev/copyright'
if os.path.isfile(mw):
    v = subprocess.check_output(['dpkg-query', '-W', '-f=${Version}', 'mingw-w64-x86-64-dev'], text=True).strip()
    out += [f'## mingw-w64 の CRT（Debian mingw-w64-x86-64-dev {v}。Windows 版）', '', 'https://www.mingw-w64.org/', '']
    out += block('copyright', open(mw, encoding='utf-8').read())
else: problems.append(f'mingw-w64：{mw} が無い（apt install mingw-w64）')

if problems:
    for p in problems: print('NG', p, file=sys.stderr)
    print('何も書き出していない', file=sys.stderr); sys.exit(1)
open(sys.argv[1], 'w', encoding='utf-8', newline='\n').write('\n'.join(out) + '\n')
print(len(pkgs), 'crates + ランタイム 3 つ →', sys.argv[1])

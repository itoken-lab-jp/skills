# skills/excel-read/THIRD_PARTY_NOTICES.md を作り直す。Cargo.lock を変えたら tools/excel-read で走らせる：
#   python3 make-notices.py ../../skills/excel-read/THIRD_PARTY_NOTICES.md
# 3つの target の通常の依存を cargo metadata で集め、各ライブラリの LICENSE などの文を写す。
import json,subprocess,sys,os,glob
ids={};meta=None
for t in ['x86_64-unknown-linux-musl','x86_64-pc-windows-gnu','aarch64-apple-darwin']:
    d=json.loads(subprocess.check_output(['cargo','metadata','--format-version','1','--filter-platform',t]))
    meta=d
    res={n['id']:n for n in d['resolve']['nodes']}
    root=d['resolve']['root'];st=[root];seen=set()
    while st:
        i=st.pop()
        if i in seen: continue
        seen.add(i)
        for dep in res[i]['deps']:
            if any(k['kind'] is None for k in dep['dep_kinds']): st.append(dep['pkg'])
    seen.discard(root)
    pk={p['id']:p for p in d['packages']}
    for i in seen: ids[i]=pk[i]
out=['# 第三者の表示（excel-read の実行ファイル）','','`scripts/` の実行ファイルには、次の Rust のライブラリを組み込んでいます（Windows x64・Mac arm64・Linux x64 の3つの合計。`tools/excel-read/Cargo.lock` の版）。各ライブラリのライセンスの文を、配布物に含まれるとおりに載せます。','']
missing=[]
for p in sorted(ids.values(),key=lambda p:p['name']):
    out.append(f"## {p['name']} {p['version']}（{p['license']}）")
    out.append('')
    if p.get('repository'): out.append(p['repository']); out.append('')
    d=os.path.dirname(p['manifest_path'])
    files=sorted(f for f in os.listdir(d) if f.upper().startswith(('LICENSE','LICENCE','COPYING','UNLICENSE','NOTICE')))
    if not files: missing.append(p['name'])
    for f in files:
        fp=os.path.join(d,f)
        if os.path.isdir(fp):
            for g in sorted(os.listdir(fp)):
                txt=open(os.path.join(fp,g),encoding='utf-8',errors='replace').read().strip()
                out+=[f'### {f}/{g}','','```',txt,'```','']
            continue
        txt=open(fp,encoding='utf-8',errors='replace').read().strip()
        out+=[f'### {f}','','```',txt,'```','']
open(sys.argv[1],'w',encoding='utf-8').write('\n'.join(out)+'\n')
print(len(ids),'crates; missing license files:',missing)

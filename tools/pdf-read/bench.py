# pdf-read の手順（Poppler の pdftotext と tesseract の OCR）が、公開の PDF をどれだけの時間で、どれだけ正しく読めるかを測る。
#   python3 tools/pdf-read/bench.py <PDF> [<PDF> ...] --tessdata <tessdata_best のフォルダー> [--pages 1,2,3] [--dpi 200]
# 要るもの（Linux か Mac。メモリを resource で測るため）：Poppler（pdftotext・pdftoppm）、tesseract、tessdata_best の jpn、Python 3 と Pillow（スキャン風の画像を作る）。
# 測ること
#   1. 文字の層：pdftotext -layout で全ページを読む時間と最大のメモリ
#   2. スキャン：ページを画像にし、紙を読み取ったように傾け、雑音を足してから tesseract で OCR する。
#      正解は同じページの文字の層。文字の一致（空白を除き、文字ごとの数を突き合わせた F 値。読む順の違いは数えない）と、
#      金額（カンマ・▲・△・＋の付いた数字）が正解と同じ形で読めた割合、1ページの時間を出す
import argparse, collections, json, os, platform, re, resource, statistics, subprocess, sys, tempfile, time

def timed(cmd):
    wrap = ('import resource,subprocess,sys,time,json;t=time.perf_counter();'
            'r=subprocess.run(sys.argv[1:],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);'
            'print(json.dumps([r.returncode,time.perf_counter()-t,resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss]))')
    rc, sec, rss = json.loads(subprocess.check_output([sys.executable, '-c', wrap, *cmd]))
    if rc: raise SystemExit(f'失敗：{cmd}')
    return sec, rss / 1024 if platform.system() == 'Linux' else rss / 1024 / 1024  # MB（Linux は KB、Mac はバイト）

norm = lambda s: re.sub(r'[\s\ufffd]+', '', s)  # 空白と、文字の層で化けた字（�）は数えない
MONEY = re.compile(r'[▲△＋+]?\d{1,3}(?:,\d{3})+|[▲△]\d+')

def scan_like(src, dst, seed):
    from PIL import Image, ImageFilter
    import random
    r = random.Random(seed)
    im = Image.open(src).convert('L').rotate(r.uniform(-0.8, 0.8), expand=True, fillcolor=255)
    px = im.load(); w, h = im.size
    for _ in range(w * h // 200):  # 0.5% の点に雑音
        x, y = r.randrange(w), r.randrange(h); px[x, y] = r.choice((0, 255))
    im.filter(ImageFilter.GaussianBlur(0.5)).save(dst)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pdfs', nargs='+'); ap.add_argument('--tessdata', required=True)
    ap.add_argument('--pages', default='1,2,3'); ap.add_argument('--dpi', type=int, default=200)
    a = ap.parse_args()
    ver = lambda c: subprocess.run(c, capture_output=True, text=True).stderr.splitlines()[0] if c[0] == 'pdftotext' else subprocess.run(c, capture_output=True, text=True).stdout.splitlines()[0]
    print(f"# {ver(['pdftotext', '-v'])} / {ver(['tesseract', '--version'])}")
    print('| PDF | ページ | 文字の層（pdftotext -layout） |')
    print('|---|---:|---|')
    for pdf in a.pdfs:
        pages = int(re.search(r'Pages:\s+(\d+)', subprocess.check_output(['pdfinfo', pdf], text=True)).group(1))
        sec, mb = timed(['pdftotext', '-layout', '-enc', 'UTF-8', pdf, os.devnull])
        print(f'| {os.path.basename(pdf)} | {pages} | {sec:.2f}秒・{mb:.0f}MB |')
    print()
    print('| PDF | ページ | 正解の文字数 | 文字の一致 | 金額（正解の数） | 金額が同じ形で読めた | OCR の時間 |')
    print('|---|---:|---:|---:|---:|---:|---:|')
    with tempfile.TemporaryDirectory() as tmp:
        for pdf in a.pdfs:
            for p in [int(x) for x in a.pages.split(',')]:
                truth = subprocess.check_output(['pdftotext', '-f', str(p), '-l', str(p), '-enc', 'UTF-8', pdf, '-'], text=True)
                base = os.path.join(tmp, 'page')
                subprocess.run(['pdftoppm', '-r', str(a.dpi), '-gray', '-png', '-f', str(p), '-l', str(p), '-singlefile', pdf, base], check=True)
                scan_like(base + '.png', base + '-scan.png', p)
                t = time.perf_counter()
                subprocess.run(['tesseract', base + '-scan.png', base, '-l', 'jpn', '--psm', '3', '--tessdata-dir', a.tessdata, 'txt'], check=True, capture_output=True)
                sec = time.perf_counter() - t
                ocr = open(base + '.txt', encoding='utf-8').read()
                a_, b_ = collections.Counter(norm(truth)), collections.Counter(norm(ocr))
                same = sum((a_ & b_).values()); ratio = 2 * same / (sum(a_.values()) + sum(b_.values()))
                money = MONEY.findall(truth); got = norm(ocr)
                hit = sum(1 for m in money if m in got)
                mtxt = f'{hit / len(money):.0%}' if money else '－'
                print(f'| {os.path.basename(pdf)} | {p} | {len(norm(truth)):,} | {ratio:.3f} | {len(money)} | {mtxt} | {sec:.1f}秒 |')

main()

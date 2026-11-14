# 試験用のダミーの帳票（report.xlsx・report.xls）と、tables.xlsx・queries.xlsx を作る。vba.xlsm は作らない（末尾の注）。開発の時だけ使う（openpyxl と LibreOffice が要る）。
#   python3 make_fixtures.py
# openpyxl は計算結果を保存しないので、LibreOffice で開き直して計算結果を入れる。
# Excel が保存するファイルに多い「共有の式」を試すため、E7・E8 の式を E6 の共有の式に書き換える。
import base64, datetime, io, os, re, shutil, struct, subprocess, tempfile, zipfile
import openpyxl

here = os.path.dirname(os.path.abspath(__file__))
wb = openpyxl.Workbook()
ws = wb.active
ws.title = "月次報告"
ws["A1"] = "2026年10月 部門別売上報告"; ws.merge_cells("A1:F1")
ws["A2"] = "作成日"; ws["B2"] = datetime.date(2026, 10, 30); ws["B2"].number_format = "yyyy-mm-dd"
ws["E2"] = "単位"; ws["F2"] = "千円"
for rng, text in [("A4:A5", "部門"), ("B4:B5", "担当"), ("C4:E4", "売上"), ("F4:F5", "備考")]:
    ws[rng.split(":")[0]] = text; ws.merge_cells(rng)
ws["C5"] = "計画"; ws["D5"] = "実績"; ws["E5"] = "差額"
rows = [("営業1部", [("佐藤", 100, 120, ""), ("鈴木", 200, 180, "大口の失注"), ("高橋", 150, 150, "")]),
        ("営業2部", [("田中", 300, 330, ""), ("伊藤", 250, 260, "")])]
r = 6
for dept, people in rows:
    first = r
    for name, plan, actual, note in people:
        ws.cell(r, 2, name); ws.cell(r, 3, plan); ws.cell(r, 4, actual); ws.cell(r, 5, f"=D{r}-C{r}"); ws.cell(r, 6, note or None)
        r += 1
    ws.cell(first, 1, dept); ws.merge_cells(start_row=first, start_column=1, end_row=r - 1, end_column=1)
    ws.cell(r, 2, "小計")
    for c in "CDE":
        ws[f"{c}{r}"] = f"=SUM({c}{first}:{c}{r - 1})"
    r += 1
r += 1
ws.cell(r, 1, "合計")
for c in "CDE":
    ws[f"{c}{r}"] = f"=SUMIF($B$6:$B${r - 2},\"小計\",{c}$6:{c}${r - 2})"
ws.cell(r + 2, 1, "※ 実績は10月29日締め")

ws2 = wb.create_sheet("一覧")
ws2.append(["日付", "時刻", "件名", "金額", "確定", "比率"])
ws2.append([datetime.date(2026, 10, 1), datetime.time(9, 30), '見積, "A社"', 1234.5, True, "=D2/0"])
ws2.append([datetime.datetime(2026, 10, 2, 14, 5), None, "改行\nあり", 0.1, False, "=D3/D2"])

with tempfile.TemporaryDirectory() as tmp:
    src = os.path.join(tmp, "report.xlsx")
    wb.save(src)
    out = os.path.join(tmp, "out")
    subprocess.run(["soffice", "--headless", "--convert-to", "xlsx", "--outdir", out, src], check=True, capture_output=True)
    subprocess.run(["soffice", "--headless", "--convert-to", "xls", "--outdir", out, src], check=True, capture_output=True)
    # E6 の式を共有の式の元にし、E7・E8 はそれを指すだけにする
    xlsx = os.path.join(out, "report.xlsx")
    zin = zipfile.ZipFile(xlsx)
    dst = os.path.join(here, "report.xlsx")
    with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "xl/worksheets/sheet1.xml":
                text = data.decode("utf-8")
                text, n0 = re.subn(r'(<c r="E6"[^>]*>)<f[^>]*>[^<]*</f>', r'\1<f t="shared" ref="E6:E8" si="0">D6-C6</f>', text)
                text, n1 = re.subn(r'(<c r="E[78]"[^>]*>)<f[^>]*>[^<]*</f>', r'\1<f t="shared" si="0"/>', text)
                assert (n0, n1) == (1, 2), (n0, n1)
                data = text.encode("utf-8")
            zout.writestr(item, data)
    shutil.copy(os.path.join(out, "report.xls"), os.path.join(here, "report.xls"))
# 1つのシートに Excel のテーブルを2つ置く（値だけなので LibreOffice を通さない）
from openpyxl.worksheet.table import Table
tb = openpyxl.Workbook()
ws = tb.active
ws.title = "台帳"
ws["B1"] = "10月の台帳"
for r, row in enumerate([["品目", "数量", "単価"], ["りんご", 3, 120], ["みかん", 5, 80], ["ぶどう", 1, 450]], start=3):
    for c, v in enumerate(row, start=2):
        ws.cell(r, c, v)
for r, row in enumerate([["倉庫", "在庫"], ["東", 10], ["西", 4]], start=3):
    for c, v in enumerate(row, start=6):
        ws.cell(r, c, v)
ws.add_table(Table(displayName="売上表", ref="B3:D6"))
ws.add_table(Table(displayName="在庫表", ref="F3:G5"))
# 集計の行のあるテーブル（calamine はここで行の数を誤るので、道具は XML を自分で読む）
for r, row in enumerate([["月", "件数"], ["9月", 2], ["10月", 3], ["集計", 5]], start=3):
    for c, v in enumerate(row, start=9):
        ws.cell(r, c, v)
ws.add_table(Table(displayName="集計表", ref="I3:J6", totalsRowCount=1))
tb.create_sheet("メモ")["A1"] = "テーブルの無いシート"
# 数の入った結合（2行で 300 を分け合う）。埋めると 300 が2回出る
mg = tb.create_sheet("結合")
for r, row in enumerate([["品目", "金額"], ["送料", 300], ["梱包", None]], start=1):
    for c, v in enumerate(row, start=1):
        if v is not None:
            mg.cell(r, c, v)
mg.merge_cells("B2:B3")
# 見え方：隠した行と列、オートフィルター、単位が表示形式にしか無い列
vw = tb.create_sheet("見え方")
for r, row in enumerate([["品目", "金額", "比率", "重さ", "メモ"], ["A", 12000, 0.25, 1.5, "x"], ["B", 3000, 0.5, 2, "y"], ["C", 500, 0.25, 0.25, "z"]], start=1):
    for c, v in enumerate(row, start=1):
        vw.cell(r, c, v)
for r in range(2, 5):
    vw.cell(r, 2).number_format = '#,##0,"千円"'
    vw.cell(r, 3).number_format = "0%"
    vw.cell(r, 4).number_format = '0.000"g"'
vw.row_dimensions[3].hidden = True
vw.column_dimensions["E"].hidden = True
vw.auto_filter.ref = "A1:E4"
# 先頭に隠したシートを置く。--sheet を省くと、表示されている最初のシート（台帳）を読む
hidden = tb.create_sheet("設定", 0)
hidden["A1"] = "隠したシート"
hidden.sheet_state = "hidden"
tb.active = 1
tb.save(os.path.join(here, "tables.xlsx"))

# Power Query の入ったブック。Excel が書く形（MS-QDEFF）を真似て、customXml/item1.xml に UTF-16 の DataMashup を置く
section = "section Section1;\r\n\r\nshared 売上 = let\r\n    ソース = Excel.CurrentWorkbook(){[Name=\"売上表\"]}[Content],\r\n    型 = Table.TransformColumnTypes(ソース, {{\"数量\", Int64.Type}})\r\nin\r\n    型;"
inner = io.BytesIO()
with zipfile.ZipFile(inner, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("[Content_Types].xml", '<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
    z.writestr("Config/Package.xml", '<?xml version="1.0" encoding="utf-8"?><Package/>')
    z.writestr("Formulas/Section1.m", b"\xef\xbb\xbf" + section.encode("utf-8"))
pkg = inner.getvalue()
mashup = struct.pack("<II", 0, len(pkg)) + pkg + struct.pack("<I", 0) + struct.pack("<I", 0) + struct.pack("<I", 0)
xml = '<?xml version="1.0" encoding="utf-16"?><DataMashup xmlns="http://schemas.microsoft.com/DataMashup">' + base64.b64encode(mashup).decode() + "</DataMashup>"
zin = zipfile.ZipFile(os.path.join(here, "tables.xlsx"))
with zipfile.ZipFile(os.path.join(here, "queries.xlsx"), "w", zipfile.ZIP_DEFLATED) as zout:
    for item in zin.infolist():
        data = zin.read(item.filename)
        if item.filename == "xl/workbook.xml":
            text = data.decode("utf-8")
            text = text.replace("</sheets>", '</sheets><externalReferences><externalReference r:id="rIdExt1"/></externalReferences>', 1)
            if 'xmlns:r=' not in text:
                text = text.replace("<workbook ", '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ', 1)
            data = text.encode("utf-8")
        if item.filename == "xl/_rels/workbook.xml.rels":
            data = data.decode("utf-8").replace("</Relationships>", '<Relationship Id="rIdExt1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink" Target="externalLinks/externalLink1.xml"/></Relationships>').encode("utf-8")
        zout.writestr(item, data)
    zout.writestr("customXml/item1.xml", "\ufeff".encode("utf-16-le") + xml.encode("utf-16-le"))
    # 外部リンク（式の [1] が指すブック）を1つ足す
    zout.writestr("xl/externalLinks/externalLink1.xml", '<?xml version="1.0" encoding="UTF-8"?><externalLink xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><externalBook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/></externalLink>')
    zout.writestr("xl/externalLinks/_rels/externalLink1.xml.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLinkPath" Target="file:///C:/共有/前年の台帳.xlsx" TargetMode="External"/></Relationships>')
    zout.writestr("customXml/itemProps1.xml", '<?xml version="1.0" encoding="utf-8"?><ds:datastoreItem xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"/>')
# 行とセルを逆の順に並べた report.xlsx（unordered.xlsx）と tables.xlsx（unordered-tables.xlsx）。Excel は行の順に書くが、
# そうでない XML を書く道具もある。順に読めないときに丸ごと読む道へ切り替わるのと、隠した行・表示形式を逆順でも読めるのを試す
for src, dst in [("report.xlsx", "unordered.xlsx"), ("tables.xlsx", "unordered-tables.xlsx")]:
    zin = zipfile.ZipFile(os.path.join(here, src))
    with zipfile.ZipFile(os.path.join(here, dst), "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", item.filename):
                text = data.decode("utf-8")
                body = re.search(r"<sheetData>(.*)</sheetData>", text, re.S)
                rows = re.findall(r"<row [^>]*/>|<row [^>]*>.*?</row>", body.group(1), re.S)
                assert "".join(rows) == body.group(1)
                def flip(row):
                    m = re.fullmatch(r"(<row [^>]*>)(.*)(</row>)", row, re.S)
                    if not m:
                        return row
                    cells = re.findall(r"<c [^>]*/>|<c [^>]*>.*?</c>", m.group(2), re.S)
                    assert "".join(cells) == m.group(2)
                    return m.group(1) + "".join(reversed(cells)) + m.group(3)
                text = text[: body.start(1)] + "".join(flip(r) for r in reversed(rows)) + text[body.end(1):]
                data = text.encode("utf-8")
            zout.writestr(item, data)
print("report.xlsx・report.xls・tables.xlsx・queries.xlsx・unordered.xlsx・unordered-tables.xlsx を作った")
# vba.xlsm はここでは作らない。calamine の試験ファイル（https://github.com/tafia/calamine/blob/master/tests/vba.xlsm、
# MIT ライセンス、Copyright (c) 2016 Johann Tuffe。全文は LICENSE-calamine.md）を写したもの。Excel で保存された VBA 入りのブック

---
name: windows-script-encoding
description: Windows で人や別の PC が動かすスクリプトのファイル（.bat・.cmd のバッチファイル、PowerShell の .ps1）を書く・直すときに、文字コードと BOM を選んで、日本語のパスや文字を含んでも Windows の標準の読み手（cmd・Windows PowerShell 5.1）で壊れないようにする手順。「バッチファイルを作って」「タスクスケジューラーで動かす」「社内の PC に配るスクリプト」「PowerShell で実行したら文字化けした・構文エラーになった」と頼まれたときに読む。シェルのコマンドを打つだけのとき、CSV などのデータのファイルの文字コードには使わない。
---

# Windows のスクリプトの文字コード

Windows には、スクリプトのファイルを UTF-8 として読まない読み手が標準で入っている。エディターや AI の書き込みの道具は、たいてい BOM の無い UTF-8 で書く。中身が ASCII だけなら問題は出ないが、日本語（パス・メッセージ・コメント）が1文字でも入ると、手元では動いて、渡した先で壊れる。

- **cmd（.bat・.cmd）**：ファイルをコンソールのコードページで読む。日本語の Windows では cp932（Shift_JIS）。UTF-8 で書いた日本語のパスは化けて「見つからない」になる。先頭に `chcp 65001` を足しても直らない（cmd は読みながら位置を数え直すので、多バイトの行のあとで行がずれ、`'rshell' is not recognized` のような断片の実行になる）。
- **Windows PowerShell 5.1（`powershell.exe`）**：BOM の無い .ps1 を ANSI のコードページ（日本語の Windows では cp932）で読む。日本語の文字列が化け、引用符を巻き込んで構文エラーになることもある。Windows 10・11 の標準で、右クリックの「PowerShell で実行」、タスクスケジューラー、社内の PC で動くのはこちら。PowerShell 7（`pwsh`）は BOM が無くても UTF-8 で読むので、7 で試して通っても 5.1 での壊れ方は見えない。

## 書くとき

1. **誰がどの読み手で動かすかを決める。** 頼みに「PowerShell 7 だけ」と無ければ、.ps1 は 5.1 でも動くように書く。配る・タスクスケジューラーで回す・別の PC で使うなら、なおさら。.bat は必ず cmd が読む。
2. **日本語が要らないなら ASCII だけで書く。** メッセージ・コメントを英語にするのが一番壊れにくい。ただし、頼んだ人が日本語のメッセージを求めているときや、パス自体が日本語のときは、次の 3・4 に従う。
3. **.ps1 に日本語を入れるなら、BOM 付きの UTF-8 で保存する。** 5.1 も 7 も正しく読む。書き込みの道具が BOM を付けないときは、書いたあとに付け直す（下の「保存のしかた」）。
4. **.bat に日本語を入れるなら、次のどちらかにする。**
   - 処理を BOM 付き UTF-8 の .ps1 に置き、.bat は ASCII だけの呼び出し役にする：`powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0backup.ps1"` と `exit /b %ERRORLEVEL%`。どの言語の Windows でも動く。日本語のパスは .ps1 の中に書く。
   - .bat のまま書くなら、動かす PC のコンソールのコードページ（`chcp` で出る番号。日本語の Windows は 932）で保存する。`chcp 65001` は使わない。別の言語の Windows に持って行くと壊れることを、渡すときに書く。
5. **BOM は Windows の読み手に渡すファイルにだけ付ける。** Linux・Mac で動かす .sh や、先頭に `#!` を書くファイルに付けると、`#!` が読まれず「No such file or directory」になる。両方で動かす .ps1（PowerShell 7 は Linux・Mac でも BOM 付きを読む）は BOM 付きでよい。
6. **パスは置き場から組み立てる。** .bat は `%~dp0`、.ps1 は `$PSScriptRoot` を基準にすると、タスクスケジューラーの作業フォルダーに左右されない。

## 保存のしかた

書き込みの道具で書いたあと、文字コードを直して保存し直す（PowerShell 7 の例。5.1 でも同じ書き方で動く）。

```powershell
$p = 'C:\path\to\script.ps1'
$t = [IO.File]::ReadAllText($p, [Text.Encoding]::UTF8)
[IO.File]::WriteAllText($p, $t, (New-Object Text.UTF8Encoding($true)))   # .ps1：BOM 付き UTF-8

$p = 'C:\path\to\backup.bat'
$t = [IO.File]::ReadAllText($p, [Text.Encoding]::UTF8)
[IO.File]::WriteAllText($p, ($t -replace "`r?`n", "`r`n"), [Text.Encoding]::GetEncoding(932))   # .bat：cp932、改行は CRLF
```

`Set-Content -Encoding UTF8` は 5.1 では BOM 付き、7 では BOM 無しになり、版で結果が変わるので、保存には上の書き方を使う。

シェルを使えず書き込みの道具しか無いときは、中身の先頭に BOM の文字（U+FEFF）を置いて書くと、BOM 付きの UTF-8 で保存される（書いたら、先頭の3バイトが 239 187 191 かを読んで確かめる）。cp932 では書けないので、日本語を含む .bat は呼び出し役と .ps1 に分ける形にする。

## 確かめる

書いたら、渡す相手の読み手で動かすか、少なくとも読ませて確かめる。手元で動かせないときは、確かめていないと渡すときに書く。

- .ps1：`powershell.exe -NoProfile -ExecutionPolicy Bypass -File <パス>` で動かす。動かすと困るスクリプト（PATH やレジストリを変える）は、構文だけを見る：
  `powershell.exe -NoProfile -Command "$e=$null; [void][System.Management.Automation.Language.Parser]::ParseFile('<パス>', [ref]$null, [ref]$e); $e.Count"`（0 なら読める。ParseFile は実行時と同じく BOM の有無で文字コードを決める）
- .bat：`cmd.exe /c "<パス>"` で動かし、日本語のパスのファイルが本当にできたか、終了コードは何かを見る。Git Bash から呼ぶと `/c` がパスに書き換えられるので、PowerShell から呼ぶか `cmd //c` と書く。
- 先頭の3バイトで BOM を見る：`[IO.File]::ReadAllBytes('<パス>')[0..2]`（239 187 191 なら BOM 付き UTF-8）。

## 例

頼み：「毎朝タスクスケジューラーで走らせる backup.bat を作って。『業務 資料』フォルダーを『バックアップ\日付』へコピーして、結果をログに追記して」

- やること：.bat は ASCII の呼び出し役にして、robocopy とログは BOM 付き UTF-8 の backup.ps1 に書く（robocopy は 0〜7 が成功、8 以上が失敗なので、それを 0 と 1 に直して返す）。`cmd.exe /c backup.bat` で動かし、コピーされたファイルと終了コードを見る。
- 渡す言葉：「backup.bat は backup.ps1 を呼ぶだけです。日本語は .ps1 の側にあり、BOM 付きの UTF-8 で保存しています。メモ帳で開いて保存し直しても、そのままの形式で保存されます。」

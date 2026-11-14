# 上流から取ったライセンスの文

crates.io で配っているクレートにライセンスの文のファイルが入っていない4つだけ、上流のリポジトリから文を取って置く。`make-notices.py` が表示に載せる。2026-11-14 に取った。

| クレート | 置き場 | 取った所 |
|---|---|---|
| objc2-core-foundation 0.3.2・objc2-system-configuration 0.3.2（Zlib OR Apache-2.0 OR MIT） | `objc2/` | github.com/madsmtm/objc2 の main（クレートを作ったコミット 7b1abfd には文のファイルが無かった）。`LICENSE.md` は、このクレートが Apple の SDK から作られたことの説明 |
| winapi-x86_64-pc-windows-gnu 0.4.0（MIT/Apache-2.0） | `winapi/` | github.com/retep998/winapi-rs の 0.3 の枝 |
| winauth 0.0.5（MIT/Apache-2.0） | `winauth/` | github.com/steffengy/winauth-rs のクレートを作ったコミット 8f06796 |

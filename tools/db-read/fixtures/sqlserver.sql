-- test/db-read.test.mjs が読む試しの表（CI の db-read.yml が流し込む）
CREATE TABLE types (id int, i bigint, n decimal(30,3), f float, b bit, dt date, ts datetime2(6), s nvarchar(max), bin varbinary(10));
INSERT INTO types VALUES
  (1, 9007199254740993, 12345678901234567890.125, 0.1, 1, '2026-10-30', '2026-10-30 14:05:06.123', N'a,"b"' + NCHAR(10) + N'日本', 0x00ff),
  (2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
SELECT TOP 1000 CAST(ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS int) AS id INTO nums FROM sys.all_objects a CROSS JOIN sys.all_objects b;
ALTER TABLE nums ADD grp AS id % 7;

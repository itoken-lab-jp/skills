-- test/db-read.test.mjs が読む試しの表（CI の db-read.yml が流し込む）
CREATE TABLE types (id int, i bigint, n decimal(30,3), f double, b boolean, dt date, ts datetime(6), s text, bin varbinary(10));
INSERT INTO types VALUES
  (1, 9007199254740993, 12345678901234567890.125, 0.1, true, '2026-10-30', '2026-10-30 14:05:06.123', 'a,"b"\n日本', x'00ff'),
  (2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
CREATE TABLE nums (id int, grp int);
INSERT INTO nums WITH RECURSIVE g(id) AS (SELECT 1 UNION ALL SELECT id + 1 FROM g WHERE id < 1000) SELECT id, id % 7 FROM g;

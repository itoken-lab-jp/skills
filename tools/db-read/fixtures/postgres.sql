-- test/db-read.test.mjs が読む試しの表（CI の db-read.yml が流し込む）
CREATE TABLE types (id int, i bigint, n numeric(30,3), f double precision, b boolean, dt date, ts timestamp(6), s text, bin bytea);
INSERT INTO types VALUES
  (1, 9007199254740993, 12345678901234567890.125, 0.1, true, '2026-10-30', '2026-10-30 14:05:06.123', E'a,"b"\n日本', '\x00ff'),
  (2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
CREATE TABLE nums AS SELECT g AS id, g % 7 AS grp FROM generate_series(1, 1000) g;

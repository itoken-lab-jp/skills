#!/usr/bin/env bash
# 自分の CA を使う MySQL と PostgreSQL を Docker で立てる（test/db-read.test.mjs の TLS の試し。CI は .github/workflows/db-read.yml）。
# CA とサーバーの証明書はその場で作り、このフォルダーの certs/ に置く（コミットしない）。サーバーの証明書の名前は
# localhost だけで IP を持たないので、127.0.0.1 でつなぐとホスト名の照合で落ちる（Cloud SQL の証明書と同じ形）。
# other-ca.pem は、サーバーと関係のない CA（違う CA では鎖の確かめで落ちることを見る）。
# 立てたあと：DB_READ_IT_TLS_CONFIG=tools/db-read/fixtures/tls/tls.toml MY_PW=My_test_1234 PG_PW=Pg_test_1234 node --test test/db-read.test.mjs
set -euo pipefail
cd "$(dirname "$0")"
rm -rf certs && mkdir certs && cd certs
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=db-read test CA" -keyout ca-key.pem -out ca.pem 2>/dev/null
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=other CA" -keyout other-key.pem -out other-ca.pem 2>/dev/null
openssl req -newkey rsa:2048 -nodes -subj "/CN=localhost" -keyout server-key.pem -out server.csr 2>/dev/null
printf 'subjectAltName=DNS:localhost\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n' > ext.cnf
openssl x509 -req -in server.csr -CA ca.pem -CAkey ca-key.pem -CAcreateserial -days 2 -extfile ext.cnf -out server.pem 2>/dev/null
# 公式のイメージの mysql と postgres はどちらも uid 999 で動く。PostgreSQL は鍵が持ち主だけ読めることを求める
sudo=$([ "$(id -u)" = 0 ] && echo || echo sudo)
$sudo chown 999:999 server.pem server-key.pem ca.pem
$sudo chmod 600 server-key.pem
cd ..
docker rm -f db-read-tls-my db-read-tls-pg >/dev/null 2>&1 || true
docker run -d --name db-read-tls-my -p 3307:3306 -e MYSQL_ROOT_PASSWORD=My_test_1234 -v "$PWD/certs:/certs:ro" mysql:8.4 \
  --ssl-ca=/certs/ca.pem --ssl-cert=/certs/server.pem --ssl-key=/certs/server-key.pem --require-secure-transport=ON >/dev/null
docker run -d --name db-read-tls-pg -p 5433:5432 -e POSTGRES_PASSWORD=Pg_test_1234 -v "$PWD/certs:/certs:ro" postgres:17 \
  -c ssl=on -c ssl_cert_file=/certs/server.pem -c ssl_key_file=/certs/server-key.pem >/dev/null
for i in $(seq 60); do
  if docker exec db-read-tls-my mysqladmin ping -h 127.0.0.1 -uroot -pMy_test_1234 --ssl-mode=REQUIRED >/dev/null 2>&1 \
    && docker exec db-read-tls-pg pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then
    echo "TLS の MySQL（3307）と PostgreSQL（5433）が立った"
    exit 0
  fi
  sleep 2
done
docker logs db-read-tls-my | tail -20
docker logs db-read-tls-pg | tail -20
exit 1

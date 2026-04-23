#!/usr/bin/env bash
# Generate a self-signed TLS certificate for local dev (proflow.local).
# For a browser-trusted cert on localhost, use mkcert instead (see README.md).

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ssl_dir="${script_dir}/ssl"
cn="${PROFLOW_LOCAL_TLS_CN:-proflow.local}"

mkdir -p "${ssl_dir}"

cert="${ssl_dir}/${cn}.crt"
key="${ssl_dir}/${cn}.key"

if [ -f "${cert}" ] && [ -f "${key}" ]; then
  echo "TLS files already exist: ${cert}"
  exit 0
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required to generate ${cert}. Install openssl or place cert/key manually."
  exit 1
fi

echo "===> Generating self-signed TLS for ${cn} -> ${ssl_dir}/"

tmp_cnf="$(mktemp)"
trap 'rm -f "${tmp_cnf}"' EXIT

cat > "${tmp_cnf}" <<EOF
[req]
distinguished_name = req_distinguished_name
req_extensions = v3_req
prompt = no

[req_distinguished_name]
CN = ${cn}

[v3_req]
keyUsage = keyEncipherment, dataEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = ${cn}
DNS.2 = *.${cn}
DNS.3 = api.${cn}
IP.1 = 127.0.0.1
IP.2 = ::1
EOF

openssl req -x509 -nodes -days 825 -newkey rsa:2048 \
  -keyout "${key}" \
  -out "${cert}" \
  -config "${tmp_cnf}" \
  -extensions v3_req

chmod 600 "${key}"
echo "Created ${cert} and ${key}"

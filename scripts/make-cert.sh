#!/bin/sh
# Self-signed certificate so other devices on the LAN can use the microphone (browsers require HTTPS for mic access).
set -e
cd "$(dirname "$0")/.."
mkdir -p data/tls
IPS="IP:127.0.0.1"
# macOS: ifconfig; Linux: hostname -I (ifconfig is often not installed)
ADDRS=$(hostname -I 2>/dev/null || ifconfig 2>/dev/null | awk '/inet / && $2 != "127.0.0.1" {print $2}')
for ip in $ADDRS; do case "$ip" in *:*) ;; *) IPS="$IPS,IP:$ip";; esac; done
openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 825 \
  -keyout data/tls/key.pem -out data/tls/cert.pem -subj "/CN=KTV local" \
  -addext "subjectAltName=DNS:localhost,$IPS" 2>/dev/null
echo "Certificate written to data/tls (SAN: localhost,$IPS)"

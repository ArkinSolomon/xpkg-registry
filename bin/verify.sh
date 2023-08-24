#!/bin/bash

XPKG_REGISTRY_URL="${XPKG_REGISTRY_URL:-http://127.0.0.1:5020}"

if [ $# -ne 1 ]; then
  echo 'Usage: verify <verification-token>'
  exit 2
fi

TMP_FILE=status-code-$RANDOM.txt

CURL_OUTPUT=$(curl -s -w '%{stderr}%{http_code}' -X POST -H 'Content-Type: application/json' "$XPKG_REGISTRY_URL/auth/verify/$1" -d "{\"validation\": \"---\"}" 2> "$TMP_FILE")

STATUS_CODE=$(cat $TMP_FILE)
rm -f $TMP_FILE

echo Status code: $STATUS_CODE
#!/bin/bash

XPKG_REGISTRY_URL="${XPKG_REGISTRY_URL:-http://127.0.0.1:5020}"

if [ $# -ne 2 ]; then
  echo 'Usage: login <email> <password>'
  exit 2
fi

TMP_FILE=status-code-$RANDOM.txt

CURL_OUTPUT=$(curl -s -w '%{stderr}%{http_code}' -X POST -H 'Content-Type: application/json' "$XPKG_REGISTRY_URL/auth/login" -d "{\"email\": \"$1\", \"password\": \"$2\", \"validation\": \"---\"}" 2> "$TMP_FILE")

STATUS_CODE=$(cat $TMP_FILE)
rm -f $TMP_FILE

if [ "$STATUS_CODE" == "200" ]; then
  XPKG_TOKEN=$(echo $CURL_OUTPUT | sed -nr 's/{"token":\s*"(.+)"}/\1/p')
  echo $XPKG_TOKEN
else 
  echo $CURL_OUTPUT
fi
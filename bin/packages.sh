#!/bin/bash

XPKG_REGISTRY_URL="${XPKG_REGISTRY_URL:-http://127.0.0.1:5020}"

TMP_FILE=status-code-$RANDOM.txt

CURL_OUTPUT=$(curl -s -w '%{stderr}%{http_code}' "$XPKG_REGISTRY_URL/packages" 2> "$TMP_FILE")

STATUS_CODE=$(cat $TMP_FILE)
rm -f $TMP_FILE

if [ "$STATUS_CODE" == "200" ]; then
  echo $CURL_OUTPUT | python3 -m json.tool
else 
  echo Status $STATUS_CODE: $CURL_OUTPUT
fi

#!/bin/bash

XPKG_REGISTRY_URL="${XPKG_REGISTRY_URL:-http://127.0.0.1:5020}"
curl -s "$XPKG_REGISTRY_URL/meta" | python3 -m json.tool
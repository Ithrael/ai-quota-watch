#!/bin/sh
# Optional JAVA_HOME/bin/java shim for hosts where native Java crashes.
set -eu
: "${HUAWEI_SDK_ROOT:?请先设置 HUAWEI_SDK_ROOT}"
exec docker run --rm -i --network none --hostname ai-quota-build --add-host ai-quota-build:127.0.0.1 \
  --user "$(id -u):$(id -g)" -v "$PWD:$PWD" -v "$HUAWEI_SDK_ROOT:$HUAWEI_SDK_ROOT:ro" \
  -w "$PWD" eclipse-temurin:21-jre java "$@"

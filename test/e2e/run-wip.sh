#!/bin/bash

export SHOW_APP_LOGS=1
export PEERIO_REDUCE_SCRYPT_FOR_TESTS=1

npm run test-build

node --expose-gc ./node_modules/.bin/cucumber-js test/e2e/spec \
        -r test/e2e/code \
        --format node_modules/cucumber-pretty \
        --tags '@wip' \
        --exit

#!/bin/bash

find $PWD/temp/logs -type f -name xud*.log -printf "\n%f\n\n" -exec cat {} \;
find $PWD/temp/logs -type f -name connext*.log -printf "\n%f\n\n" -exec cat {} \;
find $PWD/temp/logs -type f -name lnd*.log -printf "\n%f\n\n" -exec cat {} \;

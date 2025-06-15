#!/usr/bin/env bash
#
# Copyright (C) 2023 Salvo Giangreco
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program.  If not, see <http://www.gnu.org/licenses/>.
#

# shellcheck disable=SC2162

set -e

# [
GET_LATEST_FIRMWARE()
{
    if [ -n "$FORCE_VERSION" ]; then
        echo "Using forced version: $FORCE_VERSION" >&2
        echo "$FORCE_VERSION"
    elif [ -n "$SOURCE_FIRMWARE_VERSION" ] && [[ "$MODEL" == "$(echo "$SOURCE_FIRMWARE" | cut -d "/" -f 1)" ]]; then
        echo "Using configured SOURCE_FIRMWARE_VERSION: $SOURCE_FIRMWARE_VERSION" >&2
        echo "$SOURCE_FIRMWARE_VERSION"
    else
        echo "Fetching latest firmware version from Samsung servers..." >&2
        local LATEST_VERSION
        LATEST_VERSION=$(curl -s --retry 5 --retry-delay 5 "https://fota-cloud-dn.ospserver.net/firmware/$REGION/$MODEL/version.xml" \
            | grep latest | sed 's/^[^>]*>//' | sed 's/<.*//')
        echo "Latest available version: $LATEST_VERSION" >&2
        echo "$LATEST_VERSION"
    fi
}

DOWNLOAD_FIRMWARE()
{
    local PDR
    PDR="$(pwd)"

    cd "$ODIN_DIR"
    echo "Downloading firmware for $MODEL ($REGION) using samfirm..." >&2
    
    if [ -n "$FORCE_VERSION" ]; then
        echo "Command: samfirm -m $MODEL -r $REGION -i $IMEI --firmware-version $FORCE_VERSION" >&2
        { samfirm -m "$MODEL" -r "$REGION" -i "$IMEI" --firmware-version "$FORCE_VERSION"; } 2>&1 \
            && touch "$ODIN_DIR/${MODEL}_${REGION}/.downloaded" \
            || exit 1
    elif [ -n "$SOURCE_FIRMWARE_VERSION" ] && [[ "$MODEL" == "$(echo "$SOURCE_FIRMWARE" | cut -d "/" -f 1)" ]]; then
        echo "Command: samfirm -m $MODEL -r $REGION -i $IMEI --firmware-version $SOURCE_FIRMWARE_VERSION" >&2
        { samfirm -m "$MODEL" -r "$REGION" -i "$IMEI" --firmware-version "$SOURCE_FIRMWARE_VERSION"; } 2>&1 \
            && touch "$ODIN_DIR/${MODEL}_${REGION}/.downloaded" \
            || exit 1
    else
        echo "Command: samfirm -m $MODEL -r $REGION -i $IMEI" >&2
        { samfirm -m "$MODEL" -r "$REGION" -i "$IMEI"; } 2>&1 \
            && touch "$ODIN_DIR/${MODEL}_${REGION}/.downloaded" \
            || exit 1
    fi
    
    if [ -f "$ODIN_DIR/${MODEL}_${REGION}/.downloaded" ]; then
        local AP_VERSION CSC_VERSION CP_VERSION
        AP_VERSION=$(find "$ODIN_DIR/${MODEL}_${REGION}" -name "AP*" -exec basename {} \; | cut -d "_" -f 2)
        CSC_VERSION=$(find "$ODIN_DIR/${MODEL}_${REGION}" -name "CSC*" -exec basename {} \; | cut -d "_" -f 3)
        CP_VERSION=$(find "$ODIN_DIR/${MODEL}_${REGION}" -name "CP*" -exec basename {} \; | cut -d "_" -f 2)
        
        echo "Downloaded firmware components:" >&2
        echo "  AP (Android Platform): $AP_VERSION" >&2
        echo "  CSC (Consumer Software Customization): $CSC_VERSION" >&2
        echo "  CP (Cellular Processor): $CP_VERSION" >&2
        
        {
            echo -n "$AP_VERSION/"
            echo -n "$CSC_VERSION/"
            echo -n "$CP_VERSION"
        } >> "$ODIN_DIR/${MODEL}_${REGION}/.downloaded"
    fi

    echo ""
    cd "$PDR"
}

FIRMWARES=( "$SOURCE_FIRMWARE" "$TARGET_FIRMWARE" )
IFS=':' read -a SOURCE_EXTRA_FIRMWARES <<< "$SOURCE_EXTRA_FIRMWARES"
if [ "${#SOURCE_EXTRA_FIRMWARES[@]}" -ge 1 ]; then
    for i in "${SOURCE_EXTRA_FIRMWARES[@]}"
    do
        FIRMWARES+=( "$i" )
    done
fi
IFS=':' read -a TARGET_EXTRA_FIRMWARES <<< "$TARGET_EXTRA_FIRMWARES"
if [ "${#TARGET_EXTRA_FIRMWARES[@]}" -ge 1 ]; then
    for i in "${TARGET_EXTRA_FIRMWARES[@]}"
    do
        FIRMWARES+=( "$i" )
    done
fi
# ]

FORCE=false
FORCE_VERSION=""

while [ "$#" != 0 ]; do
    case "$1" in
        "-f" | "--force")
            FORCE=true
            ;;
        "-v" | "--version")
            shift
            FORCE_VERSION="$1"
            ;;
        *)
            echo "Usage: download_fw [options]"
            echo " -f, --force : Force firmware download"
            echo " -v, --version <version> : Force download specific firmware version"
            exit 1
            ;;
    esac

    shift
done

mkdir -p "$ODIN_DIR"

echo "=========================================="
echo "UN1CA Samsung Firmware Downloader"
echo "=========================================="
echo "Configuration:"
echo "  ODIN_DIR: $ODIN_DIR"
echo "  SOURCE_FIRMWARE: $SOURCE_FIRMWARE"
echo "  TARGET_FIRMWARE: $TARGET_FIRMWARE"
if [ -n "$SOURCE_FIRMWARE_VERSION" ]; then
    echo "  SOURCE_FIRMWARE_VERSION: $SOURCE_FIRMWARE_VERSION"
fi
if [ -n "$SOURCE_EXTRA_FIRMWARES" ]; then
    echo "  SOURCE_EXTRA_FIRMWARES: $SOURCE_EXTRA_FIRMWARES"
fi
if [ -n "$TARGET_EXTRA_FIRMWARES" ]; then
    echo "  TARGET_EXTRA_FIRMWARES: $TARGET_EXTRA_FIRMWARES"
fi
echo "  Force download: $FORCE"
if [ -n "$FORCE_VERSION" ]; then
    echo "  Force version: $FORCE_VERSION"
fi
echo "  Total firmwares to process: ${#FIRMWARES[@]}"
echo "=========================================="
echo ""

for i in "${FIRMWARES[@]}"
do
    MODEL=$(echo -n "$i" | cut -d "/" -f 1)
    REGION=$(echo -n "$i" | cut -d "/" -f 2)
    IMEI=$(echo -n "$i" | cut -d "/" -f 3)

    echo "=================================================="
    echo "Processing firmware: $MODEL ($REGION)"
    echo "IMEI: $IMEI"
    echo "=================================================="

    if [ -f "$ODIN_DIR/${MODEL}_${REGION}/.downloaded" ]; then
        CURRENT_VERSION=$(cat "$ODIN_DIR/${MODEL}_${REGION}/.downloaded")
        LATEST_VERSION=$(GET_LATEST_FIRMWARE)
        
        echo "Current downloaded version: $CURRENT_VERSION"
        
        [ -z "$LATEST_VERSION" ] && continue
        if [[ "$LATEST_VERSION" != "$CURRENT_VERSION" ]]; then
            if $FORCE; then
                echo "- Updating $MODEL firmware with $REGION CSC..."
                echo "  From: $CURRENT_VERSION"
                echo "  To: $LATEST_VERSION"
                rm -rf "$ODIN_DIR/${MODEL}_${REGION}" && DOWNLOAD_FIRMWARE
            else
                echo "- $MODEL firmware with $REGION CSC already downloaded"
                echo "  Current: $CURRENT_VERSION"
                echo "  Latest: $LATEST_VERSION"
                echo "  A newer version of this device's firmware is available."
                echo -e "  To download, clean your Odin firmwares directory or run this cmd with \"--force\"\n"
                continue
            fi
        else
            echo "- $MODEL firmware with $REGION CSC already downloaded and up to date"
            echo "  Version: $CURRENT_VERSION"
            echo ""
            continue
        fi
    else
        echo "- Downloading $MODEL firmware with $REGION CSC..."
        rm -rf "$ODIN_DIR/${MODEL}_${REGION}" && DOWNLOAD_FIRMWARE
    fi
done

exit 0

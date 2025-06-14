if [ ! -f "$WORK_DIR/system/system/lib64/libbluetooth_jni.so" ]; then
    [ -d "$TMP_DIR" ] && rm -rf "$TMP_DIR"
    mkdir -p "$TMP_DIR"

    unzip -q -j "$WORK_DIR/system/system/apex/com.android.btservices.apex" \
        "apex_payload.img" -d "$TMP_DIR"

    mkdir -p "$TMP_DIR/tmp_out"
    sudo mount -o ro "$TMP_DIR/apex_payload.img" "$TMP_DIR/tmp_out"
    sudo cat "$TMP_DIR/tmp_out/lib64/libbluetooth_jni.so" > "$WORK_DIR/system/system/lib64/libbluetooth_jni.so"

    sudo umount "$TMP_DIR/tmp_out"
    rm -rf "$TMP_DIR"

    SET_METADATA "system" "system/lib64/libbluetooth_jni.so" 0 0 644 "u:object_r:system_lib_file:s0"
fi

# Debugging info before HEX_PATCH
if [ -f "$WORK_DIR/system/system/lib64/libbluetooth_jni.so" ]; then
    echo "[DEBUG] libbluetooth_jni.so exists. Info:"
    ls -l "$WORK_DIR/system/system/lib64/libbluetooth_jni.so"
    echo "[DEBUG] SHA256: $(sha256sum "$WORK_DIR/system/system/lib64/libbluetooth_jni.so")"
    echo "[DEBUG] MD5:    $(md5sum    "$WORK_DIR/system/system/lib64/libbluetooth_jni.so")"
    echo "[DEBUG] File size: $(stat -c %s "$WORK_DIR/system/system/lib64/libbluetooth_jni.so") bytes"
    echo "[DEBUG] Searching for hex pattern 6804003528008052..."
    xxd -p "$WORK_DIR/system/system/lib64/libbluetooth_jni.so" | tr -d '\n' | grep -bo 6804003528008052 || echo "[DEBUG] Pattern not found in file."
    # Optionally, dump first 256 bytes for inspection
    echo "[DEBUG] First 256 bytes of file:" && xxd -l 256 "$WORK_DIR/system/system/lib64/libbluetooth_jni.so"
else
    echo "[DEBUG] libbluetooth_jni.so does NOT exist at expected path!"
fi

# https://github.com/3arthur6/BluetoothLibraryPatcher/blob/425bb59da6505c962a38c143137698849b01d470/hexpatch.sh#L12
HEX_PATCH "$WORK_DIR/system/system/lib64/libbluetooth_jni.so" \
    "6804003528008052" "2b00001428008052"

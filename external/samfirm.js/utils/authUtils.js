"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleAuthRotation = exports.getAuthorization = exports.decryptNonce = void 0;
const crypto_1 = __importDefault(require("crypto"));
const NONCE_KEY = "vicopx7dqu06emacgpnpy8j8zwhduwlh";
const AUTH_KEY = "9u7qab84rpc16gvk";
const decryptNonce = (nonceEncrypted) => {
    const nonceDecipher = crypto_1.default.createDecipheriv("aes-256-cbc", NONCE_KEY, NONCE_KEY.slice(0, 16));
    return Buffer.concat([
        nonceDecipher.update(nonceEncrypted, "base64"),
        nonceDecipher.final(),
    ]).toString("utf-8");
};
exports.decryptNonce = decryptNonce;
const getAuthorization = (nonceDecrypted) => {
    let key = "";
    for (let i = 0; i < 16; i += 1) {
        const nonceChar = nonceDecrypted.charCodeAt(i);
        key += NONCE_KEY[nonceChar % 16];
    }
    key += AUTH_KEY;
    const authCipher = crypto_1.default.createCipheriv("aes-256-cbc", key, key.slice(0, 16));
    return Buffer.concat([
        authCipher.update(nonceDecrypted, "utf8"),
        authCipher.final(),
    ]).toString("base64");
};
exports.getAuthorization = getAuthorization;
const handleAuthRotation = (responseHeaders) => {
    const { nonce } = responseHeaders;
    const nonceDecrypted = (0, exports.decryptNonce)(nonce);
    const authorization = (0, exports.getAuthorization)(nonceDecrypted);
    return {
        Authorization: `FUS nonce="${nonce}", signature="${authorization}", nc="", type="", realm="", newauth="1"`,
        nonce: {
            decrypted: nonceDecrypted,
            encrypted: nonce,
        },
    };
};
exports.handleAuthRotation = handleAuthRotation;

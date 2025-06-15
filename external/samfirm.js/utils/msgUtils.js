"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDecryptionKey = exports.getBinaryInitMsg = exports.getBinaryInformMsg = void 0;
const crypto_1 = __importDefault(require("crypto"));
const fast_xml_parser_1 = require("fast-xml-parser");
const builder = new fast_xml_parser_1.XMLBuilder({});
const getLogicCheck = (input, nonce) => {
    let out = "";
    for (let i = 0; i < nonce.length; i++) {
        const char = nonce.charCodeAt(i);
        out += input[char & 0xf];
    }
    return out;
};
const getBinaryInformMsg = (version, region, model, nonce, imei) => {
    let msg = {
        FUSMsg: {
            FUSHdr: {
                ProtoVer: "1.0",
            },
            FUSBody: {
                Put: {
                    ACCESS_MODE: {
                        Data: 2,
                    },
                    BINARY_NATURE: {
                        Data: 1,
                    },
                    CLIENT_PRODUCT: {
                        Data: "Smart Switch",
                    },
                    CLIENT_VERSION: {
                        Data: "4.3.23123_1",
                    },
                    DEVICE_FW_VERSION: {
                        Data: version,
                    },
                    DEVICE_LOCAL_CODE: {
                        Data: region,
                    },
                    DEVICE_MODEL_NAME: {
                        Data: model,
                    },
                    DEVICE_IMEI_PUSH: {
                        Data: imei,
                    },
                    LOGIC_CHECK: {
                        Data: getLogicCheck(version, nonce),
                    },
                },
            },
        },
    };
    //hardcode EUX as Germany and EUY as Republic of Serbia
    if (region == "EUX") {
        let xelement = msg.FUSMsg.FUSBody.Put;
        xelement.DEVICE_AID_CODE = { Data: region, };
        xelement.DEVICE_CC_CODE = { Data: "DE", };
        xelement.MCC_NUM = { Data: "262", };
        xelement.MNC_NUM = { Data: "01", };
    }
    else if (region == "EUY") {
        let xelement = msg.FUSMsg.FUSBody.Put;
        xelement.DEVICE_AID_CODE = { Data: region, };
        xelement.DEVICE_CC_CODE = { Data: "RS", };
        xelement.MCC_NUM = { Data: "220", };
        xelement.MNC_NUM = { Data: "01", };
    }
    return builder.build(msg);
};
exports.getBinaryInformMsg = getBinaryInformMsg;
const getBinaryInitMsg = (filename, nonce) => {
    const msg = {
        FUSMsg: {
            FUSHdr: {
                ProtoVer: "1.0",
            },
            FUSBody: {
                Put: {
                    BINARY_FILE_NAME: {
                        Data: filename,
                    },
                    LOGIC_CHECK: {
                        Data: getLogicCheck(filename.split(".")[0].slice(-16), nonce),
                    },
                },
            },
        },
    };
    return builder.build(msg);
};
exports.getBinaryInitMsg = getBinaryInitMsg;
const getDecryptionKey = (version, logicalValue) => {
    return crypto_1.default
        .createHash("md5")
        .update(getLogicCheck(version, logicalValue))
        .digest();
};
exports.getDecryptionKey = getDecryptionKey;

#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const cli_progress_1 = __importDefault(require("cli-progress"));
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const fast_xml_parser_1 = require("fast-xml-parser");
const path_1 = __importDefault(require("path"));
const unzip_stream_1 = __importDefault(require("unzip-stream"));
const yargs_1 = __importDefault(require("yargs"));
const authUtils_1 = require("./utils/authUtils");
const msgUtils_1 = require("./utils/msgUtils");
const package_json_1 = require("./package.json");
// There is no viable option other than using the `unzip-stream` module, however,
// it depends on an extremely old dependency `binary`, which uses `new Buffer()`
// and causes node to complain. Suppress warnings until we find an alternative.
process.removeAllListeners("warning");
const parser = new fast_xml_parser_1.XMLParser({});
const getLatestVersion = async (region, model) => {
    return axios_1.default
        .get(`https://fota-cloud-dn.ospserver.net/firmware/${region}/${model}/version.xml`)
        .then((res) => {
        const [pda, csc, modem] = parser
            .parse(res.data)
            .versioninfo.firmware.version.latest.split("/");
        return { pda, csc, modem };
    });
};
const main = async (region, model, imei, firmwareVersion) => {
    console.log(`
  Model: ${model}
  Region: ${region}`);
    let pda, csc, modem;
    if (firmwareVersion) {
        // Parse provided firmware version (format: PDA/CSC/MODEM)
        const parts = firmwareVersion.split('/');
        if (parts.length !== 3) {
            console.error('Error: Firmware version must be in format PDA/CSC/MODEM');
            process.exit(1);
        }
        [pda, csc, modem] = parts;
        console.log(`
  Using specified version:
    PDA: ${pda}
    CSC: ${csc}
    MODEM: ${modem !== "" ? modem : "N/A"}`);
    }
    else {
        // Get latest version
        const latest = await getLatestVersion(region, model);
        pda = latest.pda;
        csc = latest.csc;
        modem = latest.modem;
        console.log(`
  Latest version:
    PDA: ${pda}
    CSC: ${csc}
    MODEM: ${modem !== "" ? modem : "N/A"}`);
    }
    const nonce = {
        encrypted: "",
        decrypted: "",
    };
    const headers = {
        "User-Agent": "Kies2.0_FUS",
    };
    const handleHeaders = (responseHeaders) => {
        if (responseHeaders.nonce != null) {
            const { Authorization, nonce: newNonce } = (0, authUtils_1.handleAuthRotation)(responseHeaders);
            Object.assign(nonce, newNonce);
            headers.Authorization = Authorization;
        }
        const sessionID = responseHeaders["set-cookie"]
            ?.find((cookie) => cookie.startsWith("JSESSIONID"))
            ?.split(";")[0];
        if (sessionID != null) {
            headers.Cookie = sessionID;
        }
    };
    await axios_1.default
        .post("https://neofussvr.sslcs.cdngc.net/NF_DownloadGenerateNonce.do", "", {
        headers: {
            Authorization: 'FUS nonce="", signature="", nc="", type="", realm="", newauth="1"',
            "User-Agent": "Kies2.0_FUS",
            Accept: "application/xml",
        },
    })
        .then((res) => {
        handleHeaders(res.headers);
        return res;
    });
    const { binaryByteSize, binaryDescription, binaryFilename, binaryLogicValue, binaryModelPath, binaryOSVersion, binaryVersion, } = await axios_1.default
        .post("https://neofussvr.sslcs.cdngc.net/NF_DownloadBinaryInform.do", (0, msgUtils_1.getBinaryInformMsg)(`${pda}/${csc}/${modem !== "" ? modem : pda}/${pda}`, region, model, nonce.decrypted, imei), {
        headers: {
            ...headers,
            Accept: "application/xml",
            "Content-Type": "application/xml",
        },
    })
        .then((res) => {
        handleHeaders(res.headers);
        return res;
    })
        .then((res) => {
        const parsedInfo = parser.parse(res.data);
        return {
            binaryByteSize: parsedInfo.FUSMsg.FUSBody.Put.BINARY_BYTE_SIZE.Data,
            binaryDescription: parsedInfo.FUSMsg.FUSBody.Put.DESCRIPTION.Data,
            binaryFilename: parsedInfo.FUSMsg.FUSBody.Put.BINARY_NAME.Data,
            binaryLogicValue: parsedInfo.FUSMsg.FUSBody.Put.LOGIC_VALUE_FACTORY.Data,
            binaryModelPath: parsedInfo.FUSMsg.FUSBody.Put.MODEL_PATH.Data,
            binaryOSVersion: parsedInfo.FUSMsg.FUSBody.Put.CURRENT_OS_VERSION.Data,
            binaryVersion: parsedInfo.FUSMsg.FUSBody.Results.LATEST_FW_VERSION.Data,
        };
    });
    console.log(`
  OS: ${binaryOSVersion}
  Filename: ${binaryFilename}
  Size: ${binaryByteSize} bytes
  Logic Value: ${binaryLogicValue}
  Description:
    ${binaryDescription.split("\n").join("\n    ")}`);
    const decryptionKey = (0, msgUtils_1.getDecryptionKey)(binaryVersion, binaryLogicValue);
    await axios_1.default
        .post("https://neofussvr.sslcs.cdngc.net/NF_DownloadBinaryInitForMass.do", (0, msgUtils_1.getBinaryInitMsg)(binaryFilename, nonce.decrypted), {
        headers: {
            ...headers,
            Accept: "application/xml",
            "Content-Type": "application/xml",
        },
    })
        .then((res) => {
        handleHeaders(res.headers);
        return res;
    });
    const binaryDecipher = crypto_1.default.createDecipheriv("aes-128-ecb", decryptionKey, null);
    await axios_1.default
        .get(`http://cloud-neofussvr.samsungmobile.com/NF_DownloadBinaryForMass.do?file=${binaryModelPath}${binaryFilename}`, {
        headers,
        responseType: "stream",
    })
        .then((res) => {
        const outputFolder = `${process.cwd()}/${model}_${region}/`;
        console.log();
        console.log(outputFolder);
        fs_1.default.mkdirSync(outputFolder, { recursive: true });
        let downloadedSize = 0;
        let currentFile = "";
        const progressBar = new cli_progress_1.default.SingleBar({
            format: "{bar} {percentage}% | {value}/{total} | {file}",
            barCompleteChar: "\u2588",
            barIncompleteChar: "\u2591",
        });
        progressBar.start(binaryByteSize, downloadedSize);
        return res.data
            .on("data", (buffer) => {
            downloadedSize += buffer.length;
            progressBar.update(downloadedSize, { file: currentFile });
        })
            .pipe(binaryDecipher)
            .pipe(unzip_stream_1.default.Parse())
            .on("entry", (entry) => {
            currentFile = `${entry.path.slice(0, 18)}...`;
            progressBar.update(downloadedSize, { file: currentFile });
            entry
                .pipe(fs_1.default.createWriteStream(path_1.default.join(outputFolder, entry.path)))
                .on("finish", () => {
                if (downloadedSize === binaryByteSize) {
                    console.log();
                    process.exit();
                }
            });
        });
    });
};
const argv = yargs_1.default
    .option("model", {
    alias: "m",
    describe: "Model",
    type: "string",
    demandOption: true,
})
    .option("region", {
    alias: "r",
    describe: "Region",
    type: "string",
    demandOption: true,
})
    .option("imei", {
    alias: "i",
    describe: "IMEI",
    type: "string",
    demandOption: true,
})
    .option("firmware-version", {
    alias: "fv",
    describe: "Specific firmware version (format: PDA/CSC/MODEM)",
    type: "string",
})
    .version(package_json_1.version)
    .alias("v", "version")
    .help()
    .parseSync();
main(argv.region, argv.model, argv.imei, argv["firmware-version"]);

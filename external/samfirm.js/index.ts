#!/usr/bin/env node

import axios, { AxiosResponse } from "axios";
import crypto from "crypto";
import fs from "fs";
import { XMLParser } from "fast-xml-parser";
import path from "path";
import unzip from "unzip-stream";
import yargs from "yargs";

import { handleAuthRotation } from "./utils/authUtils";
import {
  getBinaryInformMsg,
  getBinaryInitMsg,
  getDecryptionKey,
} from "./utils/msgUtils";
import { createProgressBar } from "./utils/progressUtils";
import { version as packageVersion } from "./package.json";

// There is no viable option other than using the `unzip-stream` module, however,
// it depends on an extremely old dependency `binary`, which uses `new Buffer()`
// and causes node to complain. Suppress warnings until we find an alternative.
process.removeAllListeners("warning");

const parser = new XMLParser({});

const getLatestVersion = async (
  region: string,
  model: string
): Promise<{ pda: string; csc: string; modem: string }> => {
  return axios
    .get(
      `https://fota-cloud-dn.ospserver.net/firmware/${region}/${model}/version.xml`
    )
    .then((res: AxiosResponse) => {
      const [pda, csc, modem] = parser
        .parse(res.data)
        .versioninfo.firmware.version.latest.split("/");

      return { pda, csc, modem };
    });
};

const main = async (region: string, model: string, imei: string, firmwareVersion?: string): Promise<void> => {
  console.log(`
  Model: ${model}
  Region: ${region}`);

  let pda: string, csc: string, modem: string;

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
  } else {
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

  const headers: Record<string, string> = {
    "User-Agent": "Kies2.0_FUS",
  };

  const handleHeaders = (responseHeaders: any) => {
    if (responseHeaders.nonce != null) {
      const { Authorization, nonce: newNonce } =
        handleAuthRotation(responseHeaders);

      Object.assign(nonce, newNonce);
      headers.Authorization = Authorization;
    }

    const sessionID = responseHeaders["set-cookie"]
      ?.find((cookie: string) => cookie.startsWith("JSESSIONID"))
      ?.split(";")[0];

    if (sessionID != null) {
      headers.Cookie = sessionID;
    }
  };

  await axios
    .post("https://neofussvr.sslcs.cdngc.net/NF_DownloadGenerateNonce.do", "", {
      headers: {
        Authorization:
          'FUS nonce="", signature="", nc="", type="", realm="", newauth="1"',
        "User-Agent": "Kies2.0_FUS",
        Accept: "application/xml",
      },
    })
    .then((res) => {
      handleHeaders(res.headers);
      return res;
    });

  const {
    binaryByteSize,
    binaryDescription,
    binaryFilename,
    binaryLogicValue,
    binaryModelPath,
    binaryOSVersion,
    binaryVersion,
  } = await axios
    .post(
      "https://neofussvr.sslcs.cdngc.net/NF_DownloadBinaryInform.do",
      getBinaryInformMsg(
        `${pda}/${csc}/${modem !== "" ? modem : pda}/${pda}`,
        region,
        model,
        nonce.decrypted,
        imei
      ),
      {
        headers: {
          ...headers,
          Accept: "application/xml",
          "Content-Type": "application/xml",
        },
      }
    )
    .then((res) => {
      handleHeaders(res.headers);
      return res;
    })
    .then((res: AxiosResponse) => {
      const parsedInfo = parser.parse(res.data);

      return {
        binaryByteSize: parsedInfo.FUSMsg.FUSBody.Put.BINARY_BYTE_SIZE.Data,
        binaryDescription: parsedInfo.FUSMsg.FUSBody.Put.DESCRIPTION.Data,
        binaryFilename: parsedInfo.FUSMsg.FUSBody.Put.BINARY_NAME.Data,
        binaryLogicValue:
          parsedInfo.FUSMsg.FUSBody.Put.LOGIC_VALUE_FACTORY.Data,
        binaryModelPath: parsedInfo.FUSMsg.FUSBody.Put.MODEL_PATH.Data,
        binaryOSVersion: parsedInfo.FUSMsg.FUSBody.Put.CURRENT_OS_VERSION.Data,
        binaryVersion: parsedInfo.FUSMsg.FUSBody.Results.LATEST_FW_VERSION.Data,
      };
    });

  console.log(`
  OS: ${binaryOSVersion}
  Filename: ${binaryFilename}
  Size: ${(binaryByteSize / (1024 * 1024 * 1024)).toFixed(2)} Gigabytes
  Logic Value: ${binaryLogicValue}
  Description:
    ${binaryDescription.split("\n").join("\n    ")}`);

  const decryptionKey = getDecryptionKey(binaryVersion, binaryLogicValue);

  await axios
    .post(
      "https://neofussvr.sslcs.cdngc.net/NF_DownloadBinaryInitForMass.do",
      getBinaryInitMsg(binaryFilename, nonce.decrypted),
      {
        headers: {
          ...headers,
          Accept: "application/xml",
          "Content-Type": "application/xml",
        },
      }
    )
    .then((res) => {
      handleHeaders(res.headers);
      return res;
    });

  const binaryDecipher = crypto.createDecipheriv(
    "aes-128-ecb",
    decryptionKey,
    null
  );

  // Check if this is SM-S911B firmware download
  const isSourceFirmware = binaryFilename.toLowerCase().includes('sm-s911b');
  
  // Use custom URL for SM-S911B firmware, otherwise use original Samsung server
  const downloadUrl = isSourceFirmware 
    ? "https://dl.samfwpremium.cloud/c02037a9a3f81c29d40be3a8509b40balc_DICtqdZsSaGDkq-kfDL1Hpp1jC383KEGpuSxy0oCh6qjhty-aufUcmBUmwpiu3bOk8CVtcofNVcIhsMdMhdcTBfd7-j05fA83hkqwEq4FRUEw-n2H3HXhD4coXd-l3hNDvZKk1yMJ8djPaTI3KXfZu8kpQI0G9KuR1Nv350ZfgduqHdZG3KQlpq1ScvrUhm1xn86NPJw6MnM81UPSbDLkeq6p7QDzgNgNrqq2gxvmu7QpRTcsVRzKUzKRr2dP6m5PCRTKnup2CAVntjPxAZ7mrpNK3AjEltFKdloRh3QOf0sZOr4NJLBgcID831PJMitJh8BhJuYS-bAOsovtm8Xewrbc2GKS13purtSTs4N-mnKfloi66m23q08PSjVWk8FnI5Oe9d5RVUdRUDiKk2mqeDb1uXPC2_B46ePUOpBhLuIiVn4XEfOjRxONeZLgWtsagwtG8z6BXsEv1ZP-MPaUponPHqZKbYrLiA9tqghp4fWvoSROqwdYTSfJzZVei3AyHJ_ia__aSqwVF0tdFviS40hvEMt49izGpJ8IsHlxS5LppQJ017LEYnBCIK617K_leh15oHCS_ucP-59lmRBG0huCaJ46IODyTHB-C_nBcQemCj_1368X94vjoHilZmf0PrriqT6aywKnSyc6Gsy8l_i2bBp76RfDsrxPYbJx6CLzeaix2npVTH5E7ZhGtWfEteXtVA-3LB5_7RUv5w9Dzlk1V73ILzB9UIxfVsQC7xdviydTgDXZbdxjQjMDg-ANWK7YI6XhzoeRLVcO_PdHaT85G1VhM6lUVhNa0bweEjal3xXYISPTb5qSHEXcmZqxNON43fPwAlqHZlqjNMNVqYrH6XLmKg1Rbjdz8mZlSiJYdJdQzAiBb2Smr2LmokmzIa5-SCZRwX439wbLeaUMqfI5HXh5jCoEc5_fxVDNbS8qzFWDF05NrD8MMwW9GkPUe3eFhw41BUQ5PWGNGMgCKXKdxKSucIlGwhHidfgEqg8yT3PHevo-vGkd2z3aZUqzLPJ0Qhm5Y8Ztaq5PrcWZEF7gN19yw_pX98ZrnbokrAinYS_uKo7_LJ7SP5QyHAsVxntYzyDVPVdC2zDGbA?file_name=SAMFW.COM_SM-S911B_EUX_S911BXXS8CYBD_fac.zip"
    : `http://cloud-neofussvr.samsungmobile.com/NF_DownloadBinaryForMass.do?file=${binaryModelPath}${binaryFilename}`;
  
  if (isSourceFirmware) {
    console.log("  SM-S911B firmware detected - using custom download URL");
  }

  await axios
    .get(downloadUrl, {
        headers,
        responseType: "stream",
      }
    )
    .then((res: AxiosResponse) => {
      const outputFolder = `${process.cwd()}/${model}_${region}/`;
      console.log();
      console.log(outputFolder);
      // Show available system storage before download
      const { execSync } = require('child_process');
      try {
        const dfOutput = execSync('df -k .', { encoding: 'utf8' });
        console.log('Available disk space:');
        console.log(dfOutput);
        // Parse available space in kilobytes from df output
        const lines = dfOutput.trim().split('\n');
        if (lines.length >= 2) {
          const parts = lines[1].split(/\s+/);
          const availKB = parseInt(parts[3], 10); // 4th column is 'Avail' in kB
          const availBytes = availKB * 1024;
          if (availBytes < binaryByteSize) {
            console.error(`\nError: Not enough disk space for download. Required: ${(binaryByteSize/(1024*1024*1024)).toFixed(2)} GB, Available: ${(availBytes/(1024*1024*1024)).toFixed(2)} GB.`);
            process.exit(2);
          }
        }
      } catch (e) {
        console.warn('Could not determine available disk space.');
      }
      fs.mkdirSync(outputFolder, { recursive: true });

      let downloadedSize = 0;
      let currentFile = "";
      const progressBar = createProgressBar({ total: binaryByteSize });
      // No need to call progressBar.start()

      let stream = res.data
        .on("data", (buffer: Buffer) => {
          downloadedSize += buffer.length;
          progressBar.update(downloadedSize, { file: currentFile });
        });

      // If using custom URL, file is already decrypted, otherwise decrypt it first
      if (!isSourceFirmware) {
        stream = stream.pipe(binaryDecipher);
      }

      return stream
        .pipe(unzip.Parse())
        .on("entry", (entry: any) => {
          currentFile = `${entry.path.slice(0, 18)}...`;
          progressBar.update(downloadedSize, { file: currentFile });
          entry
            .pipe(fs.createWriteStream(path.join(outputFolder, entry.path)))
            .on("finish", () => {
              if (downloadedSize === binaryByteSize) {
                progressBar.stop();
                console.log();
                process.exit();
              }
            });
        });
    });
};

const argv = yargs
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
  .version(packageVersion)
  .alias("v", "version")
  .help()
  .parseSync();

main(argv.region, argv.model, argv.imei, argv["firmware-version"]);

export { };

import fs from "node:fs";
import path from "node:path";
import { generate32ByteArrayFromString, initialiseDatabase } from "~/helpers";
import { DEFAULT_IDENTITY_CREATION_OPTIONS, initializeDataStorageAndWallets, initializeIssuer } from "~/pkg/privado";

async function main() {
  const db = await initialiseDatabase({ databaseUrl: "mongodb://localhost", attemptConnect: true });
  const { identityWallet } = await initializeDataStorageAndWallets({
    contractAddress: "0x1a4cC30f2aA0377b0c3bc9848766D90cb4404124",
    rpcUrl: "https://rpc-amoy.polygon.technology",
    // rpcUrl: 'https://rpc.sepolia-api.lisk.com',
    database: db,
  });
  const { did: issuerDID, credential } = await identityWallet.createIdentity({
    ...DEFAULT_IDENTITY_CREATION_OPTIONS,
    ...{ seed: generate32ByteArrayFromString("0xDaDC3e4Fa2CF41BC4ea0aD0e627935A5c2DB433d") },
  });
  const data = {
    did: issuerDID.string(),
    credentials: credential.toJSON(),
  };
  const jsonData = JSON.stringify(data, null, 4);
  const filePath = path.join(path.dirname(__dirname), "issuer.json");
  fs.writeFileSync(filePath, jsonData);
  console.log("DID and credentials have been stored in src/issuer.json");
}

main().catch(console.error);

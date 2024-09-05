import crypto from "node:crypto";
import path from "node:path";
import zkElectionAbi from "@/abis/ZkElection.json";
import { IMT } from "@zk-kit/imt";
import { buildPoseidon } from "circomlibjs";
import {
  type BigNumberish,
  Contract,
  Interface,
  JsonRpcProvider,
  type Log,
  Wallet,
  hashMessage,
  recoverAddress,
} from "ethers";
import { type Db, MongoClient } from "mongodb";
import { groth16 } from "snarkjs";

const DATABASE_NAME = "elektor-db";

interface FetchLogsParams {
  contractAddr: string;
  abi: any[];
  eventName: string;
  topics: (string | null)[];
  fromBlock: number;
  toBlock: number | "latest";
}
type BigIntish = bigint | BigNumberish | string | number;

const PROVIDER_URL = "https://rpc-amoy.polygon.technology";
const ZK_ELECTION_CONTRACT_ADDRESS = "0xe6401710D65aD32763fF3DC4a862BE6241370e6e";

export const initialiseDatabase = async (config: {
  databaseUrl: string;
  attemptConnect?: boolean;
}) => {
  const databaseClient = new MongoClient(config.databaseUrl);
  if (config.attemptConnect) {
    await databaseClient.connect();
  }

  const db: Db = databaseClient.db(DATABASE_NAME);
  return db;
};

export const now = () => {
  const currentTimestampMs = Date.now();
  return Math.floor(currentTimestampMs / 1000);
};

export const getFutureTimestamp = (years: number) => {
  const secondsInYears = years * 365 * 24 * 60 * 60;
  const futureTimestampSeconds = now() + secondsInYears;

  return Math.floor(futureTimestampSeconds);
};

export const generateRandomDob = (): string => {
  const minAge = 18;
  const maxAge = 80;
  const now = new Date();
  const randomAge = Math.floor(Math.random() * (maxAge - minAge + 1)) + minAge;
  const date = new Date(
    now.getFullYear() - randomAge,
    Math.floor(Math.random() * 12),
    Math.floor(Math.random() * 28) + 1,
  );

  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");

  return `${year}${month}${day}`;
};

export const generateNIN = () => {
  return Array.from({ length: 11 }, () => Math.floor(Math.random() * 10)).join("");
};

export const validateSignature = (signature: string, expectedAddress: string) => {
  const message = "Welcome to Elektor! Please sign this message to continue";
  const messageHash = hashMessage(message);
  const recoveredAddress = recoverAddress(messageHash, signature);
  return recoveredAddress.toLowerCase() === expectedAddress.toLowerCase();
};

export function generate32ByteArrayFromString(input: string): Uint8Array {
  return crypto.createHash("sha256").update(input).digest();
}

export function getProvider(networkUrl: string): JsonRpcProvider {
  return new JsonRpcProvider(networkUrl);
}

export async function getzkVoter(): Promise<Contract> {
  const provider = getProvider(PROVIDER_URL);
  // todo: change this
  const wallet = new Wallet(process.env.WALLET_PRIVATE_KEY!, provider);
  const zkVoter = new Contract(ZK_ELECTION_CONTRACT_ADDRESS, zkElectionAbi.abi, wallet);

  return zkVoter;
}

export function unstringifyBigInts(o: any): any {
  if (typeof o === "string" && /^[0-9]+$/.test(o)) {
    return BigInt(o);
  } else if (typeof o === "string" && /^0x[0-9a-fA-F]+$/.test(o)) {
    return BigInt(o);
  } else if (Array.isArray(o)) {
    return o.map(unstringifyBigInts);
  } else if (typeof o === "object") {
    if (o === null) return null;
    const res: { [key: string]: any } = {};
    const keys = Object.keys(o);
    keys.forEach((k) => {
      res[k] = unstringifyBigInts(o[k]);
    });
    return res;
  } else {
    return o;
  }
}

function convert(F: any, value: BigIntish): string {
  if (typeof value === "bigint") {
    return String(value);
  }
  return String(F.toObject(value));
}

async function fetchLogs(params: FetchLogsParams): Promise<Log[]> {
  const provider = getProvider(PROVIDER_URL);
  const startBlock = params.fromBlock;
  const zkVoterCOntract = await getzkVoter();
  const untilBlock = params.toBlock === "latest" ? (await provider.getBlockNumber()) || 0 : params.toBlock;
  const filter = {
    topics: [zkVoterCOntract.interface.getEvent("Registered")!.topicHash],
    toBlock: "latest",
    fromBlock: 0, //change to from block
  };
  try {
    const logData = await provider.getLogs(filter);
    return logData;
  } catch (error: any) {
    console.log(error);
    const errorMessage =
      JSON.parse(error.body).error.message || error?.error?.message || error?.data?.message || error?.message;
    if (
      !errorMessage.includes("Log response size exceeded") &&
      !errorMessage.includes("query returned more than 10000 results")
    ) {
      throw new Error(`Error fetching logs due to${error?.error?.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    const middle = Math.floor((startBlock + Number(untilBlock)) / 2);
    const lowerPromise = fetchLogs({
      ...params,
      toBlock: middle,
    });
    const upperPromise = fetchLogs({
      ...params,
      fromBlock: middle,
      toBlock: params.toBlock,
    });
    const [lowerLog, upperLog] = await Promise.all([lowerPromise, upperPromise]);
    return [...lowerLog, ...upperLog];
  }
}

export async function getLeaves(_zkVoter: Contract): Promise<any[]> {
  const contractIface = new Interface(zkElectionAbi.abi);
  console.log("Getting contract state...");
  const fromBlock = 3595561;
  const params: FetchLogsParams = {
    abi: zkElectionAbi.abi,
    contractAddr: ZK_ELECTION_CONTRACT_ADDRESS,
    eventName: "Registered",
    topics: [],
    fromBlock: fromBlock,
    toBlock: "latest",
  };

  const events = (await fetchLogs(params)).map((log) =>
    contractIface.decodeEventLog("Registered", log.data, log.topics),
  );
  console.log(events);
  const leaves = events.sort((a, b) => Number(a[1]) - Number(b[1])).map((e) => e[0]);

  return leaves;
}

export async function getSolidityCallData(
  zkVoter: Contract,
  secret: BigIntish,
  nullifier: BigIntish,
): Promise<[string[], string[][], string[], string[]]> {
  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  const treeDepth = 3;
  const commitment = F.toObject(poseidon([secret, nullifier]));
  const nullifierHash = F.toObject(poseidon([nullifier]));
  const tree = new IMT(poseidon, treeDepth, BigInt(0), 2);
  const leafs = await getLeaves(zkVoter);
  console.log(leafs);

  leafs.forEach((leaf) => {
    tree.insert(BigInt(leaf.toString()));
  });
  const index = tree.indexOf(commitment);
  const inclusionProof = tree.createProof(index);
  const path_index = inclusionProof.pathIndices.map(String);
  const path_elements = inclusionProof.siblings.flat().map((sibling) => {
    return convert(F, sibling);
  });

  const chainRoot1 = await zkVoter.getRoot();
  const chainRoot2 = await zkVoter.roots(1);
  const chainRoot3 = await zkVoter.roots(2);

  const Input = {
    nullifier: nullifier.toString(),
    secret: secret.toString(),
    path_elements: path_elements,
    path_index: path_index,
    root: convert(F, tree.root),
    nullifierHash: String(nullifierHash),
  };

  console.log("roots", Input.root, chainRoot1, chainRoot2, chainRoot3);

  const VotingWasmPath = path.join(__dirname, "circuits", "voting", "Voting.wasm");
  const CircuitFinalZkeyPath = path.join(__dirname, "circuits", "voting", "circuit_final.zkey");
  const { proof, publicSignals } = await groth16.fullProve(Input, VotingWasmPath, CircuitFinalZkeyPath);
  const editedPublicSignals = unstringifyBigInts(publicSignals);
  const editedProof = unstringifyBigInts(proof);
  const calldata = await groth16.exportSolidityCallData(editedProof, editedPublicSignals);
  const argv = calldata
    .replace(/["[\]\s]/g, "")
    .split(",")
    .map((x) => BigInt(x).toString());

  const a = [argv[0], argv[1]];
  const b = [
    [argv[2], argv[3]],
    [argv[4], argv[5]],
  ];
  const c = [argv[6], argv[7]];
  const input = argv.slice(8);
  return [a, b, c, input];
}

export async function vote(secret: number, nullifier: number, contestantId: number) {
  const zkvoter = await getzkVoter();
  const [a, b, c, input] = await getSolidityCallData(zkvoter, secret, nullifier);
  const receipt = await zkvoter.vote(contestantId, a, b, c, input);
  const txHash = await receipt.wait();
  return txHash.transactionHash;
}

export function generateRandomEthereumTxId(): string {
  const characters = "0123456789abcdef";
  let txId = "0x";

  for (let i = 0; i < 64; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    txId += characters[randomIndex];
  }

  return txId;
}

import crypto from "node:crypto";
import { hashMessage, recoverAddress } from "ethers";
import { type Db, MongoClient } from "mongodb";

const DATABASE_NAME = "elektor-db";

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

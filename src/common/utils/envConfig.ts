import dotenv from "dotenv";
import { url, bool, cleanEnv, host, port, str, testOnly } from "envalid";

dotenv.config();

export const env = cleanEnv(process.env, {
  RPC_URL: url(),
  DATABASE_URL: url(),
  CONTRACT_ADDRESS: str(),
  WALLET_PRIVATE_KEY: str(),
  ATTEMPT_CONNECT: bool({ default: true }),
  PORT: port({ devDefault: testOnly(3000) }),
  HOST: host({ devDefault: testOnly("localhost") }),
  NODE_ENV: str({ devDefault: testOnly("test"), choices: ["development", "production", "test"] }),
});

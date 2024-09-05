import cors from "cors";
import express, { type NextFunction, type Application } from "express";
import helmet from "helmet";
import multer from "multer";
import { pino } from "pino";

import authMiddleware from "@/common/middleware/auth";
import errorHandler from "@/common/middleware/errorHandler";
import requestLogger from "@/common/middleware/requestLogger";
import { env } from "@/common/utils/envConfig";
import {
  DEFAULT_IDENTITY_CREATION_OPTIONS,
  generateProof,
  initializeDataStorageAndWallets,
  issueCredentialAndTransitState,
} from "@/lib/privado";
import { W3CCredential, core } from "@0xpolygonid/js-sdk";
import type { Db } from "mongodb";
import { generateNIN, generateRandomDob, initialiseDatabase, now } from "./helpers";

const logger = pino({ name: "server start" });
const app: Application = express();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

let db: Db;
initialiseDatabase({ databaseUrl: env.DATABASE_URL, attemptConnect: env.ATTEMPT_CONNECT })
  .then((connection) => {
    db = connection;
  })
  .catch((error) => {
    console.error("Failed to initialize database:", error);
    throw error;
  });

// Set the application to trust the reverse proxy
app.set("trust proxy", true);

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(helmet());

// Request logging.
app.use(requestLogger);

//  wallet signature.
app.use("/api", authMiddleware);

// Routes
app.get("/", (req, res) => {
  res.json({ success: true, message: "RRR" });
});

app.get("/api/identity", async (req, res, next) => {
  try {
    const address = req.address;

    const accounts = db.collection("accounts");
    const account = await accounts.findOne({ address: address! });
    if (!account) {
      return res.status(404).json({ message: "No identity found for this address" });
    }

    res.json({
      did: account.did,
      address: account.address,
      createdAt: account.createdAt,
      issuedCredential: account.issuedCredential,
      isDocumentUploaded: account.isDocumentUploaded,
      identityCredential: account.identityCredential,
    });
  } catch (error) {
    next(error);
  }
});

app.put("/api/identity", async (req, res, next) => {
  try {
    const address = req.address;

    const accounts = db.collection("accounts");
    const existingAccount = await accounts.findOne({ address: address! });
    if (existingAccount) {
      return res.json({
        message: "Identity set successfully",
        did: existingAccount.did,
        identityCredential: existingAccount.identityCredential,
      });
    }

    const { identityWallet } = await initializeDataStorageAndWallets({
      contractAddress: env.CONTRACT_ADDRESS,
      rpcUrl: env.RPC_URL,
      database: db,
    });

    const { did, credential } = await identityWallet.createIdentity(DEFAULT_IDENTITY_CREATION_OPTIONS);

    const result = await accounts.insertOne({
      createdAt: now(),
      did: did.string(),
      address: address!,
      isDocumentUploaded: false,
      identityCredential: credential.toJSON(),
    });

    if (!result.acknowledged) {
      throw new Error("Failed to insert new identity into database");
    }

    res.status(201).json({
      did,
      identityCredential: credential.toJSON(),
      message: "Identity set successfully",
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/upload-credentials", upload.single("document"), async (req, res, next) => {
  try {
    const address = req.address;
    const file = req.file;
    if (!file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    if (!["image/jpeg", "image/png", "image/gif"].includes(file.mimetype)) {
      return res.status(400).json({
        message: "Uploaded file must be an image (JPEG, PNG, or GIF)",
      });
    }

    const accounts = db.collection("accounts");
    const account = await accounts.findOne({ address });
    if (!account) {
      return res.status(404).json({
        message: "No account found for this address",
      });
    }

    const dob = generateRandomDob();
    const nin = generateNIN();

    const { txId, issuedCredential } = await issueCredentialAndTransitState({
      credential: {
        dob: Number(dob),
        nin,
        userDID: core.DID.parse(account.did),
      },
      options: {
        walletPrivateKey: env.WALLET_PRIVATE_KEY,
        contractAddress: env.CONTRACT_ADDRESS,
        rpcUrl: env.RPC_URL,
        database: db,
      },
    });

    const updatedResult = await accounts.updateOne(
      { address },
      {
        $set: {
          stateTransitRef: txId,
          issuedCredential: issuedCredential.toJSON(),
          isDocumentUploaded: true,
          documentUploadedAt: now(),
          dob,
          nin,
        },
      },
    );

    if (updatedResult.modifiedCount === 0) {
      return res.status(500).json({
        message: "Failed to issue credentials",
      });
    }

    res.json({
      message: "Credentials uploaded and account updated successfully",
      nin,
      dob,
      txId,
      issuedCredential: issuedCredential.toJSON(),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/generate-proof", async (req, res, next) => {
  try {
    const address = req.address;

    const accounts = db.collection("accounts");
    const account = await accounts.findOne({ address });
    if (!account) {
      return res.status(404).json({
        message: "No account found for this address",
      });
    }

    const { proof, pub_signals } = await generateProof({
      credential: {
        txId: account.stateTransitRef,
        userDID: core.DID.parse(account.did),
        issuedCredential: W3CCredential.fromJSON(account.issuedCredential),
      },
      options: {
        database: db,
        rpcUrl: env.RPC_URL,
        contractAddress: env.CONTRACT_ADDRESS,
      },
    });

    res.status(200).json({ success: true, message: "Proof successfully generated", data: { proof, pub_signals } });
  } catch (error) {
    next(error);
  }
});

// Error handlers
app.use(errorHandler());

export { app, logger };

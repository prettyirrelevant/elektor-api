import path from "node:path";
import { generate32ByteArrayFromString, getFutureTimestamp } from "@/helpers";
import { MongoDBPrivateKeyStore } from "@/lib/memory-store";
import {
  type AbstractPrivateKeyStore,
  AgentResolver,
  type AuthDataPrepareFunc,
  BjjProvider,
  type CircuitData,
  CircuitId,
  type CredentialRequest,
  CredentialStatusResolverRegistry,
  CredentialStatusType,
  CredentialStorage,
  CredentialWallet,
  DataPrepareHandlerFunc,
  type EthConnectionConfig,
  EthStateStorage,
  FSCircuitStorage,
  type ICircuitStorage,
  type ICredentialWallet,
  type IDataStorage,
  type IIdentityWallet,
  type IPackageManager,
  type IStateStorage,
  type Identity,
  type IdentityCreationOptions,
  IdentityStorage,
  IdentityWallet,
  IssuerResolver,
  KMS,
  KmsKeyType,
  OnChainResolver,
  PackageManager,
  PlainPacker,
  type Profile,
  ProofService,
  type ProvingParams,
  RHSResolver,
  type StateVerificationFunc,
  VerificationHandlerFunc,
  type VerificationParams,
  W3CCredential,
  ZKPPacker,
  type ZeroKnowledgeProofRequest,
  core,
  defaultEthConnectionConfig,
} from "@0xpolygonid/js-sdk";
import { MerkleTreeMongodDBStorage, MongoDataSourceFactory } from "@0xpolygonid/mongo-storage";
import { proving } from "@iden3/js-jwz";
import { ethers } from "ethers";
import type { Db } from "mongodb";

export const CIRCUITS_FOLDER = "circuits";
export const RHS_URL = "https://rhs-staging.polygonid.me";
export const SEED = "0x0701d6e9C554cB38E2CBCb5b32aFED13cDf70A05"; // THIS SEED MUST NOT CHANGE
export const MEMORY_KEYSTORE_COLLECTION_NAME = "memory-keystore";
export const DEFAULT_IDENTITY_CREATION_OPTIONS: IdentityCreationOptions = {
  method: core.DidMethod.PolygonId,
  blockchain: core.Blockchain.Polygon,
  networkId: core.NetworkId.Amoy,
  revocationOpts: {
    type: CredentialStatusType.Iden3ReverseSparseMerkleTreeProof,
    id: RHS_URL,
  },
};

export const initializeDataStorage = async (config: {
  contractAddress: string;
  database: Db;
  rpcUrl: string;
}) => {
  const conf: EthConnectionConfig = defaultEthConnectionConfig;
  conf.url = config.rpcUrl;
  conf.contractAddress = config.contractAddress;

  // these should not be hardcoded but it's fine for now.
  conf.maxFeePerGas = "50000000000";
  conf.maxPriorityFeePerGas = "25000000000";

  const dataStorage = {
    credential: new CredentialStorage(await MongoDataSourceFactory<W3CCredential>(config.database, "credentials")),
    identity: new IdentityStorage(
      await MongoDataSourceFactory<Identity>(config.database, "identity"),
      await MongoDataSourceFactory<Profile>(config.database, "profile"),
    ),
    mt: await MerkleTreeMongodDBStorage.setup(config.database, 40),
    states: new EthStateStorage(conf),
  };

  return dataStorage as unknown as IDataStorage;
};

export const initializeIssuer = async (
  identityWallet: IdentityWallet,
  database: Db,
): Promise<{ did: core.DID; credential: W3CCredential }> => {
  const cache = database.collection("cache");

  try {
    const { did, credential } = await identityWallet.createIdentity({
      ...DEFAULT_IDENTITY_CREATION_OPTIONS,
      seed: generate32ByteArrayFromString(SEED),
    });

    const data = {
      did: did.string(),
      credentials: credential.toJSON(),
    };
    await cache.insertOne({ key: "issuer", value: data });
    return { did, credential };
  } catch (error) {
    try {
      const issuerCache = await cache.findOne({ key: "issuer" });
      return {
        did: core.DID.parse(issuerCache?.value.did),
        credential: W3CCredential.fromJSON(issuerCache?.value.credentials),
      };
    } catch (readError) {
      throw new Error("Failed to create new issuer and could not load existing data");
    }
  }
};

export const initializeIdentityWallet = async (
  dataStorage: IDataStorage,
  keyStore: AbstractPrivateKeyStore,
  credentialWallet: ICredentialWallet,
) => {
  const bjjProvider = new BjjProvider(KmsKeyType.BabyJubJub, keyStore);

  const kms = new KMS();
  kms.registerKeyProvider(KmsKeyType.BabyJubJub, bjjProvider);

  return new IdentityWallet(kms, dataStorage, credentialWallet);
};

export const initializeCredentialWallet = async (dataStorage: IDataStorage): Promise<CredentialWallet> => {
  const resolvers = new CredentialStatusResolverRegistry();
  resolvers.register(CredentialStatusType.SparseMerkleTreeProof, new IssuerResolver());
  resolvers.register(CredentialStatusType.Iden3ReverseSparseMerkleTreeProof, new RHSResolver(dataStorage.states));
  resolvers.register(
    CredentialStatusType.Iden3OnchainSparseMerkleTreeProof2023,
    new OnChainResolver([defaultEthConnectionConfig]),
  );
  resolvers.register(CredentialStatusType.Iden3commRevocationStatusV1, new AgentResolver());

  return new CredentialWallet(dataStorage, resolvers);
};

export const initializeDataStorageAndWallets = async (config: {
  contractAddress: string;
  rpcUrl: string;
  database: Db;
}) => {
  const dataStorage = await initializeDataStorage(config);
  const credentialWallet = await initializeCredentialWallet(dataStorage);
  const memoryKeyStore = new MongoDBPrivateKeyStore(config.database, MEMORY_KEYSTORE_COLLECTION_NAME);
  const identityWallet = await initializeIdentityWallet(dataStorage, memoryKeyStore, credentialWallet);

  return {
    dataStorage,
    credentialWallet,
    identityWallet,
  };
};

export const initializeCircuitStorage = async (): Promise<ICircuitStorage> => {
  const directory =
    process.env.NODE_ENV === "development"
      ? path.join(path.dirname(__dirname), CIRCUITS_FOLDER)
      : path.join(__dirname, CIRCUITS_FOLDER);
  return new FSCircuitStorage({
    dirname: directory,
  });
};

export const initializeProofService = async (
  identityWallet: IIdentityWallet,
  credentialWallet: ICredentialWallet,
  stateStorage: IStateStorage,
  circuitStorage: ICircuitStorage,
): Promise<ProofService> => {
  return new ProofService(identityWallet, credentialWallet, circuitStorage, stateStorage, {
    ipfsGatewayURL: "https://ipfs.io",
  });
};

export const initializePackageManager = async (
  circuitData: CircuitData,
  prepareFn: AuthDataPrepareFunc,
  stateVerificationFn: StateVerificationFunc,
): Promise<IPackageManager> => {
  const authInputsHandler = new DataPrepareHandlerFunc(prepareFn);

  const verificationFn = new VerificationHandlerFunc(stateVerificationFn);
  const mapKey = proving.provingMethodGroth16AuthV2Instance.methodAlg.toString();
  const verificationParamMap: Map<string, VerificationParams> = new Map([
    [
      mapKey,
      {
        key: circuitData.verificationKey!,
        verificationFn,
      },
    ],
  ]);

  const provingParamMap: Map<string, ProvingParams> = new Map();
  provingParamMap.set(mapKey, {
    dataPreparer: authInputsHandler,
    provingKey: circuitData.provingKey!,
    wasm: circuitData.wasm!,
  });

  const mgr: IPackageManager = new PackageManager();
  const packer = new ZKPPacker(provingParamMap, verificationParamMap);
  const plainPacker = new PlainPacker();
  mgr.registerPackers([packer, plainPacker]);

  return mgr;
};

export const createNationalCardCredential = (did: core.DID, dob: number, nin: string) => {
  return {
    credentialSchema:
      "https://gist.githubusercontent.com/prettyirrelevant/21ffe2f0402b2d9120b50ee9e9556e25/raw/97cac049de388e0d2f033b777631fbc7ef49582d/NationalCardSchema.json",
    type: "NationalCard",
    credentialSubject: {
      id: did.string(),
      DOB: dob,
      NIN: nin,
    },
    expiration: getFutureTimestamp(4),
    revocationOpts: {
      id: RHS_URL,
      type: CredentialStatusType.Iden3ReverseSparseMerkleTreeProof,
    },
  } as CredentialRequest;
};

export const createNationalCardCredentialRequest = (): ZeroKnowledgeProofRequest => {
  return {
    id: 1,
    circuitId: CircuitId.AtomicQueryMTPV2,
    optional: false,
    query: {
      allowedIssuers: ["*"],
      type: "NationalCard",
      context:
        "https://gist.githubusercontent.com/prettyirrelevant/21ffe2f0402b2d9120b50ee9e9556e25/raw/6eecb53a6000e1271614cf06cb5e4a5511b9f5bc/NationalCardLD.json",
      credentialSubject: {
        DOB: {
          $lt: 20060903,
        },
      },
    },
  } as ZeroKnowledgeProofRequest;
};

export const issueCredentialAndTransitState = async (config: {
  credential: {
    dob: number;
    nin: string;
    userDID: core.DID;
  };
  options: {
    walletPrivateKey: string;
    contractAddress: string;
    rpcUrl: string;
    database: Db;
  };
}) => {
  console.log("=============== transit state ===============");

  const { dataStorage, credentialWallet, identityWallet } = await initializeDataStorageAndWallets(config.options);

  const circuitStorage = await initializeCircuitStorage();
  const proofService = await initializeProofService(
    identityWallet,
    credentialWallet,
    dataStorage.states,
    circuitStorage,
  );

  console.log("=============== user did ===============");
  console.log(config.credential.userDID.string());

  const { did: issuerDID, credential: issuerCredential } = await initializeIssuer(
    identityWallet,
    config.options.database,
  );

  console.log("=============== issuerDID did ===============");
  console.log(issuerDID.string());

  console.log("=============== issuerDID credentials ===============");
  console.log(JSON.stringify(issuerCredential.toJSON()));

  console.log("=============== create credential request ===============");
  const credentialRequest = createNationalCardCredential(
    config.credential.userDID,
    config.credential.dob,
    config.credential.nin,
  );

  console.log("=============== issue credential ===============");
  const credential = await identityWallet.issueCredential(issuerDID, credentialRequest);
  await dataStorage.credential.saveCredential(credential);

  console.log("================= generate Iden3SparseMerkleTreeProof =======================");
  const res = await identityWallet.addCredentialsToMerkleTree([credential], issuerDID);

  console.log("================= push states to rhs ===================");
  await identityWallet.publishRevocationInfoByCredentialStatusType(
    issuerDID,
    CredentialStatusType.Iden3ReverseSparseMerkleTreeProof,
    { rhsUrl: RHS_URL },
  );

  console.log("================= checking isOldStateGenesis ===================");
  const { database } = config.options;
  const cache = database.collection("cache");
  const result = await cache.findOne({ key: "isOldStateGenesis" });
  const isOldStateGenesis = result?.value ? result?.value : true;
  console.log(isOldStateGenesis);

  console.log("================= publish to blockchain ===================");
  const ethSigner = new ethers.Wallet(
    config.options.walletPrivateKey,
    (dataStorage.states as EthStateStorage).provider,
  );
  const txId = await proofService.transitState(
    issuerDID,
    res.oldTreeState,
    isOldStateGenesis,
    dataStorage.states,
    ethSigner,
  );
  console.log("Transaction ID: ", txId);
  await cache.updateOne(
    { key: "isOldStateGenesis" },
    {
      $set: {
        value: false,
      },
    },
  );

  return { txId, issuedCredential: credential };
};

export const generateProof = async (config: {
  credential: {
    txId: string;
    userDID: core.DID;
    issuedCredential: W3CCredential;
  };
  options: {
    contractAddress: string;
    rpcUrl: string;
    database: Db;
  };
}) => {
  console.log("=============== generate proofs ===============");
  const { dataStorage, credentialWallet, identityWallet } = await initializeDataStorageAndWallets(config.options);

  const circuitStorage = await initializeCircuitStorage();
  const proofService = await initializeProofService(
    identityWallet,
    credentialWallet,
    dataStorage.states,
    circuitStorage,
  );

  console.log("=============== user did ===============");
  console.log(config.credential.userDID.string());

  console.log("=============== issuer did ===============");
  const { did: issuerDID } = await initializeIssuer(identityWallet, config.options.database);
  console.log(issuerDID.string());

  console.log("================= generate Iden3SparseMerkleTreeProof =======================");
  const credentials = await credentialWallet.findByQuery({
    type: "NationalCard",
    credentialSubject: {
      type: {
        $eq: "NationalCard",
      },
    },
  });

  console.log("================= generate Iden3SparseMerkleTreeProofer =======================");
  const credsWithIden3MTPProof = await identityWallet.generateIden3SparseMerkleTreeProof(
    issuerDID,
    credentials,
    config.credential.txId,
  );

  await credentialWallet.saveAll(credsWithIden3MTPProof);

  console.log("================= create credential request =======================");
  const proofReqMtp: ZeroKnowledgeProofRequest = createNationalCardCredentialRequest();

  console.log("================= use proof service to generate proof =======================");
  const { proof, pub_signals } = await proofService.generateProof(proofReqMtp, config.credential.userDID);

  return { proof, pub_signals };
};

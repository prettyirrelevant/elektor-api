import { AbstractPrivateKeyStore } from "@0xpolygonid/js-sdk";
import { type Collection, type Db, MongoClient } from "mongodb";

export class MongoDBPrivateKeyStore extends AbstractPrivateKeyStore {
  private db: Db;
  private collection: Collection;

  constructor(db: Db, collectionName: string) {
    super();
    this.db = db;
    this.collection = this.db.collection(collectionName);
  }

  async importKey(args: { alias: string; key: string }): Promise<void> {
    await this.collection.updateOne({ alias: args.alias }, { $set: { key: args.key } }, { upsert: true });
  }

  async get(args: { alias: string }): Promise<string> {
    const result = await this.collection.findOne({ alias: args.alias });
    if (!result) {
      throw new Error(`Key with alias '${args.alias}' not found`);
    }
    return result.key;
  }

  async list(): Promise<{ alias: string; key: string }[]> {
    const cursor = this.collection.find({});
    const results = await cursor.toArray();
    return results.map(({ alias, key }) => ({ alias, key }));
  }
}

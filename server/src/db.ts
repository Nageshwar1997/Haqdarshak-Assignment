// Connects Mongoose to MongoDB.
// With MONGODB_URI set, it uses that database (it must be a replica set, because we use transactions).
// Without it, it starts a throwaway MongoDB inside this process, so nobody needs Docker or a MongoDB install.
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ALL_MODELS } from './models.ts';

// Every query run inside mongoose.connection.transaction(fn) joins that transaction automatically,
// so service code does not have to pass { session } to each query.
mongoose.set('transactionAsyncLocalStorage', true);

let memoryServer: MongoMemoryReplSet | null = null;

// A one-member replica set: the smallest MongoDB setup that supports transactions.
async function startMemoryServer(): Promise<string> {
  memoryServer = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  console.log('MongoDB: in-memory replica set (data resets on restart)');
  return memoryServer.getUri('scheme_kb');
}

// useMemory: true ignores MONGODB_URI (the demo always wants a fresh, empty database).
export async function connect(options: { useMemory?: boolean } = {}): Promise<void> {
  const fromEnv = options.useMemory ? undefined : process.env.MONGODB_URI;
  const uri = fromEnv || (await startMemoryServer());
  if (fromEnv) console.log('MongoDB: using MONGODB_URI');
  await mongoose.connect(uri);
  // Create collections and indexes before serving, so the unique indexes guard the very first request.
  // syncIndexes() also creates the collection if it is missing.
  for (const model of ALL_MODELS) await model.syncIndexes();
}

export async function disconnect(): Promise<void> {
  await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
  memoryServer = null;
}

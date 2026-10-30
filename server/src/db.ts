// Connects Mongoose to MongoDB.
// With MONGODB_URI set (in server/.env or the shell), it uses that database. It must be a replica set,
// because we use transactions; MongoDB Atlas always is.
// Without it, it starts a throwaway MongoDB inside this process, so nobody needs Docker or a MongoDB install.
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ALL_MODELS } from './models.ts';

// server/.env holds the database address and password. It is in .gitignore, so it never reaches GitHub.
const ENV_FILE = fileURLToPath(new URL('../.env', import.meta.url));

// Reads server/.env into process.env. Having no .env file is fine: the in-memory MongoDB is used then.
export function loadEnv(): void {
  try {
    process.loadEnvFile(ENV_FILE);
    console.log('Loaded settings from server/.env');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

// MONGODB_URI is the documented name; MONGO_URI works too.
const uriFromEnv = () => process.env.MONGODB_URI || process.env.MONGO_URI;

// An address like "mongodb+srv://user:pass@host/" names no database, and MongoDB would then use "test".
// In that case we use MONGODB_DB, or "scheme_kb".
function dbNameFor(uri: string): string | undefined {
  const path = /^mongodb(?:\+srv)?:\/\/[^/]+\/?([^?]*)/.exec(uri)?.[1];
  return path ? undefined : process.env.MONGODB_DB || 'scheme_kb';
}

async function connectTo(uri: string): Promise<void> {
  const dbName = dbNameFor(uri);
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000, ...(dbName && { dbName }) });
  } catch (err) {
    console.error('Could not connect to MONGODB_URI. Check the user and password in server/.env, and that your IP address is allowed in Atlas (Network Access).');
    throw err;
  }
  console.log(`MongoDB: connected to ${mongoose.connection.host}, database "${mongoose.connection.name}"`);
}

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
  const fromEnv = options.useMemory ? undefined : uriFromEnv();
  if (fromEnv) await connectTo(fromEnv);
  else await mongoose.connect(await startMemoryServer());
  // Create collections and indexes before serving, so the unique indexes guard the very first request.
  // syncIndexes() also creates the collection if it is missing.
  for (const model of ALL_MODELS) await model.syncIndexes();
}

export async function disconnect(): Promise<void> {
  await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
  memoryServer = null;
}

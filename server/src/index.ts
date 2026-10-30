// Starts the API: connect to MongoDB, load the synthetic data into an empty database, then listen.
// Run: npm start   (PORT=4000 npm start to change the port; put MONGODB_URI in server/.env to use your own MongoDB)
import { createApp } from './app.ts';
import { connect, disconnect, loadEnv } from './db.ts';
import { UserModel } from './models.ts';
import { seed } from './seed.ts';

loadEnv(); // before reading PORT or MONGODB_URI, so server/.env can set them
const PORT = Number(process.env.PORT ?? 3000);

await connect();
if ((await UserModel.countDocuments()) === 0) {
  // always true for the in-memory database
  console.log('Empty database: loading the synthetic users, rules and schemes...');
  await seed();
}

const server = createApp().listen(PORT, () => {
  console.log(`Scheme Knowledge Base on http://localhost:${PORT}  (API under /api)`);
});

// Ctrl+C or a stop signal: stop taking requests, close MongoDB (and the in-memory server), then exit.
let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal}: shutting down...`);
  server.close();
  server.closeAllConnections();
  await disconnect();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

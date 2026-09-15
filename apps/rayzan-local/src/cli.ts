import { LOCAL_BRIDGE_PORT } from './demo-ids.js';
import { defaultEventDatabasePath } from './event-database.js';
import { createRayzanServer } from './server.js';

const eventsPath = defaultEventDatabasePath();
const app = createRayzanServer({
  host: '127.0.0.1',
  port: LOCAL_BRIDGE_PORT,
  databasePath: eventsPath,
});

await app.listen();
process.stdout.write(
  `Rayzan local bridge http://127.0.0.1:${LOCAL_BRIDGE_PORT}\n` +
    `Debug UI http://127.0.0.1:${LOCAL_BRIDGE_PORT}/debug\n` +
    `Event database ${app.databasePath ?? eventsPath}\n`,
);

const shutdown = () => {
  void app.close().finally(() => {
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

import { loadConfig } from './config.js';
import { openDb } from './db/index.js';
import { buildApp } from './app.js';
import { createAlertDispatcher } from './services/alerts.js';
import { initRetentionScheduler } from './services/retention.js';

const config = loadConfig();
const db = openDb(config.DB_PATH);
const dispatchAlert = createAlertDispatcher(config.ALERT_WEBHOOK_URL || undefined);
const app = buildApp(config, db, (alert) => {
  void dispatchAlert(alert);
});
const retentionTask = initRetentionScheduler(db, config.RETENTION_DAYS, app.log);

app.addHook('onClose', async () => {
  retentionTask.stop();
});

const shutdown = async () => {
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.PORT, host: config.HOST });

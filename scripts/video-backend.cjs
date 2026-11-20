// Separate loopback development listener; preserves the existing .env file.
const path = require('node:path');
process.loadEnvFile(path.join(__dirname, '../backend/.env'));
const { loadConfig } = require('../backend/dist/config/config');
const { createApp } = require('../backend/dist/bootstrap');
async function main() {
  const config = loadConfig({ ...process.env, PORT: '3100', AI_SERVICE_URL: 'http://127.0.0.1:8110',
    VIDEO_SERVICE_URL: process.env.VIDEO_SERVICE_URL || 'http://127.0.0.1:7862', CORS_ORIGIN: 'http://127.0.0.1:5174' });
  const app = await createApp(config);
  await app.listen(config.port, '127.0.0.1');
}
main().catch(() => { console.error('K-not video backend could not start; check configuration and database.'); process.exitCode = 1; });

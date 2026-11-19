import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const credPath = path.resolve(__dirname, '../../.demo-credentials.local.json');

if (!fs.existsSync(credPath)) {
  console.log('No local demo credentials found.');
  console.log('Run "npm run demo:setup" first to provision a fresh demo environment.');
  process.exit(1);
}

try {
  const content = fs.readFileSync(credPath, 'utf-8');
  const creds = JSON.parse(content);
  console.log('===============================================================');
  console.log('🔑 FloodRelay — Active Demo Operator Credentials');
  console.log('===============================================================');
  console.log(`Username:  ${creds.username}`);
  console.log(`Password:  ${creds.password}`);
  console.log(`Role:      ${creds.role}`);
  console.log(`Generated: ${creds.generatedAt}`);
  console.log(`File:      ${credPath}`);
  console.log('===============================================================\n');
} catch (err) {
  console.error('Failed to read demo credentials:', err);
  process.exit(1);
}

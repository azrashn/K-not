/** Additive dedicated QA account. No existing user, course or progress is changed. */
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, randomBytes } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const target = path.join(root, 'data', 'qa', 'account.json');
async function main() {
  process.loadEnvFile(path.join(root, 'backend/.env'));
  const { PrismaService } = require('../backend/dist/prisma/prisma.service');
  const { loadConfig } = require('../backend/dist/config/config');
  const { hashPassword } = require('../backend/dist/auth/auth.service');
  const prisma = new PrismaService(loadConfig());
  try {
    if (fs.existsSync(target)) {
      const saved = JSON.parse(fs.readFileSync(target, 'utf8'));
      if (saved.purpose !== 'knot-isolated-qa' || !saved.email?.endsWith('@qa.knot.local'))
        throw new Error('Refusing an unrecognized QA account file.');
      const user = await prisma.user.findUnique({where:{id:saved.id}});
      if (!user || user.email !== saved.email) throw new Error('QA account mismatch; no account changed.');
      console.log('Dedicated QA account already exists. Credentials stay in ignored data/qa/account.json.');
      return;
    }
    const account = {purpose:'knot-isolated-qa',id:randomUUID(),email:`qa-${randomUUID()}@qa.knot.local`,password:randomBytes(30).toString('base64url')};
    fs.mkdirSync(path.dirname(target), {recursive:true});
    // Reserve the private record first so an interrupted creation is inspectable.
    fs.writeFileSync(target, JSON.stringify(account,null,2), {flag:'wx',mode:0o600});
    await prisma.user.create({data:{id:account.id,email:account.email,displayName:'K-NOT Dedicated QA',passwordHash:await hashPassword(account.password),role:'USER'}});
    console.log('Dedicated QA account created. Credentials stay in ignored data/qa/account.json.');
  } finally { await prisma.$disconnect(); }
}
main().catch(()=>{console.error('QA account setup failed; inspect local database availability and the private record. No existing account was changed.');process.exitCode=1;});

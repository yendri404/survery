// Creates a survey-creator account from the command line.
// Useful when self-registration is disabled (ALLOW_REGISTRATION=false).
// Usage: npm run create-user -- <email> <name> <password>
import { hashPassword } from '../src/auth.js';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { createRepo } from '../src/repo.js';

const [email, name, password] = process.argv.slice(2);
if (!email || !name || !password) {
  console.error('Usage: npm run create-user -- <email> <name> <password>');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

const db = openDatabase(loadConfig().dbPath);
const repo = createRepo(db);
if (repo.findUserByEmail(email)) {
  console.error(`A user with email ${email} already exists.`);
  process.exit(1);
}
const id = repo.createUser({ email, name, passwordHash: await hashPassword(password) });
db.close();
console.log(`Created user #${id} (${email}).`);

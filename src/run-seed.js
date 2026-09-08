import { initDb } from "./db.js";
import { seedWorld } from "./seed.js";

initDb();
const result = await seedWorld();
console.log("Test world ready. Logins (shown once):\n");
for (const account of result.accounts) {
  console.log(`${account.label}`);
  console.log(`  email:    ${account.email}`);
  console.log(`  password: ${account.password}\n`);
}
console.log("Join codes:");
for (const shop of result.shops) {
  console.log(`  ${shop.name}: ${shop.joinCode}`);
}
console.log(`\nShifts ${result.from} – ${result.to} (this week ${result.weekStart}).`);

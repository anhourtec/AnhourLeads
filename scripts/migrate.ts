/** Apply drizzle/ migrations to DATABASE_URL. `npm run db:migrate` */
import "dotenv/config";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
  await pool.end();
  console.log("migrations applied");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

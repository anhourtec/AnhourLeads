import { execSync } from "node:child_process";

/** Reset and seed the database once per run, so every run starts from the same demo data. */
export default function globalSetup() {
  if (process.env.TEST_SKIP_SEED === "true") return;
  execSync("npm run --silent db:seed -- --reset", { stdio: "inherit" });
}

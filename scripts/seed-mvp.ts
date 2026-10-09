import { MvpDatabase, id, passwordHash, now } from "../src/mvp/db.js";
const db = new MvpDatabase();
for (const [email, name, role, password] of [
  [
    "demo@audittrak.local",
    "Demo Business Owner",
    "business",
    process.env.DEMO_PASSWORD || "AuditTrakDemo2026!",
  ],
  [
    "reviewer@audittrak.local",
    "Demo Institutional Reviewer",
    "reviewer",
    process.env.REVIEWER_PASSWORD || "ReviewAuditTrak2026!",
  ],
]) {
  if (!db.one("SELECT id FROM users WHERE email=?", email)) {
    const uid = id();
    db.run(
      "INSERT INTO users VALUES (?,?,?,?,?,?)",
      uid,
      email,
      name,
      passwordHash(password),
      role,
      now(),
    );
    if (role === "business")
      db.run(
        "INSERT INTO businesses(id,user_id,name,sector,description,created_at) VALUES (?,?,?,?,?,?)",
        id(),
        uid,
        "Studio North — Demo",
        "Creative services",
        "A fictional freelance studio used for a local demonstration.",
        now(),
      );
  }
}
console.log("Local demo accounts prepared. See README for sign-in details.");
db.db.close();

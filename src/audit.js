#!/usr/bin/env node
import "dotenv/config";
import { auditMemoryIntegrity, closeDb } from "./db.js";

try {
  console.log(JSON.stringify(auditMemoryIntegrity(), null, 2));
} finally {
  closeDb();
}

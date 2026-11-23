#!/usr/bin/env node
// Writes the QA kitchen (personas, their recipes, cookbooks and lists) and a run's scratch users
// as one SQL file for a self-hosted server's `server.mjs sql <file>`, and their fresh passwords as
// the credentials file the journeys read (SPOONJOY_QA_CREDENTIALS). The Self-host Image workflow
// seeds the image with it before running the journeys' smoke set against it.
import { chmodSync, writeFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import {
  buildKitchenResetSql,
  buildScratchUsersSql,
  credentialsPayload,
  generatePersonaPasswords,
  generateScratchPasswords,
  generateScratchUsers,
  isCliEntry,
} from "./seed-qa-kitchen.mjs";

function valueAfter(argv, flag) {
  const index = argv.indexOf(flag);
  const value = index === -1 ? undefined : argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${flag} <path> is required.`);
  return value;
}

export function parseArgs(argv) {
  return { sqlOut: valueAfter(argv, "--sql-out"), credentialsOut: valueAfter(argv, "--credentials-out") };
}

function writePrivate(path, text) {
  writeFileSync(path, text, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
}

export function main(argv, { hash = (password) => bcrypt.hashSync(password, 10) } = {}) {
  const { sqlOut, credentialsOut } = parseArgs(argv);
  const passwords = generatePersonaPasswords();
  const scratchUsers = generateScratchUsers();
  const scratchPasswords = generateScratchPasswords(scratchUsers.length);
  writePrivate(
    sqlOut,
    `${buildKitchenResetSql({ passwords, hash })}\n${buildScratchUsersSql({ users: scratchUsers, passwords: scratchPasswords, hash })}\n`,
  );
  writePrivate(credentialsOut, `${JSON.stringify(credentialsPayload(passwords, scratchUsers, scratchPasswords), null, 2)}\n`);
}

/* istanbul ignore if -- the CLI entry */
if (isCliEntry(import.meta.url)) main(process.argv.slice(2));

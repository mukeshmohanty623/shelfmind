import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { QdrantClient } from "@qdrant/js-client-rest";
import { env } from "@/lib/env";
import type { Resource } from "@/types/resource";

const STORE_PATH = path.join(process.cwd(), "data", "resources.json");

async function migrateResourcesJson(userId: string): Promise<number> {
  let resources: Resource[];
  try {
    resources = JSON.parse(await readFile(STORE_PATH, "utf-8")) as Resource[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.error(`No resources.json found at ${STORE_PATH} — nothing to migrate there.`);
      return 0;
    }
    throw err;
  }

  let updated = 0;
  const migrated = resources.map((resource) => {
    if (resource.userId) return resource;
    updated++;
    return { ...resource, userId };
  });

  if (updated > 0) {
    await writeFile(STORE_PATH, JSON.stringify(migrated, null, 2), "utf-8");
  }
  return updated;
}

async function migrateQdrantPoints(userId: string): Promise<number> {
  const client = new QdrantClient({ url: env.qdrantUrl });
  const { exists } = await client.collectionExists(env.qdrantCollection);
  if (!exists) {
    console.error(`Qdrant collection "${env.qdrantCollection}" does not exist — nothing to migrate there.`);
    return 0;
  }

  const filter = { must: [{ is_empty: { key: "userId" } }] };

  const { points: sample } = await client.scroll(env.qdrantCollection, {
    filter,
    limit: 1,
    with_payload: false,
  });
  if (sample.length === 0) return 0;

  await client.setPayload(env.qdrantCollection, {
    wait: true,
    payload: { userId },
    filter,
  });

  const { points: remaining } = await client.scroll(env.qdrantCollection, {
    filter,
    limit: 1,
    with_payload: false,
  });
  if (remaining.length > 0) {
    console.error("Warning: some points still lack userId after migration — check manually.");
  }

  // setPayload-by-filter doesn't return an affected count, so report presence, not an exact number.
  return sample.length;
}

async function main() {
  const userId = process.argv[2];
  if (!userId) {
    console.error("Usage: bun scripts/migrate-legacy-data.ts <clerkUserId>");
    process.exit(1);
  }

  const resourcesUpdated = await migrateResourcesJson(userId);
  console.log(`resources.json: ${resourcesUpdated} entr${resourcesUpdated === 1 ? "y" : "ies"} assigned to ${userId}`);

  const hadUnownedPoints = await migrateQdrantPoints(userId);
  console.log(
    hadUnownedPoints > 0
      ? `Qdrant: unowned points assigned to ${userId}`
      : "Qdrant: no unowned points found",
  );
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

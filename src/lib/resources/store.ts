import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Resource } from "@/types/resource";

const DATA_DIR = path.join(process.cwd(), "data");
const STORE_PATH = path.join(DATA_DIR, "resources.json");

// Serializes writes within this process so concurrent requests can't clobber each other.
let writeChain: Promise<unknown> = Promise.resolve();

async function readAll(): Promise<Resource[]> {
  try {
    const raw = await readFile(STORE_PATH, "utf-8");
    return JSON.parse(raw) as Resource[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function writeAll(resources: Resource[]): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(resources, null, 2), "utf-8");
}

export async function listResources(): Promise<Resource[]> {
  const resources = await readAll();
  return resources.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export async function addResource(resource: Resource): Promise<void> {
  writeChain = writeChain.then(async () => {
    const resources = await readAll();
    resources.push(resource);
    await writeAll(resources);
  });
  await writeChain;
}

export async function getResource(id: string): Promise<Resource | undefined> {
  const resources = await readAll();
  return resources.find((resource) => resource.id === id);
}

export async function removeResource(id: string): Promise<Resource | undefined> {
  let removed: Resource | undefined;
  writeChain = writeChain.then(async () => {
    const resources = await readAll();
    removed = resources.find((resource) => resource.id === id);
    await writeAll(resources.filter((resource) => resource.id !== id));
  });
  await writeChain;
  return removed;
}

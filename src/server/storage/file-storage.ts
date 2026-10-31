// src/server/storage/file-storage.ts
// Storage for uploaded files (logos now, pairing workbooks in Phase 4) behind one interface, so the local-disk
// implementation used on a single VPS can be swapped for S3-compatible storage later (Web requirements §3).
// Keys are relative paths built by the app, never from user input, and are checked to stay inside the root.

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getServerEnvironment } from "@/server/config/server-environment";

/** Minimal storage operations the app needs. */
export interface FileStorage {
  /**
   * Stores bytes under a key, replacing any existing file.
   * @param storageKey - Relative key such as "tournaments/abc/logo-1a2b.png".
   * @param fileBytes - Content.
   */
  saveFile(storageKey: string, fileBytes: Uint8Array): Promise<void>;
  /**
   * Reads a stored file.
   * @param storageKey - Key used when saving.
   * @returns The bytes, or null when the key does not exist.
   */
  readFile(storageKey: string): Promise<Uint8Array | null>;
  /**
   * Deletes a stored file; a missing file is not an error.
   * @param storageKey - Key used when saving.
   */
  deleteFile(storageKey: string): Promise<void>;
}

/** Local-disk storage rooted at UPLOAD_DIRECTORY. */
export class LocalDiskFileStorage implements FileStorage {
  /**
   * @param rootDirectory - Absolute or working-directory-relative root folder.
   */
  constructor(private readonly rootDirectory: string) {}

  /**
   * Resolves a key to an absolute path inside the root.
   *
   * @param storageKey - Relative key.
   * @returns Absolute path.
   * @throws Error when the key would escape the root (path traversal).
   */
  private resolveSafePath(storageKey: string): string {
    const absoluteRoot = path.resolve(this.rootDirectory);
    const absolutePath = path.resolve(absoluteRoot, storageKey);
    if (!absolutePath.startsWith(absoluteRoot + path.sep)) {
      throw new Error(`Storage key escapes the upload directory: ${storageKey}`);
    }
    return absolutePath;
  }

  async saveFile(storageKey: string, fileBytes: Uint8Array): Promise<void> {
    const absolutePath = this.resolveSafePath(storageKey);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, fileBytes);
  }

  async readFile(storageKey: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.resolveSafePath(storageKey)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async deleteFile(storageKey: string): Promise<void> {
    await rm(this.resolveSafePath(storageKey), { force: true });
  }
}

let defaultFileStorage: FileStorage | undefined;

/**
 * The app-wide storage, rooted at UPLOAD_DIRECTORY.
 *
 * @returns The storage instance.
 */
export function getFileStorage(): FileStorage {
  defaultFileStorage ??= new LocalDiskFileStorage(getServerEnvironment().UPLOAD_DIRECTORY);
  return defaultFileStorage;
}

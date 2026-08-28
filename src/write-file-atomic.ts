import { chmod, rename, stat, unlink, writeFile } from "node:fs/promises";

export type AtomicWriteOperations = {
	writeFile: (filePath: string, content: string, encoding: "utf-8") => Promise<void>;
	rename: (fromPath: string, toPath: string) => Promise<void>;
	unlink: (filePath: string) => Promise<void>;
	stat: (filePath: string) => Promise<{ mode: number }>;
	chmod: (filePath: string, mode: number) => Promise<void>;
};

const ATOMIC_WRITE_OPERATIONS: AtomicWriteOperations = {
	writeFile,
	rename,
	unlink,
	stat,
	chmod,
};

export function hasErrorCode(error: unknown, code: string): boolean {
	return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

async function cleanupTempFile(tempPath: string, operations: AtomicWriteOperations): Promise<void> {
	try {
		await operations.unlink(tempPath);
	} catch {
		// Best-effort cleanup: a leftover temp file is better than masking the original error.
	}
}

export async function writeFileAtomic(
	absPath: string,
	content: string,
	operations: AtomicWriteOperations = ATOMIC_WRITE_OPERATIONS,
): Promise<void> {
	const tempPath = `${absPath}.tmp.${process.pid}.${Math.random().toString(16).slice(2)}`;
	try {
		await operations.writeFile(tempPath, content, "utf-8");
	} catch (error) {
		await cleanupTempFile(tempPath, operations);
		throw error;
	}
	try {
		// rename replaces the target inode, dropping the original mode (e.g. the
		// executable bit). Inherit the target's mode bits onto the temp file so
		// updates preserve permissions. New files (ENOENT) keep umask defaults.
		let targetMode: number | undefined;
		try {
			targetMode = (await operations.stat(absPath)).mode & 0o7777;
		} catch (error) {
			if (!hasErrorCode(error, "ENOENT")) {
				await cleanupTempFile(tempPath, operations);
				throw error;
			}
		}
		if (targetMode !== undefined) {
			await operations.chmod(tempPath, targetMode);
		}
		await operations.rename(tempPath, absPath);
	} catch (error) {
		if (!hasErrorCode(error, "EEXIST")) {
			await cleanupTempFile(tempPath, operations);
			throw error;
		}
		await operations.unlink(absPath);
		await operations.rename(tempPath, absPath);
	}
}

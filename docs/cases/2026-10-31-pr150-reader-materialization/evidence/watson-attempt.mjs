// Watson's blind attempt, written from README/API.md/files.d.ts only. Not run.
import ContentAddressableStore, { CasError } from '@git-stunts/git-cas'; // GUESS: CasError named export (API.md#3510 says "re-exported from the package root")
import { materializeFile } from '@git-stunts/git-cas/files';

export async function saveAsset({ handle, encryptionKey, expectedSha256, dir, name, timeoutMs = 30_000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  const cas = await ContentAddressableStore.open({ cwd: '.' });
  try {
    // GUESS: assets.open() is synchronous and validation errors (HANDLE_TARGET_MISSING)
    // surface on first pull inside materializeFile, not here. Docs (API.md#1029) say
    // "Validates ... then returns" -- ambiguous about when.
    const { bytesWritten } = await materializeFile({
      source: cas.assets.open({ handle, encryptionKey }),
      baseDirectory: dir,          // must exist; GUESS: must I mkdir the output parent too? yes (API.md#1060)
      outputPath: name,            // GUESS: name may come from untrusted metadata -> SECURITY_BOUNDARY_VIOLATION is my guard
      expectedSha256,              // GUESS: 64 lowercase/uppercase hex; WHERE do I get it? git-cas gives no whole-file digest I can find
      signal: controller.signal,
    });
    return { ok: true, bytesWritten };
  } catch (err) {
    // GUESS: what does abort reject with? "underlying runtime error forms" (API.md#1098-1099):
    // signal.reason? DOMException AbortError? Error with code 'ABORT_ERR'? I check all three.
    if (controller.signal.aborted && (err === controller.signal.reason || err?.name === 'AbortError')) {
      return { ok: false, reason: 'cancelled' };
    }
    if (err instanceof CasError && err.code === 'INTEGRITY_ERROR') {
      // GUESS: same code for my expectedSha256 mismatch AND source-side chunk/auth failure
      // (both are INTEGRITY_ERROR). meta shape for digest mismatch is undocumented.
      return { ok: false, reason: 'integrity', meta: err.meta };
    }
    if (err instanceof CasError && err.code === 'SECURITY_BOUNDARY_VIOLATION') {
      return { ok: false, reason: 'bad-path' };
    }
    throw err; // GUESS: was existing destination preserved? docs say yes for pre-rename failures.
               // But a cleanup error AFTER rename can also reject (API.md#1082-1084) -- then the
               // file IS published while I'm in catch. How do I tell? Not documented.
  } finally {
    clearTimeout(timer);
    await cas.close(); // README#111-131 says session must stay open until helper finishes -- satisfied
  }
}
// Unaddressed: crash-orphan temp dir naming, so I can "reclaim" it (API.md#1085-1086).
// Unaddressed: final mode 0600 -- if another process must read the file, I chmod afterwards?

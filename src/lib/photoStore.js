// ═══════════════════════════════════════════════════════════════════════════
// photoStore.js — filesystem-backed photo storage for the landlord app
// ═══════════════════════════════════════════════════════════════════════════
// Mirror of the tenant app's PhotoStore, using the landlord's PHOTO_ROOT
// ('MoveOutShieldLandlord') so the two apps don't collide on-device.
//
// Folder structure: MoveOutShieldLandlord/{inspectionId}/{roomId}_{phase}_{tag}.jpg
// Photos persist in Directory.Data (app-private storage).
// Portfolio state stores only { path, ts, lat, lng, ratio } — no base64.
//
// Expects these Capacitor imports to be in scope in the app's entry point
// and passed in via the `deps` arg (mirroring bundleImport):
//   { Capacitor, Filesystem, Directory }
// ═══════════════════════════════════════════════════════════════════════════

import { PHOTO_ROOT, uid } from './constants.js';

export function makePhotoStore(deps) {
  const { Capacitor, Filesystem, Directory } = deps;
  const IS_NATIVE = Capacitor?.isNativePlatform?.() ?? false;

  return {
    async save(inspId, roomId, phase, dataUrl) {
      if (!IS_NATIVE) return null;
      const base64 = dataUrl.split(',')[1];
      const tag = Date.now() + '_' + uid().slice(0, 6);
      const fileName = `${roomId}_${phase}_${tag}.jpg`;
      const path = `${PHOTO_ROOT}/${inspId}/${fileName}`;
      await Filesystem.writeFile({ path, data: base64, directory: Directory.Data, recursive: true });
      return { path };
    },

    async toWebUrl(path) {
      if (!IS_NATIVE || !path) return null;
      try {
        const { uri } = await Filesystem.getUri({ path, directory: Directory.Data });
        return Capacitor.convertFileSrc(uri);
      } catch { return null; }
    },

    async readAsDataUrl(path) {
      if (!IS_NATIVE || !path) return null;
      try {
        const { data } = await Filesystem.readFile({ path, directory: Directory.Data });
        return `data:image/jpeg;base64,${data}`;
      } catch { return null; }
    },

    async remove(path) {
      if (!IS_NATIVE || !path) return;
      try { await Filesystem.deleteFile({ path, directory: Directory.Data }); } catch {}
    },

    async removeInspection(inspId) {
      if (!IS_NATIVE || !inspId) return;
      try { await Filesystem.rmdir({ path: `${PHOTO_ROOT}/${inspId}`, directory: Directory.Data, recursive: true }); } catch {}
    },
  };
}

// Single source of truth for the Chrome extension build that ships with the
// app. Mirrors the artifact committed at frontend/public/extension/ — bump
// every field here in the same commit that adds the new zip, so the UI can
// never advertise a version that isn't on disk.
//
// The filename is version-stamped on purpose: the served URL changes on every
// release, which is what makes the immutable cache header in nginx.conf safe.
// Never overwrite an existing quickicp-extension-X.Y.Z.zip in place.
export const CHROME_EXTENSION = {
  version: "1.3.0",
  fileName: "quickicp-extension-1.3.0.zip",
  downloadPath: "/extension/quickicp-extension-1.3.0.zip",
  // Folder the user gets after extracting — named in the install steps because
  // pointing "Load unpacked" at the wrong directory is the #1 install failure.
  folderName: "quickicp-extension-1.3.0",
  sizeLabel: "151 KB",
  // From the extension's own manifest.json ("minimum_chrome_version").
  minChromeVersion: 116,
} as const;

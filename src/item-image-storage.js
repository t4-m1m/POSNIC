'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Copy legacy item photos out of the replaceable application resources tree.
 * Existing user-data files always win: safe at startup and before updates.
 */
function copyFiles(source, destination) {
  if (!fs.existsSync(source)) return 0;
  fs.mkdirSync(destination, { recursive: true });
  let copied = 0;
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (fs.existsSync(to)) continue;
    try {
      fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
      copied += 1;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  return copied;
}

function preserveLegacyItemImages({ apiPath, userDataPath } = {}) {
  if (!apiPath || !userDataPath) {
    return { copied: 0, skipped: true, reason: 'missing-path' };
  }

  const sourceRoot = path.join(apiPath, 'uploads');
  const destinationRoot = path.join(userDataPath, 'uploads');
  if (!fs.existsSync(sourceRoot)) {
    return { copied: 0, skipped: true, reason: 'no-legacy-directory', destination: destinationRoot };
  }

  // Old POSNIC releases stored images directly in /uploads; newer releases
  // use /uploads/item_images. Preserve both layouts across installer updates.
  const copiedRoot = copyFiles(sourceRoot, destinationRoot);
  const copiedItems = copyFiles(
    path.join(sourceRoot, 'item_images'),
    path.join(destinationRoot, 'item_images')
  );
  return {
    copied: copiedRoot + copiedItems,
    skipped: false,
    destination: destinationRoot,
  };
}

module.exports = { preserveLegacyItemImages };

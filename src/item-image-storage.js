'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Copy legacy item photos out of the replaceable application resources tree.
 * Existing user-data files always win: safe at startup and before updates.
 */
function preserveLegacyItemImages({ apiPath, userDataPath } = {}) {
  if (!apiPath || !userDataPath) {
    return { copied: 0, skipped: true, reason: 'missing-path' };
  }

  const source = path.join(apiPath, 'uploads', 'item_images');
  const destination = path.join(userDataPath, 'uploads', 'item_images');
  if (!fs.existsSync(source)) {
    return { copied: 0, skipped: true, reason: 'no-legacy-directory', destination };
  }

  fs.mkdirSync(destination, { recursive: true });
  let copied = 0;
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (fs.existsSync(to)) continue;
    fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
    copied += 1;
  }
  return { copied, skipped: false, destination };
}

module.exports = { preserveLegacyItemImages };

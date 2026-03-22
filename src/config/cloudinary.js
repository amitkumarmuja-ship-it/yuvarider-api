/**
 * src/config/cloudinary.js
 *
 * Cloudinary configuration for persistent image storage.
 *
 * Why Cloudinary instead of local disk:
 *   Render.com (and most PaaS platforms) have ephemeral filesystems.
 *   Any file written to disk is lost on every deploy or server restart.
 *   Cloudinary stores images permanently in the cloud and serves them
 *   via a global CDN — much faster and reliable for production.
 *
 * Setup (one-time):
 *   1. Sign up free at https://cloudinary.com  (25 GB storage free)
 *   2. In your Render dashboard, add these environment variables:
 *        CLOUDINARY_CLOUD_NAME   = your cloud name (e.g. "dxyz123")
 *        CLOUDINARY_API_KEY      = your API key
 *        CLOUDINARY_API_SECRET   = your API secret
 *   3. Deploy — done. Images now persist permanently.
 *
 * Local development:
 *   Add the same 3 vars to your .env file.
 *   OR if CLOUDINARY_CLOUD_NAME is not set, the upload route
 *   automatically falls back to local disk storage (existing behaviour).
 */

'use strict';

const cloudinary = require('cloudinary').v2;

const isConfigured =
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET;

if (isConfigured) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure:     true,  // always use https URLs
  });
  console.log('[cloudinary] Configured — images will be stored on Cloudinary CDN');
} else {
  console.warn(
    '[cloudinary] NOT configured — falling back to local disk storage.\n' +
    '             Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET\n' +
    '             in your .env or Render environment variables for production.'
  );
}

module.exports = { cloudinary, isConfigured: !!isConfigured };

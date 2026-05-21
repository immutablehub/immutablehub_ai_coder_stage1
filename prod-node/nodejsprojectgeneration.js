import { NextResponse } from 'next/server';
import { PinataSDK } from 'pinata';
import { provideClient } from './dbconnection.js';
import CodeGeneration from './nodejs-coder.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const MIME_MAP = {
  '.json': 'application/json',
  '.js': 'text/javascript',
  '.ts': 'text/typescript',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
};

// ─── Errors ───────────────────────────────────────────────────────────────────

class UploadRouteError extends Error {
  constructor(message, statusCode = 500, cause = null) {
    super(message);
    this.name = 'UploadRouteError';
    this.statusCode = statusCode;
    this.cause = cause;
  }
}

// ─── Pinata client (singleton) ────────────────────────────────────────────────

function createPinataClient() {
  const pinataJwt = process.env.NEXT_PUBLIC_PJWT;
  const pinataGateway = process.env.NEXT_PUBLIC_PGATE;

  if (!pinataJwt || !pinataGateway) {
    throw new UploadRouteError('Missing Pinata environment variables (NEXT_PUBLIC_PJWT / NEXT_PUBLIC_PGATE).');
  }

  return new PinataSDK({ pinataJwt, pinataGateway });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolves a MIME type from a filename extension.
 * Falls back to application/octet-stream for unknown types.
 */
function resolveMimeType(filename) {
  const ext = filename.slice(filename.lastIndexOf('.'));
  return MIME_MAP[ext] ?? 'application/octet-stream';
}

/**
 * Builds the File list to be uploaded to Pinata.
 * @param {string} foldername
 * @param {Array<{ name: string; content: string }>} projectFiles
 * @returns {File[]}
 */
function buildFileList(foldername, projectFiles) {
  const readme = new File(
    [`### Repository: ${foldername}`],
    'README.md',
    { type: 'text/markdown' },
  );

  const codeFiles = projectFiles.map(
    ({ name, content }) => new File([content], name, { type: resolveMimeType(name) }),
  );

  return [readme, ...codeFiles];
}

/**
 * Validates and extracts required fields from the request body.
 * Throws an UploadRouteError (400) on invalid input.
 */
async function parseRequestBody(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    throw new UploadRouteError('Request body is not valid JSON.', 400);
  }

  const { wallet, foldername, prompt } = body ?? {};

  if (!wallet || !foldername || !prompt) {
    throw new UploadRouteError(
      `Missing required fields: ${[
        !wallet && 'wallet',
        !foldername && 'foldername',
        !prompt && 'prompt',
      ]
        .filter(Boolean)
        .join(', ')}.`,
      400,
    );
  }

  return { wallet, foldername, prompt };
}

/**
 * Persists upload metadata to MongoDB.
 */
async function persistManifest(meta) {
  const client = provideClient();
  const coll = client.db('ihub_db').collection('ihub_col');

  await coll.findOneAndUpdate(
    { owner: 'system' },
    { $push: { manifests: meta } },
  );
}

// ─── Route Handlers ───────────────────────────────────────────────────────────

export async function OPTIONS() {
  return new Response(null, { status: 200, headers: CORS_HEADERS });
}

export async function POST(request) {
  try {
    const { wallet, foldername, prompt } = await parseRequestBody(request);

    console.info('[UploadRoute] POST received.', { wallet, foldername });

    // 1. Generate code
    const generated = await CodeGeneration(prompt);

    // 2. Build files
    const files = buildFileList(foldername, generated.projectFiles);

    // 3. Upload all files to Pinata in parallel
    const pinata = createPinataClient();
    const uploadResults = await Promise.all(
      files.map((file) => pinata.upload.public.file(file)),
    );

    console.info('[UploadRoute] Pinata upload complete.', {
      fileCount: uploadResults.length,
    });

    // 4. Persist manifest to DB
    const meta = {
      id: wallet,
      folder: foldername,
      uploads: uploadResults,
      is_latest: true,
      createdAt: new Date(),
    };

    await persistManifest(meta);

    console.info('[UploadRoute] Manifest persisted.', { wallet, foldername });

    return NextResponse.json({ success: true }, { status: 200, headers: CORS_HEADERS });
  } catch (error) {
    const statusCode = error instanceof UploadRouteError ? error.statusCode : 500;

    console.error('[UploadRoute] Error.', {
      name: error.name,
      message: error.message,
      cause: error.cause?.message,
      status: statusCode,
    });

    return NextResponse.json(
      { success: false, error: error.message },
      { status: statusCode, headers: CORS_HEADERS },
    );
  }
}

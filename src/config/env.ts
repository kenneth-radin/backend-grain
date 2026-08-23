import 'dotenv/config';

/**
 * Centralized environment configuration.
 *
 * Rules enforced here (fail fast):
 *  - MONGODB_URI must exist and must NOT contain placeholder tokens such as
 *    `<db_password>` or `<username>` pasted straight from Atlas.
 *  - JWT_SECRET must exist (a short one only triggers a warning).
 */

function fatal(message: string): never {
  /* eslint-disable no-console */
  console.error('\n==========================================================');
  console.error('[grAIn API] FATAL configuration error:');
  console.error(`  ${message}`);
  console.error('');
  console.error('Fix: copy .env.example to .env and fill in real values.');
  console.error('==========================================================\n');
  process.exit(1);
}

const mongoUri = (process.env.MONGODB_URI || process.env.MONGO_URI || '').trim();

if (!mongoUri) {
  fatal(
    'MONGODB_URI is missing. Set it in your .env file, e.g. ' +
      'mongodb+srv://user:password@cluster0.xxxxx.mongodb.net/grain'
  );
}

if (/<[a-z0-9_.-]+>/i.test(mongoUri)) {
  fatal(
    'MONGODB_URI still contains an angle-bracket placeholder such as <db_password> or <username>. ' +
      'Replace it with your real Atlas database user credentials.'
  );
}

const jwtSecret = (process.env.JWT_SECRET || '').trim();

if (!jwtSecret) {
  fatal('JWT_SECRET is missing. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
}

if (jwtSecret.length < 24) {
  console.warn(
    '[grAIn API] WARNING: JWT_SECRET is shorter than 24 characters. ' +
      'Use a long random string in production.'
  );
}

const firebaseDatabaseUrl = (process.env.FIREBASE_DATABASE_URL || '').trim();
const mlServiceUrl = (process.env.ML_SERVICE_URL || '').trim();

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 8080),
  mongoUri,
  jwtSecret,
  jwtExpiresIn: (process.env.JWT_EXPIRES_IN || '30d').trim(),
  /** Devices whose lastSeen is older than this are reported offline. */
  deviceOfflineAfterMs: Number(process.env.DEVICE_OFFLINE_AFTER_MS || 5 * 60 * 1000),
  /** High-temperature alert threshold (deg C) for DHT22 readings. */
  highTempThresholdC: Number(process.env.HIGH_TEMP_THRESHOLD_C || 65),
  // --- AI predictive-analytics settings (DHT22-only) ---
  /** Base URL of the Python ML prediction microservice; empty = physics fallback only. */
  mlServiceUrl,
  /** Version label recorded on predictions produced by the served model. */
  mlModelVersion: (process.env.ML_MODEL_VERSION || 'v1').trim(),
  /** Target grain moisture (%) for the equilibrium-RH completion criterion. */
  targetMoisturePct: Number(process.env.TARGET_MOISTURE_PCT || 14),
  /** Exhaust RH must stay <= equilibrium threshold this long to mark completion. */
  completionSustainMinutes: Number(process.env.COMPLETION_SUSTAIN_MINUTES || 30),
  /** Minimum spacing between stored predictions per session. */
  predictionMinIntervalMs: Number(process.env.PREDICTION_MIN_INTERVAL_MS || 60_000),
  openaiApiKey: (process.env.OPENAI_API_KEY || '').trim(),
  firebase: {
    enabled: Boolean(firebaseDatabaseUrl),
    projectId: (process.env.FIREBASE_PROJECT_ID || '').trim(),
    clientEmail: (process.env.FIREBASE_CLIENT_EMAIL || '').trim(),
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    databaseUrl: firebaseDatabaseUrl
  }
};

export type AppEnv = typeof env;

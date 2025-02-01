// config.js
require('dotenv').config();
const { Scopes } = require('@aps_sdk/authentication');

const designAutomation = {
  nickname: "NjVXvdCtBAR7ixAAg3599X16PgZIAyWGDqpvBnG56HQELUDn",  // Ej. tu client_id o tu "ID" del APS account
  appbundle_activity_alias: "dev", // "prod", "beta", etc.

  URL: {
    GET_ENGINES_URL: "https://developer.api.autodesk.com/da/us-east/v3/engines",
    APPBUNDLES_URL:  "https://developer.api.autodesk.com/da/us-east/v3/appbundles",
    ACTIVITIES_URL:  "https://developer.api.autodesk.com/da/us-east/v3/activities",
    
    CREATE_APPBUNDLE_VERSION_URL: "https://developer.api.autodesk.com/da/us-east/v3/appbundles/{0}/versions",
    UPDATE_APPBUNDLE_ALIAS_URL:   "https://developer.api.autodesk.com/da/us-east/v3/appbundles/{0}/aliases/{1}",
    CREATE_APPBUNDLE_ALIAS_URL:   "https://developer.api.autodesk.com/da/us-east/v3/appbundles/{0}/aliases",
    CREATE_ACTIVITY_ALIAS:        "https://developer.api.autodesk.com/da/us-east/v3/activities/{0}/aliases",
    
    APPBUNDLE_URL: "https://developer.api.autodesk.com/da/us-east/v3/appbundles/{0}",
    ACTIVITY_URL:  "https://developer.api.autodesk.com/da/us-east/v3/activities/{0}"
  }
};
// Lee variables de entorno
let {
  APS_CLIENT_ID,
  APS_CLIENT_SECRET,
  APS_CALLBACK_URL,
  SERVER_SESSION_SECRET,
  PORT
} = process.env;

// Verifica que existan
if (!APS_CLIENT_ID || !APS_CLIENT_SECRET || !APS_CALLBACK_URL || !SERVER_SESSION_SECRET) {
  console.warn('Missing some of the environment variables (APS_CLIENT_ID, APS_CLIENT_SECRET, APS_CALLBACK_URL, SERVER_SESSION_SECRET).');
  process.exit(1);
}

// Define scopes para la librería @aps_sdk/authentication (Beta)
const INTERNAL_TOKEN_SCOPES = [Scopes.DataRead, Scopes.ViewablesRead];
const PUBLIC_TOKEN_SCOPES   = [Scopes.ViewablesRead];

// Define puerto si no lo toma de .env
PORT = PORT || 8080;

// Exporta tanto lo que necesita la librería Beta
// como la parte de 'credentials' y 'scopes' usada
// en ejemplos clásicos de APS/Forge.
module.exports = {
  // Variables de entorno principales
  APS_CLIENT_ID,
  APS_CLIENT_SECRET,
  APS_CALLBACK_URL,
  SERVER_SESSION_SECRET,
  PORT,

  // Scopes para la nueva librería @aps_sdk/authentication
  INTERNAL_TOKEN_SCOPES,
  PUBLIC_TOKEN_SCOPES,

  // Estructura estilo "clásico" Forge/APS
  credentials: {
    client_id: APS_CLIENT_ID,
    client_secret: APS_CLIENT_SECRET,
    callback_url: APS_CALLBACK_URL
  },
  scopes: {
    internal: [
      'bucket:create',
      'bucket:read',
      'bucket:delete',
      'data:read',
      'data:create',
      'data:write',
      'code:all'
    ],
    public: ['viewables:read']
  },
  client: {
    circuitBreaker: {
      threshold: 11,
      interval: 1200
    },
    retry: {
      maxNumberOfRetries: 7,
      backoffDelay: 4000,
      backoffPolicy: 'exponentialBackoffWithJitter'
    },
    requestTimeout: 13000
  },
  designAutomation 
};

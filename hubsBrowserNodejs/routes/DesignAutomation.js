
const path      = require("path");
const fs        = require("fs");
const url       = require("url");
const express   = require("express");
const https     = require("https");
const formdata  = require("form-data");
const bodyParser= require("body-parser");
const multer    = require("multer");

const { getClient } = require("./common/oauth");
const config  = require("../config");
const dav3    = require("autodesk.forge.designautomation");
const ForgeAPI= require("forge-apis");

const router = express.Router();
router.use(bodyParser.json());

// ********** MIDDLEWARE DE AUTENTICACIÓN 2-LEGGED ************
router.use(async (req, res, next) => {
  // Obtiene credenciales 2Legged
  req.oauth_client = await getClient();
  req.oauth_token  = req.oauth_client.getCredentials();
  next();
});

// ********** STATIC INSTANCE ************
let dav3Instance = null;

class Utils {
  static async Instance() {
    if (!dav3Instance) {
      dav3Instance = new dav3.AutodeskForgeDesignAutomationClient(config.client);
      // Refresh token automatically
      dav3Instance.authManager.authentications["2-legged"].fetchToken =
        async () => (await getClient()).getCredentials();
      dav3Instance.authManager.authentications["2-legged"].refreshToken =
        async () => (await getClient()).getCredentials();
    }
    return dav3Instance;
  }

  static async dav3API(oauth2) {
    let apiClient = await Utils.Instance();
    return new dav3.AutodeskForgeDesignAutomationApi(apiClient);
  }

  static get NickName() { return config.credentials.client_id; }
  static get Alias()    { return "dev"; }

  static get LocalBundlesFolder() {
    return path.resolve(path.join(__dirname, "../", "bundles"));
  }

  // Subir un archivo local .zip a la URL firmada
  static async uploadFormDataWithFile(filepath, endpoint, params = null) {
    return new Promise(async (resolve, reject) => {
      const fileStream = fs.createReadStream(filepath);
      const form = new formdata();
      if (params) {
        for (let k of Object.keys(params)) form.append(k, params[k]);
      }
      form.append("file", fileStream);

      let headers = form.getHeaders();
      // Opcional: headers["Cache-Control"] = "no-cache";

      const urlinfo = url.parse(endpoint);
      const postReq = https.request(
        {
          host: urlinfo.host,
          port: urlinfo.port || (urlinfo.protocol === "https:" ? 443 : 80),
          path: urlinfo.pathname,
          method: "POST",
          headers: headers,
        },
        (response) => {
          resolve(response.statusCode);
        }
      );
      form.pipe(postReq);
      postReq.on("error", (err) => reject(err));
    });
  }
}

// ----------------------- LISTAR ZIP BUNDLES LOCALES -----------------
router.get("/appbundles", async (req, res) => {
  try {
    const folder   = Utils.LocalBundlesFolder; // ../bundles
    const allFiles = fs.readdirSync(folder);
    const zipOnly  = allFiles
      .filter(f => f.toLowerCase().endsWith(".zip"))
      .map(f => path.basename(f, ".zip"));
    res.json(zipOnly);
  } catch (err) {
    console.error("Error listing local .zip in /bundles folder:", err);
    res.status(500).json({error: err.message});
  }
});

// ----------------------- ENGINES ---------------------------
router.get("/api/designautomation/engines", async (req, res) => {
  try {
    const daApi = await Utils.dav3API(req.oauth_token);
    let allEngines = [];
    let pageToken  = null;
    while (true) {
      let engines = await daApi.getEngines({ page: pageToken });
      allEngines  = allEngines.concat(engines.data);
      if (!engines.paginationToken) break;
      pageToken = engines.paginationToken;
    }
    allEngines.sort();
    res.json(allEngines);
  } catch(ex) {
    console.error("Failed to get engines:", ex);
    res.json([]);
  }
});

// ----------------------- APPBUNDLES (CREATE/UPDATE) --------
router.post("/api/designautomation/appbundles", async (req, res) => {
  const { zipFileName, engine } = req.body;
  if (!zipFileName || !engine) {
    return res.status(400).json({error: "Missing zipFileName or engine."});
  }

  const appBundleName = zipFileName + "AppBundle";
  const localBundlePath = path.join(Utils.LocalBundlesFolder, zipFileName + ".zip");

  const daApi = await Utils.dav3API(req.oauth_token);
  let allBundles;
  try {
    allBundles = await daApi.getAppBundles();
  } catch (err) {
    return res.status(500).json({ diagnostic: "Failed to get bundle list" });
  }
  const qualifiedId = `${Utils.NickName}.${appBundleName}+${Utils.Alias}`;

  let newAppVersion = null;
  const bundleExists = allBundles.data.includes(qualifiedId);

  if (!bundleExists) {
    // CREATE
    const spec = dav3.AppBundle.constructFromObject({
      package: appBundleName,
      engine: engine,
      id: appBundleName,
      description: `Description for ${appBundleName}`
    });
    try {
      newAppVersion = await daApi.createAppBundle(spec);
    } catch (err) {
      console.error("Error createAppBundle:", err);
      return res.status(500).json({ diagnostic: "Cannot create new bundle" });
    }
    // ALIAS -> v1
    const aliasSpec = { id: Utils.Alias, version: 1 };
    try {
      await daApi.createAppBundleAlias(appBundleName, aliasSpec);
    } catch (err) {
      return res.status(500).json({ diagnostic: "Failed to create alias" });
    }
  } else {
    // CREATE NEW VERSION
    const spec = { engine: engine, description: appBundleName };
    try {
      newAppVersion = await daApi.createAppBundleVersion(appBundleName, spec);
    } catch (err) {
      console.error("Error createAppBundleVersion:", err);
      return res.status(500).json({ diagnostic: "Cannot create new version" });
    }
    // ALIAS -> v(new)
    const aliasSpec = { version: newAppVersion.version };
    try {
      await daApi.modifyAppBundleAlias(appBundleName, Utils.Alias, aliasSpec);
    } catch (err) {
      return res.status(500).json({ diagnostic: "Failed to update alias" });
    }
  }

  // UPLOAD the .zip
  try {
    await Utils.uploadFormDataWithFile(
      localBundlePath,
      newAppVersion.uploadParameters.endpointURL,
      newAppVersion.uploadParameters.formData
    );
  } catch (err) {
    return res.status(500).json({ diagnostic: "Failed to upload .zip" });
  }

  res.status(200).json({
    appBundle: qualifiedId,
    version: newAppVersion.version
  });
});

// ------------------------ ACTIVITIES -------------------------
router.post("/api/designautomation/activities", async (req, res) => {
  const { zipFileName, engine } = req.body;
  if (!zipFileName || !engine) {
    return res.status(400).json({ error: "Missing zipFileName or engine" });
  }
  const appBundleName = zipFileName + "AppBundle";
  const activityName  = zipFileName + "Activity";

  const qualifiedId  = `${Utils.NickName}.${activityName}+${Utils.Alias}`;
  const daApi        = await Utils.dav3API(req.oauth_token);

  // Lista de activities
  let allActivities;
  try {
    allActivities = await daApi.getActivities();
  } catch (err) {
    return res.status(500).json({ diagnostic: "Failed to get activity list" });
  }

  if (!allActivities.data.includes(qualifiedId)) {
    // CREATE
    const engineAtt = Utils.EngineAttributes(engine);
    const cmdLine   = engineAtt.commandLine.replace("{0}", appBundleName);
    const spec = {
      id: activityName,
      appbundles: [ `${Utils.NickName}.${appBundleName}+${Utils.Alias}` ],
      commandLine: [ cmdLine ],
      engine: engine,
      parameters: {
        inputFile: {
          description: "input file",
          localName: "$(inputFile)",
          ondemand: false,
          required: true,
          verb: dav3.Verb.get,
          zip: false
        },
        inputJson: {
          description: "input json",
          localName: "params.json",
          ondemand: false,
          required: false,
          verb: dav3.Verb.get,
          zip: false
        },
        outputFile: {
          description: "output file",
          localName: "outputFile." + engineAtt.extension,
          ondemand: false,
          required: true,
          verb: dav3.Verb.put,
          zip: false
        }
      },
      settings: {
        script: { value: engineAtt.script } // si lo necesitas
      }
    };
    try {
      await daApi.createActivity(spec);
    } catch (err) {
      return res.status(500).json({ diagnostic: "Failed to create new activity" });
    }
    // alias -> v1
    const aliasSpec = { id: Utils.Alias, version: 1 };
    try {
      await daApi.createActivityAlias(activityName, aliasSpec);
    } catch (err) {
      return res.status(500).json({ diagnostic: "Failed to alias activity" });
    }
    return res.status(200).json({ activity: qualifiedId });
  } else {
    // Already exists
    return res.status(200).json({ activity: "Activity already defined" });
  }
});

router.get("/api/designautomation/activities", async (req, res) => {
  const daApi = await Utils.dav3API(req.oauth_token);
  try {
    let allActs = await daApi.getActivities();
    // filtra
    let filtered = allActs.data.filter(a =>
      a.startsWith(Utils.NickName) && !a.includes("$LATEST")
    ).map(a => a.replace(`${Utils.NickName}.`, ""));
    res.json(filtered);
  } catch (err) {
    res.status(500).json({error: err.message});
  }
});

// ---------------------- RUTA PARA EXPORTAR PDF (CREAR WORKITEM) -----------
/**
 * Recibe: 
 *   req.body.urn  => Revit model URN (o local path si lo subes)
 *   req.body.activityName => "MyPluginActivity"
 *   req.body.drawingSheet, req.body.threeD, etc. => vistas
 *   req.body.browserConnectionId => para Socket.IO
 */
router.post("/api/designautomation/v1/revit/exportPDF", async (req, res) => {
  const {
    urn,
    activityName,
    drawingSheet,
    threeD,
    detail,
    elevation,
    floorPlan,
    section,
    rendering,
    browserConnectionId
  } = req.body;

  // 1) Validar
  if (!urn || !activityName) {
    return res.status(400).json({ error: "Faltan URN o activityName" });
  }
  // 2) Tomar token 2-Legged
  const daApi = await Utils.dav3API(req.oauth_token);
  // 3) Subir (opcional). 
  //    Ejemplo: si URN es "adsk.objects:..." ya está en OSS. 
  //    Si no, sube el .rvt a un bucket y obtén la "URL".
  //    Aquí harías algo como new ForgeAPI.BucketsApi() / new ForgeAPI.ObjectsApi()...
  //    Dejo simplificado con un "inputRvtUrl" igual a URN.

  const inputRvtUrl = "alguna URL OSObject " + urn; // placeholder

  // 4) Construir inputJson con vistas
  const inputJson = {
    DrawingSheet: drawingSheet,
    ThreeD:       threeD,
    Detail:       detail,
    Elevation:    elevation,
    FloorPlan:    floorPlan,
    Section:      section,
    Rendering:    rendering
  };
  // Nota: tu plugin .NET dentro del AppBundle leerá "params.json" y sabrá qué vistas exportar.

  // 5) Preparar arguments
  const bearerToken = "Bearer " + req.oauth_token.access_token;
  const inputFileArg = {
    url: inputRvtUrl,
    headers: { Authorization: bearerToken }
  };
  const inputJsonArg = {
    url: "data:application/json," + JSON.stringify(inputJson)
  };
  const outputFileArg = {
    url: "data:application/octet-stream", // Por DEMO; normalmente pondrías un OSS.  
    verb: dav3.Verb.put
  };

  // 6) Construir workItemSpec
  // const fullActivityId = `${Utils.NickName}.${activityName}+${Utils.Alias}`;
  const fullActivityId = activityName;
  
  console.log("----- WorkItemSpec about to be sent -----");
  console.log(JSON.stringify(workItemSpec, null, 2));
  console.log("Full Activity ID:", fullActivityId);
  console.log("REQ.BODY =>", JSON.stringify(req.body));

  const workItemSpec = {
    activityId: fullActivityId,
    arguments: {
      inputFile:  inputFileArg,
      inputJson:  inputJsonArg,
      outputFile: outputFileArg
    }
  };

  let workItemStatus;
  try {
    workItemStatus = await daApi.createWorkItem(workItemSpec);
    // 7) (Opcional) Monitor o devolver. 
    //    Si usas callback, no hace falta monitor. 
    //    Si usas polling, haz un setInterval en el front.
    //    En tu caso usas "monitorWorkItem" + Socket.IO, hazlo:

    monitorWorkItem(
      req.oauth_client,
      req.oauth_token, 
      workItemStatus.id,
      browserConnectionId
    );

  } catch(err) {
    console.error("Failed to create WorkItem =>", err);
    return res.status(500).json({ error: err.message });
  }

  res.json({
    workItemId:     workItemStatus.id,
    workItemStatus: workItemStatus.status
  });
});

// ----------------------- MONITOR WORKITEM (SOCKET) -----------
async function monitorWorkItem(oauthClient, oauthToken, workItemId, browserConnectionId) {
  const socketIO = require('../server').io; // Ajusta la ruta a tu server
  // Bucle de 2 seg en 2 seg
  try {
    while (true) {
      await new Promise(r => setTimeout(r, 2000));
      const daApi = await Utils.dav3API(oauthToken);
      const status = await daApi.getWorkitemStatus(workItemId);
      // Envía a front
      socketIO.to(browserConnectionId).emit("onComplete", status);

      if (status.status === "pending" || status.status === "inprogress") {
        continue;
      }

      // Descarga o no. 
      if (status.status === "success") {
        // Aqui si tu "outputFile" es un OSS object, obtén URL con getS3DownloadURL
        // Por DEMO: 
        const pdfUrl = "https://myoss.../some.pdf"; 
        socketIO.to(browserConnectionId).emit("downloadResult", pdfUrl);
      } else {
        socketIO.to(browserConnectionId).emit("onError", { message: "WorkItem failed" });
      }
      return; // Sale del bucle
    }
  } catch(err) {
    console.error("monitorWorkItem error:", err);
    socketIO.to(browserConnectionId).emit("onError", err);
  }
}

// ---------------------- CALLBACK (opcional) ---------------------
// Si usas callback en tu Activity, regístrala aquí:
router.post("/api/designautomation/callback", async (req, res) => {
  // Basta con hacer un 202 OK
  res.status(202).end();
  console.log("Callback triggered with body:", req.body);
  // ... Parsear req.body.id, etc.
  // ... Llamar a getWorkitemStatus(...) + socket.io si gustas.
});

// ---------------------- CLEAR ACCOUNT (DEBUG) -------------------
router.delete("/api/designautomation/account", async (req, res) => {
  try {
    const daApi = await Utils.dav3API(req.oauth_token);
    await daApi.deleteForgeApp("me");
    res.status(200).end();
  } catch(err) {
    console.error("Failed to clear account:", err);
    res.status(500).end();
  }
});

module.exports = router;

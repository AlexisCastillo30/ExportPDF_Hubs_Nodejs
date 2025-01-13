// server.js
const path = require("path");
const express = require("express");
const cookieSession = require("cookie-session");
const { PORT, SERVER_SESSION_SECRET, credentials } = require("./config.js");

// 1) Verificar credenciales
if (!credentials.client_id || !credentials.client_secret) {
  console.error("Missing APS_CLIENT_ID or APS_CLIENT_SECRET env variables.");
  process.exit(1); // Detiene la ejecución
}

// 2) Importar las rutas
const authRoutes = require("./routes/auth.js");             // Maneja /api/auth/...
const hubsRoutes = require("./routes/hubs.js");             // Maneja /api/hubs/...
const designAutomationRoutes = require("./routes/DesignAutomation.js"); 
// En designAutomation.js defines, por ejemplo:
//  - GET  /appbundles                => se convierte en /api/appbundles
//  - GET  /aps/designautomation/...  => se convierte en /api/aps/designautomation/...
//  - POST /aps/designautomation/...  => se convierte en /api/aps/designautomation/...

// 3) Crear la app de Express
const app = express();

// 4) Servir estáticos desde la carpeta "wwwroot"
app.use(express.static(path.join(__dirname, "wwwroot")));

// 5) Manejo de sesiones
app.use(
  cookieSession({
    name: "aps_session",
    keys: [SERVER_SESSION_SECRET || "aps_secure_key"],
    maxAge: 60 * 60 * 1000, // 1 hora
  })
);

// 6) Parseo de JSON y forms
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));

// 7) Montar rutas de autenticación y hubs (si definen /api/auth/... y /api/hubs/...)
app.use(authRoutes);
app.use(hubsRoutes);

// 8) Montar rutas de Design Automation en "/api"
app.use("/api", designAutomationRoutes);

// 9) Iniciar servidor en el puerto deseado
const finalPort = PORT || 8080;
app.listen(finalPort, () => {
  console.log(`Server listening on port ${finalPort}...`);
});

// Exportar 'app' en caso de que quieras usarlo en otro lugar (socket.io, etc.)
module.exports = app;

// start.js
const app = require("./server");  // El server.js anterior
const socketIO = require("./socket.io")(app);

// Puerto
const finalPort = app.get("port") || process.env.PORT || 8080;

let server = socketIO.http.listen(finalPort, () => {
  console.log(`Server listening on port ${finalPort}...`);
});

server.on("error", (err) => {
  if (err.errno === "EACCES") {
    console.error(`Port ${finalPort} already in use.\nExiting...`);
    process.exit(1);
  }
});

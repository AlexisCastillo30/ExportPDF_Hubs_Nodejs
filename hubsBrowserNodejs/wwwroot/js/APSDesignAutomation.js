// wwwroot/js/APSDesignAutomation.js

$(document).ready(function () {
  prepareLists();

  // Botones
  $("#clearAccount").click(clearAccount);
  $("#defineActivityShow").click(defineActivityModal);
  $("#createAppBundleActivity").click(createAppBundleActivity);

  // Exportar PDF
  $("#startWorkitem").click(startExportPDF);
  $("#cancelBtn").click(cancelExportPDF);

  // Socket.IO
  startConnection();
});

/**
 * PARTE 1: LISTAS Y CREACIÓN DE APPBUNDLE & ACTIVITY
 */
function prepareLists() {
  list("activity", "/api/aps/designautomation/activities");
  list("engines", "/api/aps/designautomation/engines");
  list("localBundles", "/api/appbundles");
}

function list(control, endpoint) {
  $("#" + control).empty();
  $.ajax({
    url: endpoint,
    success: function (items) {
      if (!items || items.length === 0) {
        $("#" + control).append(
          $("<option>", { disabled: true, text: "Nothing found" })
        );
      } else {
        items.forEach(function (item) {
          $("#" + control).append(
            $("<option>", { value: item, text: item })
          );
        });
      }
      writeLog(`Successfully listed ${control}: ${items ? items.length : 0} item(s).`);
    },
    error: function (err) {
      console.error("Error listing " + control, err);
      writeLog(`Failed to list ${control}: ${err.statusText || err.message}`);
    }
  });
}

function clearAccount() {
  if (!confirm("Clear existing activities & appbundles? Esto es irreversible.")) {
    return;
  }
  $.ajax({
    url: "/api/aps/designautomation/account",
    method: "DELETE",
    success: function () {
      prepareLists();
      writeLog("Account cleared, all appbundles & activities deleted");
    },
    error: function (err) {
      console.error("Failed to clear account:", err);
      writeLog("Failed to clear account: " + (err.statusText || err.message));
      alert("Failed to clear account.");
    }
  });
}

function defineActivityModal() {
  $("#defineActivityModal").modal();
}

/**
 * Esta función cierra el modal inmediatamente (con .toggle()),
 * tal como en el ejemplo original, y luego llama a createAppBundle() y createActivity().
 */
function createAppBundleActivity() {
  startConnection(function () {
    writeLog("Defining appbundle and activity for engine: " + $("#engines").val());

    // Igual que el ejemplo: cierra el modal (toggle) y luego crea
    $("#defineActivityModal").modal("toggle"); 

    createAppBundle(function () {
      createActivity(function () {
        // Refresca la lista de Activities y Bundles
        prepareLists();
      });
    });
  });
}

/** POST /api/aps/designautomation/appbundles */
function createAppBundle(cb) {
  $.ajax({
    url: "/api/aps/designautomation/appbundles",
    method: "POST",
    contentType: "application/json",
    data: JSON.stringify({
      zipFileName: $("#localBundles").val(),
      engine: $("#engines").val()
    }),
    success: function (res) {
      writeLog(`AppBundle created/updated: ${res.appBundle}, v${res.version}`);
      if (cb) cb();
    },
    error: function (xhr, ajaxOptions, thrownError) {
      writeLog("Failed to create AppBundle: " + getErrorMsg(xhr, thrownError));
    }
  });
}

/** POST /api/aps/designautomation/activities */
function createActivity(cb) {
  $.ajax({
    url: "/api/aps/designautomation/activities",
    method: "POST",
    contentType: "application/json",
    data: JSON.stringify({
      zipFileName: $("#localBundles").val(),
      engine: $("#engines").val()
    }),
    success: function (res) {
      writeLog("Activity created/updated: " + res.activity);
      if (cb) cb();
    },
    error: function (xhr, ajaxOptions, thrownError) {
      writeLog("Failed to create Activity: " + getErrorMsg(xhr, thrownError));
    }
  });
}


/**
 * PARTE 2: EXPORTACIÓN A PDF
 */
let workingItem = null;

async function startExportPDF() {
  const versionStorage = getSelectedVersionStorage();

  const drawingSheet = $('#drawingSheet').prop('checked');
  const threeD       = $('#threeD').prop('checked');
  const detail       = $('#detail').prop('checked');
  const elevation    = $('#elevation').prop('checked');
  const floorPlan    = $('#floorPlan').prop('checked');
  const section      = $('#section').prop('checked');
  const rendering    = $('#rendering').prop('checked');

  if (!drawingSheet && !threeD && !detail && !elevation && !floorPlan && !section && !rendering) {
    return alert("Selecciona al menos un tipo de vista");
  }
  if (!$("#activity").val()) {
    return alert("Por favor selecciona una Actividad antes de exportar.");
  }

  startConnection(async function () {
    updateStatus("started");
    writeLog("Iniciando exportación a PDF...");

    try {
      const res = await $.ajax({
        url: `/api/aps/designautomation/v1/revit/${encodeURIComponent(versionStorage)}/pdf`,
        type: "GET",
        data: {
          DrawingSheet: drawingSheet,
          ThreeD: threeD,
          Detail: detail,
          Elevation: elevation,
          FloorPlan: floorPlan,
          Section: section,
          Rendering: rendering,
          ActivityName: $("#activity").val(),
          browserConnectionId: connectionId
        }
      });

      workingItem = res.workItemId;
      writeLog(`Workitem created. ID: ${workingItem}`);
      updateStatus(res.workItemStatus || "pending");
    } catch (err) {
      console.error("Error starting PDF export:", err);
      writeLog("Falló la creación de WorkItem: " + (err.message || err));
      updateStatus("failed");
    }
  });
}

/** Cancela el WorkItem (si tu API lo soporta) */
async function cancelExportPDF() {
  if (!workingItem) {
    return alert("No hay WorkItem en proceso para cancelar.");
  }

  try {
    await $.ajax({
      url: `/api/aps/designautomation/v1/revit/${encodeURIComponent(workingItem)}`,
      type: "DELETE"
    });
    writeLog(`WorkItem ${workingItem} cancelado.`);
    updateStatus("cancelled");
    workingItem = null;
  } catch (err) {
    console.error("Error canceling WorkItem:", err);
    writeLog("No se pudo cancelar el WorkItem: " + (err.message || err));
    alert("No se pudo cancelar el WorkItem.");
  }
}

/** Actualiza la barra y el mensaje de estado */
function updateStatus(status) {
  const progress = $("#parametersUpdateProgressBar");
  const statusText = $("#statusText");

  switch (status.toLowerCase()) {
    case "started":
      progress.css("width", "20%");
      statusText.html("<h4>Subiendo datos...</h4>");
      $("#startWorkitem").prop("disabled", true);
      $("#cancelBtn").prop("disabled", true);
      break;
    case "pending":
      progress.css("width", "40%");
      statusText.html("<h4>Ejecutando Design Automation...</h4>");
      $("#startWorkitem").prop("disabled", true);
      $("#cancelBtn").prop("disabled", false);
      break;
    case "completed":
      progress.css("width", "100%");
      statusText.html("<h4>Completado. Puedes descargar tu PDF.</h4>");
      $("#startWorkitem").prop("disabled", false);
      $("#cancelBtn").prop("disabled", true);
      workingItem = null;
      break;
    case "failed":
      progress.css("width", "0%");
      statusText.html("<h4>Falló el proceso</h4>");
      $("#startWorkitem").prop("disabled", false);
      $("#cancelBtn").prop("disabled", true);
      break;
    case "cancelled":
      progress.css("width", "0%");
      statusText.html("<h4>Proceso cancelado</h4>");
      $("#startWorkitem").prop("disabled", false);
      $("#cancelBtn").prop("disabled", true);
      break;
    default:
      statusText.html(`<h4>${status}</h4>`);
  }
}

function getSelectedVersionStorage() {
  return "urn:adsk.objects:os.object:my-bucket/my-file.rvt";
}

/**
 * PARTE 3: SOCKET.IO + LOGS
 */
var connection;
var connectionId;

function startConnection(onReady) {
  if (connection && connection.connected) {
    if (onReady) onReady();
    return;
  }
  connection = io();
  connection.on("connect", function () {
    connectionId = connection.id;
    if (onReady) onReady();
  });

  connection.on("downloadResult", function (url) {
    writeLog('<a href="' + url + '" target="_blank">Descarga PDF aquí</a>');
    updateStatus("completed");
  });

  connection.on("downloadReport", function (url) {
    writeLog('<a href="' + url + '" target="_blank">Descarga reporte aquí</a>');
  });

  connection.on("onComplete", function (message) {
    if (typeof message === "object") {
      message = JSON.stringify(message, null, 2);
    }
    writeLog("onComplete => " + message);
  });

  connection.on("onError", function (err) {
    console.error("Workitem Error:", err);
    writeLog("Workitem Error => " + (err.message || err));
    updateStatus("failed");
  });
}

function writeLog(text) {
  $("#outputlog").append(
    '<div style="border-top: 1px dashed #C0C0C0; padding: 5px 0;">' + text + "</div>"
  );
  const elem = document.getElementById("outputlog");
  if (elem) {
    elem.scrollTop = elem.scrollHeight;
  }
}

function getErrorMsg(xhr, thrownError) {
  if (xhr.responseJSON && xhr.responseJSON.diagnostic) {
    return xhr.responseJSON.diagnostic;
  }
  return thrownError || "Unknown error";
}

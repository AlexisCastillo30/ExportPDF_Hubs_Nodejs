// wwwroot/js/APSDesignAutomation.js
$(document).ready(function () {
  // 1) Preparar listas iniciales (Activities, Engines, Bundles)
  prepareLists();

  // 2) Botones de configuración:
  $("#clearAccount").click(clearAccount);
  $("#defineActivityShow").click(defineActivityModal);
  $("#createAppBundleActivity").click(createAppBundleActivity);

  // 3) Botones de exportar a PDF
  $("#startWorkitem").click(startExportPDF); 
  $("#cancelBtn").click(cancelExportPDF);

  // 4) Iniciamos conexión Socket.IO
  startConnection();
});

/**
 * PARTE 1: LISTAS Y CREACIÓN DE APPBUNDLE & ACTIVITY
 * (MISMA ESTRUCTURA QUE EL EJEMPLO ORIGINAL)
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
    },
    error: function (err) {
      console.error("Error listing " + control, err);
    }
  });
}

/** Elimina todas las Activities y AppBundles de tu cuenta. */
function clearAccount() {
  if (
    !confirm(
      "Clear existing activities & appbundles? Esto es irreversible."
    )
  ) {
    return;
  }

  $.ajax({
    url: "/api/aps/designautomation/account",
    method: "DELETE",
    success: function () {
      writeLog("Account cleared, all appbundles & activities deleted");
      prepareLists();
    },
    error: function (err) {
      console.error(err);
      alert("Failed to clear account.");
    }
  });
}

/** Muestra el modal con <select id="localBundles"> y <select id="engines"> */
function defineActivityModal() {
  $("#defineActivityModal").modal();
}

/** Crea/actualiza AppBundle & Activity */
function createAppBundleActivity() {
  startConnection(function () {
    writeLog("Defining appbundle and activity for " + $("#engines").val());
    $("#defineActivityModal").modal("toggle");

    createAppBundle(function () {
      createActivity(function () {
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
      writeLog("AppBundle: " + res.appBundle + ", v" + res.version);
      if (cb) cb();
    },
    error: function (xhr, ajaxOptions, thrownError) {
      writeLog(
        " -> " + getErrorMsg(xhr, thrownError)
      );
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
      writeLog("Activity: " + res.activity);
      if (cb) cb();
    },
    error: function (xhr, ajaxOptions, thrownError) {
      writeLog(
        " -> " + getErrorMsg(xhr, thrownError)
      );
    }
  });
}

/**
 * PARTE 2: EXPORTACIÓN A PDF (checklists, cancelación, barra de progreso)
 * Reemplaza la antigua startWorkitem() con la lógica de PDF
 */
let workingItem = null;

/** Inicia el WorkItem de exportar PDF */
async function startExportPDF() {
  // Por ejemplo, obtener la URN/Versión
  const versionStorage = getSelectedVersionStorage();

  // Leer checkboxes
  const drawingSheet = $('#drawingSheet').prop('checked');
  const threeD       = $('#threeD').prop('checked');
  const detail       = $('#detail').prop('checked');
  const elevation    = $('#elevation').prop('checked');
  const floorPlan    = $('#floorPlan').prop('checked');
  const section      = $('#section').prop('checked');
  const rendering    = $('#rendering').prop('checked');

  // Validación
  if (
    !drawingSheet &&
    !threeD &&
    !detail &&
    !elevation &&
    !floorPlan &&
    !section &&
    !rendering
  ) {
    return alert("Selecciona al menos un tipo de vista");
  }

  // Verificar Activity
  if (!$("#activity").val()) {
    return alert("Por favor selecciona una Actividad antes de exportar.");
  }

  startConnection(async function () {
    updateStatus("started");
    writeLog("Iniciando exportación a PDF...");

    try {
      // Llamada a tu endpoint real
      // (ajusta GET o POST según tu implementación)
      const res = await $.ajax({
        url: `/api/aps/designautomation/v1/revit/${encodeURIComponent(
          versionStorage
        )}/pdf`,
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

      // El backend debería retornar { workItemId, workItemStatus...}
      workingItem = res.workItemId;
      updateStatus(res.workItemStatus || "pending");
    } catch (err) {
      console.error(err);
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
      url: `/api/aps/designautomation/v1/revit/${encodeURIComponent(
        workingItem
      )}`,
      type: "DELETE"
    });
    writeLog(`WorkItem ${workingItem} cancelado.`);
    updateStatus("cancelled");
    workingItem = null;
  } catch (err) {
    console.error(err);
    alert("No se pudo cancelar el WorkItem.");
  }
}

/** Actualiza barra de progreso y mensajes */
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

/** Ajusta para obtener la versión "storage" (URN) real */
function getSelectedVersionStorage() {
  // Ajusta tu propia lógica para obtener la URN (ej. "urn:adsk.objects:os.object:...")
  return "urn:adsk.objects:os.object:my-bucket/my-file.rvt";
}

/**
 * PARTE 3: CONEXIÓN SOCKET.IO + LOGS
 */
var connection;
var connectionId;

function startConnection(onReady) {
  if (connection && connection.connected) {
    if (onReady) onReady();
    return;
  }
  // Asumiendo <script src="/socket.io/socket.io.js"></script>
  connection = io();
  connection.on("connect", function () {
    connectionId = connection.id;
    if (onReady) onReady();
  });

  // Resultado final (PDF)
  connection.on("downloadResult", function (url) {
    writeLog('<a href="' + url + '" target="_blank">Descarga PDF aquí</a>');
    updateStatus("completed");
  });

  // Report
  connection.on("downloadReport", function (url) {
    writeLog('<a href="' + url + '" target="_blank">Descarga reporte aquí</a>');
  });

  // onComplete
  connection.on("onComplete", function (message) {
    if (typeof message === "object") {
      message = JSON.stringify(message, null, 2);
    }
    writeLog("onComplete => " + message);
  });

  // onError
  connection.on("onError", function (err) {
    console.error("Workitem Error:", err);
    writeLog("Workitem Error => " + (err.message || err));
    updateStatus("failed");
  });
}

/** Imprime logs en #outputlog (puede ser <div> o <pre>) */
function writeLog(text) {
  $("#outputlog").append(
    '<div style="border-top: 1px dashed #C0C0C0; padding: 5px 0;">' +
      text +
      "</div>"
  );
  const elem = document.getElementById("outputlog");
  if (elem) {
    elem.scrollTop = elem.scrollHeight;
  }
}

/** Helper: obtiene mensaje de error (opcional) */
function getErrorMsg(xhr, thrownError) {
  if (xhr.responseJSON && xhr.responseJSON.diagnostic) {
    return xhr.responseJSON.diagnostic;
  }
  return thrownError || "Unknown error";
}

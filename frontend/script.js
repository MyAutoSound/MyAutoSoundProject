let mediaRecorder;
let recordedChunks = [];
let history = [];

document.addEventListener("DOMContentLoaded", () => {
  const recordButton = document.getElementById("recordButton");
  const recordedAudio = document.getElementById("recordedAudio");
  const recordingStatus = document.getElementById("recordingStatus");
  const diagnosisForm = document.getElementById("diagnosisForm");
  const historyList = document.getElementById("historyList");
  const clearButton = document.getElementById("clearHistoryButton");
  const loadingEl = document.getElementById("loading");
  const submitBtn = diagnosisForm?.querySelector('button[type="submit"]');

  // ---- Historique depuis localStorage
  try {
    const saved = localStorage.getItem("diagnosisHistory");
    if (saved) {
      history = JSON.parse(saved) || [];
      renderHistory();
    }
  } catch (_) {}

  // ---- Enregistrement micro
  recordButton?.addEventListener("click", async (e) => {
    e.preventDefault();

    if (!mediaRecorder || mediaRecorder.state === "inactive") {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });

        recordedChunks = [];
        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) recordedChunks.push(e.data);
        };

        mediaRecorder.onstop = () => {
          const blob = new Blob(recordedChunks, { type: "audio/webm" });
          const url = URL.createObjectURL(blob);
          recordedAudio.src = url;
          recordedAudio.classList.remove("hidden");
          recordedAudio.recordedBlob = blob;
          recordingStatus.textContent = "Recording stopped.";
        };

        mediaRecorder.start();
        recordButton.textContent = "⏹️ Stop Recording";
        recordingStatus.textContent = "Recording...";
      } catch (err) {
        console.error(err);
        alert("Microphone permission denied or not available.");
      }
    } else if (mediaRecorder.state === "recording") {
      mediaRecorder.stop();
      recordButton.textContent = "🎤 Start Recording";
    }
  });

  // ---- Soumission du formulaire
  diagnosisForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    toggleLoading(true);

    try {
      // 1) Construit un JSON structuré (via la fonction globale si présente, sinon fallback DOM)
      const payload = (typeof window.buildDiagnosisPayload === "function")
        ? window.buildDiagnosisPayload()
        : buildDiagnosisPayloadFallback();

      // 2) FormData (audio + champs legacy + report JSON)
      const fd = new FormData();
      // Champs legacy (compat backend existant)
      fd.append("description", payload.description || "");
      fd.append("location", payload.location || "");
      fd.append("situation", payload.primarySituation || "");
      fd.append("makeModel", (payload?.vehicle?.makeModel) || "");
      fd.append("notes", payload.notes || "");

      // Report structuré pour l'IA (nouveau)
      fd.append("report", JSON.stringify(payload));

      // Audio: fichier uploadé > enregistrement micro > rien
      const fileInput = document.getElementById("audioFile");
      if (fileInput?.files?.length > 0) {
        fd.append("audio", fileInput.files[0]);
      } else if (recordedAudio?.recordedBlob) {
        const file = new File([recordedAudio.recordedBlob], "recording.webm", { type: "audio/webm" });
        fd.append("audio", file);
      }

      // 3) Appel API
      const res = await fetch("https://myautosoundproject.onrender.com/diagnose", {
        method: "POST",
        body: fd,
      });

      let data;
      try {
        data = await res.json();
      } catch {
        throw new Error("Invalid JSON response from server.");
      }
      if (!res.ok) {
        throw new Error(data?.error || `Server error (${res.status})`);
      }

      // 4) Affichage résultat
      toggleLoading(false);
      displayDiagnosis(data);

      // 5) Historique (on stocke aussi un résumé du payload)
      const now = new Date().toLocaleString();
      history.unshift({
        timestamp: now,
        diagnosis: data.diagnosis || "",
        severity: data.severity || "",
        dangerLevel: data.dangerLevel || "",
        payloadSummary: {
          description: payload.description,
          location: payload.location,
          primarySituation: payload.primarySituation,
          soundLabels: payload?.soundProfile?.labels || [],
        }
      });
      // Limite l’historique à 50 entrées
      if (history.length > 50) history = history.slice(0, 50);
      localStorage.setItem("diagnosisHistory", JSON.stringify(history));
      renderHistory();

    } catch (err) {
      console.error(err);
      toggleLoading(false);
      alert(err.message || "An error occurred while diagnosing.");
    }
  });

  clearButton?.addEventListener("click", () => {
    localStorage.removeItem("diagnosisHistory");
    history = [];
    renderHistory();
  });

  // ---- Helpers UI
  function toggleLoading(on) {
    if (!loadingEl) return;
    if (on) {
      loadingEl.classList.remove("hidden");
      submitBtn && (submitBtn.disabled = true);
    } else {
      loadingEl.classList.add("hidden");
      submitBtn && (submitBtn.disabled = false);
    }
  }

  function displayDiagnosis(data) {
    const resultWrap = document.getElementById("diagnosisResult");
    const timestampText = document.getElementById("timestampText");
    const content = document.getElementById("diagnosisContent");
    const suggestionsDiv = document.getElementById("diagnosisSuggestions");

    const now = new Date().toLocaleString();
    resultWrap?.classList.remove("hidden");
    if (timestampText) timestampText.textContent = now;

    content.innerHTML = `
      <div class="bg-white p-4 rounded-lg shadow-md space-y-3">
        <h3 class="text-lg font-semibold text-blue-800">🛠 Diagnostic :</h3>
        <p>${escapeHTML(data.diagnosis || "No diagnosis.")}</p>

        ${data.message ? `<p class="text-sm text-gray-700"><strong>Message :</strong> ${escapeHTML(data.message)}</p>` : ""}
        ${data.severity ? `<p class="text-sm"><strong>⚠️ Severity :</strong> <span class="${getSeverityColor(data.severity)}">${escapeHTML(data.severity)}</span></p>` : ""}
        ${data.dangerLevel ? `<p class="text-sm"><strong>🔥 Danger :</strong> <span class="${getDangerColor(data.dangerLevel)}">${escapeHTML(data.dangerLevel)}</span></p>` : ""}
        ${data.costEstimate ? `<p class="text-sm"><strong>💰 Cost Estimate :</strong> ${escapeHTML(data.costEstimate)}</p>` : ""}
        ${data.nextStep ? `<p class="text-sm"><strong>Next Step :</strong> ${escapeHTML(data.nextStep)}</p>` : ""}
        ${data.transcript ? `<div class="bg-gray-100 p-2 rounded"><strong>🎙️ Transcription :</strong> ${escapeHTML(data.transcript)}</div>` : ""}
      </div>
    `;

    suggestionsDiv.innerHTML = "";
    if (Array.isArray(data.suggestions) && data.suggestions.length) {
      suggestionsDiv.innerHTML = `
        <div class="mt-4">
          <strong>Find tutorial and Auto Parts :</strong>
          <ul class="list-disc ml-6 mt-2 space-y-1">
            ${data.suggestions
              .map(s => {
                const url = typeof s === "string" ? s : s.url;
                const text = typeof s === "string" ? s : s.text || s.url;
                const safeText = escapeHTML(text || "Link");
                const safeUrl = escapeAttr(url || "#");
                return `<li><a href="${safeUrl}" target="_blank" rel="noopener" class="text-blue-600 hover:underline">🔧 ${safeText}</a></li>`;
              })
              .join("")}
          </ul>
        </div>
      `;
    }
  }

  function renderHistory() {
    if (!historyList) return;
    historyList.innerHTML = "";
    history.forEach((entry) => {
      const div = document.createElement("div");
      div.className = "border-b border-gray-300 pb-2 mb-2";
      div.innerHTML = `
        <div class="text-sm text-gray-500">${escapeHTML(entry.timestamp || "")}</div>
        <div class="text-gray-800">${escapeHTML(entry.diagnosis || "")}</div>
        ${
          entry?.payloadSummary
            ? `<div class="text-xs text-gray-500 mt-1">
                <span class="font-semibold">Context:</span>
                ${escapeHTML(entry.payloadSummary.description || "")}
                ${entry.payloadSummary.location ? ` · ${escapeHTML(entry.payloadSummary.location)}` : ""}
                ${entry.payloadSummary.primarySituation ? ` · ${escapeHTML(entry.payloadSummary.primarySituation)}` : ""}
                ${
                  Array.isArray(entry.payloadSummary.soundLabels) && entry.payloadSummary.soundLabels.length
                    ? ` · ${escapeHTML(entry.payloadSummary.soundLabels.join(", "))}`
                    : ""
                }
               </div>`
            : ""
        }
      `;
      historyList.appendChild(div);
    });
  }

  function getSeverityColor(level) {
    const l = (level || "").toLowerCase();
    if (l.includes("high") || l.includes("élevée")) return "text-red-600 font-bold";
    if (l.includes("medium") || l.includes("moyenne")) return "text-yellow-600 font-semibold";
    return "text-green-600 font-medium";
  }

  function getDangerColor(level) {
    const l = (level || "").toLowerCase();
    if (l.includes("urgent") || l.includes("critique")) return "text-red-700 font-bold";
    if (l.includes("moderate") || l.includes("modéré")) return "text-yellow-700 font-semibold";
    return "text-green-700 font-medium";
  }

  // ---- Fallback si window.buildDiagnosisPayload n’est pas injecté
  function buildDiagnosisPayloadFallback() {
    const $ = (id) => document.getElementById(id);
    const getChecks = (name) => [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(el => el.value);

    return {
      description: $("textInput")?.value?.trim() || "",
      audioAttached: !!document.getElementById("audioFile")?.files?.length || !!recordedAudio?.recordedBlob,
      location: $("location")?.value || null,
      primarySituation: $("situation")?.value || null,
      situations: getChecks("when"),
      soundProfile: {
        labels: getChecks("soundType"),
        rhythm: $("rhythm")?.value || null,
        duration: $("duration")?.value || null,
        pitchLevel: Number($("pitch")?.value || 0),
        severityLevel: Number($("severity")?.value || 0),
      },
      driving: {
        speedRange: $("speedRange")?.value || null,
        reproducible: $("reproducible")?.value || null,
      },
      vehicle: {
        makeModel: $("makeModel")?.value?.trim() || null,
        mileage: $("mileage")?.value ? Number($("mileage").value) : null,
        transmission: $("transmission")?.value || null,
        fuel: $("fuel")?.value || null,
        obdCode: $("obdCode")?.value?.trim() || null,
        warningLights: getChecks("warning"),
      },
      recentEvents: getChecks("recent"),
      notes: $("notes")?.value?.trim() || "",
      timestamp: new Date().toISOString(),
    };
  }

  // ---- petites fonctions d’échappement
  function escapeHTML(str) {
    return (str || "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[m]));
  }
  function escapeAttr(str) {
    return (str || "").replace(/"/g, "&quot;");
  }
});

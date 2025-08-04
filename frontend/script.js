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

  // Charger l'historique depuis le localStorage
  const saved = localStorage.getItem("diagnosisHistory");
  if (saved) {
    history = JSON.parse(saved);
    renderHistory();
  }

  recordButton.addEventListener("click", async (e) => {
    e.preventDefault();

    if (!mediaRecorder || mediaRecorder.state === "inactive") {
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
    } else if (mediaRecorder.state === "recording") {
      mediaRecorder.stop();
      recordButton.textContent = "🎤 Start Recording";
    }
  });

  diagnosisForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const formData = new FormData();
    const textInput = document.getElementById("textInput").value;
    const location = document.getElementById("location").value;
    const situation = document.getElementById("situation").value;
    const makeModel = document.getElementById("makeModel").value;
    const notes = document.getElementById("notes").value;
    const fileInput = document.getElementById("audioFile");

    formData.append("description", textInput);
    formData.append("location", location);
    formData.append("situation", situation);
    formData.append("makeModel", makeModel);
    formData.append("notes", notes);

    if (fileInput.files.length > 0) {
      formData.append("audio", fileInput.files[0]);
    } else if (recordedAudio.recordedBlob) {
      const file = new File([recordedAudio.recordedBlob], "recording.webm", {
        type: "audio/webm",
      });
      formData.append("audio", file);
    }

    document.getElementById("loading").classList.remove("hidden");

   const response = await fetch("https://myautosoundproject.onrender.com/diagnose", {

      method: "POST",
      body: formData,
    });

    const data = await response.json();
    document.getElementById("loading").classList.add("hidden");

    if (data.diagnosis) {
      const now = new Date().toLocaleString();
      document.getElementById("diagnosisResult").classList.remove("hidden");
      document.getElementById("timestampText").textContent = now;

      const content = document.getElementById("diagnosisContent");
      content.innerHTML = `
        <div class="bg-white p-4 rounded-lg shadow-md space-y-3">
          <h3 class="text-lg font-semibold text-blue-800">🛠 Diagnostic :</h3>
          <p>${data.diagnosis}</p>

          ${data.message ? `<p class="text-sm text-gray-700"><strong> Message :</strong> ${data.message}</p>` : ""}
          ${data.severity ? `<p class="text-sm"><strong>⚠️ Severity :</strong> <span class="${getSeverityColor(data.severity)}">${data.severity}</span></p>` : ""}
          ${data.dangerLevel ? `<p class="text-sm"><strong>🔥 Danger :</strong> <span class="${getDangerColor(data.dangerLevel)}">${data.dangerLevel}</span></p>` : ""}
          ${data.costEstimate ? `<p class="text-sm"><strong>💰 Cost Estimate :</strong> ${data.costEstimate}</p>` : ""}
          ${data.nextStep ? `<p class="text-sm"><strong> Next Step :</strong> ${data.nextStep}</p>` : ""}
          ${data.transcript ? `<div class="bg-gray-100 p-2 rounded"><strong>🎙️ Transcription :</strong> ${data.transcript}</div>` : ""}
        </div>
      `;

      const suggestionsDiv = document.getElementById("diagnosisSuggestions");
      suggestionsDiv.innerHTML = "";
      if (Array.isArray(data.suggestions)) {
        suggestionsDiv.innerHTML = `
          <div class="mt-4">
            <strong>Find tutorial and Auto Parts :</strong>
            <ul class="list-disc ml-6 mt-2 space-y-1">
              ${data.suggestions.map(s => `<li><a href="${s.url}" target="_blank" class="text-blue-600 hover:underline">🔧 ${s.text}</a></li>`).join('')}
            </ul>
          </div>
        `;
      }

      history.unshift({
        diagnosis: data.diagnosis,
        timestamp: now,
      });
      localStorage.setItem("diagnosisHistory", JSON.stringify(history));
      renderHistory();
    } else {
      alert("No diagnosis received.");
    }
  });

  clearButton.addEventListener("click", () => {
    localStorage.removeItem("diagnosisHistory");
    history = [];
    renderHistory();
  });

  function renderHistory() {
    historyList.innerHTML = "";
    history.forEach((entry) => {
      const div = document.createElement("div");
      div.className = "border-b border-gray-300 pb-2 mb-2";
      div.innerHTML = `
        <div class="text-sm text-gray-500">${entry.timestamp}</div>
        <div class="text-gray-800">${entry.diagnosis}</div>
      `;
      historyList.appendChild(div);
    });
  }

  function getSeverityColor(level) {
    const l = level.toLowerCase();
    if (l.includes("high") || l.includes("élevée")) return "text-red-600 font-bold";
    if (l.includes("medium") || l.includes("moyenne")) return "text-yellow-600 font-semibold";
    return "text-green-600 font-medium";
  }

  function getDangerColor(level) {
    const l = level.toLowerCase();
    if (l.includes("urgent") || l.includes("critique")) return "text-red-700 font-bold";
    if (l.includes("moderate") || l.includes("modéré")) return "text-yellow-700 font-semibold";
    return "text-green-700 font-medium";
  }
});


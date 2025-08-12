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
  const downloadBtn = document.getElementById('downloadPdfBtn');

  // ---- Historique depuis localStorage
  try {
    const saved = localStorage.getItem("diagnosisHistory");
    if (saved) {
      history = JSON.parse(saved) || [];
      renderHistory();
    }
  } catch {}

  // ---- Enregistrement micro
  recordButton?.addEventListener("click", async (e) => {
    e.preventDefault();
    if (!mediaRecorder || mediaRecorder.state === "inactive") {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });

        recordedChunks = [];
        mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
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
      const payload = (typeof window.buildDiagnosisPayload === "function")
        ? window.buildDiagnosisPayload()
        : buildDiagnosisPayloadFallback();

      const fd = new FormData();
      // Champs “legacy” pour compat backend
      fd.append("description", payload.description || "");
      fd.append("location", payload.location || "");
      fd.append("situation", payload.primarySituation || "");
      fd.append("makeModel", (payload?.vehicle?.makeModel) || "");
      fd.append("notes", payload.notes || "");
      // Report JSON structuré
      fd.append("report", JSON.stringify(payload));

      // Audio: upload > enregistrement > nada
      const fileInput = document.getElementById("audioFile");
      if (fileInput?.files?.length > 0) {
        fd.append("audio", fileInput.files[0]);
      } else if (recordedAudio?.recordedBlob) {
        const file = new File([recordedAudio.recordedBlob], "recording.webm", { type: "audio/webm" });
        fd.append("audio", file);
      }

      const response = await fetch("https://myautosoundproject.onrender.com/diagnose", {
        method: "POST",
        body: fd,
      });

      let data;
      try { data = await response.json(); }
      catch { throw new Error("Invalid JSON response from server."); }
      if (!response.ok) { throw new Error(data?.error || `Server error (${response.status})`); }

      toggleLoading(false);

      // Garde pour export PDF
      window.__lastDiagnosis = { response: data, payload };

      displayDiagnosis(data);

      // Historique
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

  // ---- Export PDF brandé (multi-pages, sommaire, en-tête/pied)
  downloadBtn?.addEventListener('click', downloadPdfReport);

  async function downloadPdfReport() {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      alert("PDF generator not loaded. Check your jsPDF <script> tag.");
      return;
    }
    const pack = window.__lastDiagnosis;
    if (!pack || !pack.response) {
      alert("No diagnosis to export yet.");
      return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });

    const BRAND = {
      name: 'MyAutoSound',
      primary: '#1d4ed8',
      accent:  '#f59e0b',
      text:    '#111827',
      light:   '#6b7280',
      logoPath:'assets/logo.png'
    };
    const margin = 14;
    const pageW  = doc.internal.pageSize.getWidth();
    const pageH  = doc.internal.pageSize.getHeight();
    const maxW   = pageW - margin*2;
    let y = margin;

    const hexToRgb = (hex) => {
      const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return m ? { r: parseInt(m[1],16), g: parseInt(m[2],16), b: parseInt(m[3],16) } : {r:0,g:0,b:0};
    };
    const setCol = (hex) => { const {r,g,b}=hexToRgb(hex); doc.setTextColor(r,g,b); doc.setDrawColor(r,g,b); doc.setFillColor(r,g,b); };
    const hr = (color=BRAND.light) => { setCol(color); doc.setLineWidth(0.3); doc.line(margin, y, pageW-margin, y); y += 3; };
    const pBreakIf = (need=24) => { if (y + need > pageH - margin) { doc.addPage(); y = margin; drawHeader(); } };
    const H1 = (t) => { pBreakIf(18); doc.setFont('helvetica','bold'); doc.setFontSize(18); setCol(BRAND.text); doc.text(t, margin, y); y += 9; };
    const H2 = (t) => { pBreakIf(14); doc.setFont('helvetica','bold'); doc.setFontSize(13); setCol(BRAND.text); doc.text(t, margin, y); y += 7; };
    const P  = (t) => {
      const s = String(t ?? '');
      if (!s) return;
      doc.setFont('helvetica','normal'); doc.setFontSize(11); setCol(BRAND.text);
      const lines = doc.splitTextToSize(s, maxW);
      const h = lines.length * 5 + 1;
      pBreakIf(h);
      doc.text(lines, margin, y);
      y += h + 2;
    };
    const KV = (k, v) => {
      pBreakIf(8);
      doc.setFont('helvetica','bold'); doc.setFontSize(11); setCol(BRAND.text);
      doc.text(`${k}:`, margin, y);
      doc.setFont('helvetica','normal'); setCol(BRAND.text);
      const txt = String(v ?? '—');
      const lines = doc.splitTextToSize(txt, maxW - 28);
      doc.text(lines, margin + 28, y);
      y += Math.max(6, (lines.length*5));
    };

    const headerH = 12;
    async function loadLogoDataURL(src) {
      try {
        const img = new Image(); img.crossOrigin = 'anonymous';
        const done = new Promise((res, rej) => { img.onload = () => res(); img.onerror = rej; });
        img.src = src; await done;
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
        return canvas.toDataURL('image/png');
      } catch { return null; }
    }
    const logoDataURL = await loadLogoDataURL(BRAND.logoPath);

    function drawHeader() {
      setCol(BRAND.primary);
      doc.setFillColor(...Object.values(hexToRgb(BRAND.primary)));
      doc.rect(0, 0, pageW, headerH, 'F');

      if (logoDataURL) {
        doc.addImage(logoDataURL, 'PNG', margin, 3.5, 18, 5);
        doc.setFont('helvetica','bold'); doc.setFontSize(12); setCol('#ffffff');
        doc.text(BRAND.name, margin + 22, 8.5);
      } else {
        doc.setFont('helvetica','bold'); doc.setFontSize(14); setCol('#ffffff');
        doc.text(BRAND.name, margin, 8.5);
      }
      setCol(BRAND.accent);
      doc.setFont('helvetica','bold'); doc.setFontSize(10);
      const lab = 'DIAGNOSIS REPORT';
      const tw  = doc.getTextWidth(lab);
      doc.text(lab, pageW - margin - tw, 8.5);
      y = headerH + 8;
    }

    function drawFooterAllPages() {
      const n = doc.getNumberOfPages();
      for (let i=1; i<=n; i++) {
        doc.setPage(i);
        setCol('#e5e7eb'); doc.setLineWidth(0.2);
        doc.line(margin, pageH - 12, pageW - margin, pageH - 12);
        doc.setFont('helvetica','normal'); doc.setFontSize(9); setCol(BRAND.light);
        doc.text(`© ${new Date().getFullYear()} ${BRAND.name}`, margin, pageH - 6);
        const pg = `Page ${i} / ${n}`;
        const w = doc.getTextWidth(pg);
        doc.text(pg, pageW - margin - w, pageH - 6);
      }
    }

    drawHeader();

    const now = new Date().toLocaleString();
    const resp = pack.response || {};
    const pl   = pack.payload  || {};

    // Cover
    H1(`${BRAND.name} — Diagnosis Report`);
    KV('Generated', now);
    hr();
    P('This report summarizes your input and the AI’s analysis. It is informational and not a substitute for an inspection by a qualified technician.');

    // ToC page
    doc.addPage(); drawHeader();
    const tocPage = doc.getCurrentPageInfo().pageNumber;
    H1('Table of Contents');
    const tocEntries = [];
    y += 2; hr(); y += 2;

    function section(title, writer) {
      const startPage = doc.getCurrentPageInfo().pageNumber;
      tocEntries.push({ title, page: startPage });
      H1(title);
      writer && writer();
      y += 2; hr(); y += 2;
    }

    // Content
    doc.addPage(); drawHeader();

    section('User Report', () => {
      KV('Description', pl.description || '—');
      KV('Location', pl.location || '—');
      KV('Primary situation', pl.primarySituation || '—');

      if (pl.soundProfile) {
        H2('Sound Profile');
        KV('Labels', (pl.soundProfile.labels || []).join(', ') || '—');
        KV('Rhythm', pl.soundProfile.rhythm || '—');
        KV('Duration', pl.soundProfile.duration || '—');
        KV('Pitch (1–5)', pl.soundProfile.pitchLevel ?? '—');
        KV('Severity (1–5)', pl.soundProfile.severityLevel ?? '—');
      }

      if (pl.driving) {
        H2('Driving Context');
        KV('Speed range', pl.driving.speedRange || '—');
        KV('Reproducible', pl.driving.reproducible || '—');
      }

      if (pl.vehicle) {
        H2('Vehicle');
        KV('Make/Model', pl.vehicle.makeModel || '—');
        KV('Mileage', pl.vehicle.mileage ?? '—');
        KV('Transmission', pl.vehicle.transmission || '—');
        KV('Fuel', pl.vehicle.fuel || '—');
        KV('OBD-II code', pl.vehicle.obdCode || '—');
        KV('Warning lights', (pl.vehicle.warningLights || []).join(', ') || '—');
      }

      if (Array.isArray(pl.recentEvents) && pl.recentEvents.length) {
        H2('Recent Events'); P(pl.recentEvents.join(', '));
      }
      if (pl.notes) { H2('Notes'); P(pl.notes); }
    });

    section('AI Diagnosis', () => {
      P(resp.diagnosis || 'No diagnosis.');
      if (resp.message)     KV('Message', resp.message);
      if (resp.severity)    KV('Severity', resp.severity);
      if (resp.dangerLevel) KV('Danger', resp.dangerLevel);
      if (resp.costEstimate)KV('Cost', resp.costEstimate);
    });

    section('Next Steps', () => {
      if (resp.nextStep) P(resp.nextStep);
      else P('—');
    });

    if (resp.transcript) {
      section('Transcript', () => { P(resp.transcript); });
    }

    if (Array.isArray(resp.suggestions) && resp.suggestions.length) {
      section('Links (Tutorials & Parts)', () => {
        const lines = resp.suggestions.map(s => {
          if (typeof s === 'string') return s;
          const t = s.text || s.url || 'Link';
          return `${t} — ${s.url || ''}`;
        });
        P(lines.join('\n'));
      });
    }

    // Fill ToC
    doc.setPage(tocPage);
    y = 12 + 14;
    H2('Sections');
    doc.setFont('helvetica','normal'); doc.setFontSize(11); setCol(BRAND.text);
    tocEntries.forEach(({ title, page }) => {
      if (y + 8 > pageH - margin) { doc.addPage(); drawHeader(); }
      const line = `${title}`;
      doc.text(line, margin, y);
      const pageTxt = `${page}`;
      const tw = doc.getTextWidth(pageTxt);
      doc.text(pageTxt, pageW - margin - tw, y);
      y += 7;
    });

    // Footer
    drawFooterAllPages();

    doc.save(`MyAutoSound_Diagnosis_${Date.now()}.pdf`);
  }

  // ---- UI helpers
  function toggleLoading(on) {
    if (!loadingEl) return;
    if (on) { loadingEl.classList.remove("hidden"); submitBtn && (submitBtn.disabled = true); }
    else { loadingEl.classList.add("hidden"); submitBtn && (submitBtn.disabled = false); }
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
            ${data.suggestions.map(s => {
              const url = typeof s === "string" ? s : s.url;
              const text = typeof s === "string" ? s : (s.text || s.url);
              return `<li><a href="${escapeAttr(url || '#')}" target="_blank" rel="noopener" class="text-blue-600 hover:underline">🔧 ${escapeHTML(text || 'Link')}</a></li>`;
            }).join('')}
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
                ${Array.isArray(entry.payloadSummary.soundLabels) && entry.payloadSummary.soundLabels.length ? ` · ${escapeHTML(entry.payloadSummary.soundLabels.join(", "))}` : ""}
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

  // ---- Fallback builder si le payload builder global n'est pas là
  function buildDiagnosisPayloadFallback() {
    const $ = (id) => document.getElementById(id);
    const getChecks = (name) => [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(el => el.value);
    return {
      description: $("textInput")?.value?.trim() || "",
      audioAttached: !!document.getElementById("audioFile")?.files?.length || !!document.getElementById("recordedAudio")?.recordedBlob,
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

  // ---- Escape helpers
  function escapeHTML(str) {
    return (str || "").replace(/[&<>"']/g, (m) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
  }
  function escapeAttr(str) { return (str || "").replace(/"/g, "&quot;"); }
});

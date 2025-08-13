import express from "express";
import cors from "cors";
import multer from "multer";
import * as fs from "fs";
import * as dotenv from "dotenv";
import { OpenAI } from "openai";
import { createReadStream } from "fs";
import path from "path";
import sgMail from "@sendgrid/mail";

dotenv.config();
const app = express();
const upload = multer({ dest: "uploads/" });
const port = 3001;

// --- OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- SendGrid (pour feedback par courriel)
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
} else {
  console.warn("⚠️ SENDGRID_API_KEY is not set. /feedback will fail to send emails.");
}

app.use(cors());
app.use(express.json({ limit: "2mb" }));

// ============== DIAGNOSE ==============
app.post("/diagnose", upload.single("audio"), async (req, res) => {
  try {
    console.log("✅ Requête reçue dans /diagnose");

    const { description, location, situation, makeModel, notes } = req.body;
    console.log("Champs texte :", req.body);
    console.log("Fichier audio :", req.file);

    let transcriptText = "";

    if (req.file) {
      const oldPath = req.file.path;
      const newPath = oldPath + ".webm";
      fs.renameSync(oldPath, newPath);

      const transcription = await openai.audio.transcriptions.create({
        file: createReadStream(newPath),
        model: "whisper-1",
      });

      transcriptText = transcription.text;
      fs.unlinkSync(newPath); // Nettoyage
    }

    const hasAudio = !!transcriptText;

    const basePrompt = `You are an expert auto mechanic AI. Your job is to diagnose car problems based on the information provided.

User description:
- Noise: ${description || "Not specified"}
- Location: ${location || "Not specified"}
- Situation: ${situation || "Not specified"}
- Vehicle: ${makeModel || "Not specified"}
- Notes: ${notes || "None"}

${hasAudio ? `Transcription of the car noise: "${transcriptText}"` : "⚠️ No audio was provided. You must rely only on the user's text inputs."}

Also, highlight what the user can check or fix by themselves at home. Focus on simple inspections, maintenance, or easy replacements before recommending a mechanic.

Please reply using this format:

1. Provide a diagnosis: ...
2. Add a personalized message: ...
3. Include a GRAVITY level: ...
4. Include a DANGER level: ...
5. Provide a ROUGH COST ESTIMATE: ...
6. End with a next recommended step: ...
`;

    const chatResponse = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "You are a professional car mechanic that provides structured, smart diagnoses from sound and user text.",
        },
        { role: "user", content: basePrompt },
      ],
    });

    const fullResponse = chatResponse.choices[0]?.message?.content || "No diagnosis received.";
    console.log("🔍 GPT Response:\n", fullResponse);

    function extractBlock(num, fullText) {
      const regex = new RegExp(`${num}\\. .*?:\\s*([\\s\\S]*?)\\s*(?=${num + 1}\\.|$)`, "i");
      const match = fullText.match(regex);
      return match ? match[1].trim() : "Not specified";
    }

    // Suggestions YouTube
    const suggestionsMap = [
      {
        keywords: ["cliquetis", "ticking", "clatter"],
        suggestions: [
          { text: "Check the timing belt tensioner", url: "https://www.youtube.com/watch?v=yWsdEWh_4Co" },
          { text: "Fix engine clatter (video)", url: "https://www.youtube.com/watch?v=CEZ8kG9pU_I" }
        ]
      },
      {
        keywords: ["squealing", "belt", "sifflement", "serpentine"],
        suggestions: [
          { text: "Inspect serpentine belt", url: "https://www.youtube.com/watch?v=UFjYbzQ0kAw" },
          { text: "Replace squeaky belt", url: "https://www.youtube.com/watch?v=1t4QzOAQf5A" }
        ]
      },
      {
        keywords: ["grinding", "brake", "frein", "screeching"],
        suggestions: [
          { text: "Replace brake pads", url: "https://www.youtube.com/watch?v=lU6OKQxSg8U" },
          { text: "Brake pad guide", url: "https://www.autozone.com/diy/brakes/how-to-replace-brake-pads" }
        ]
      },
      {
        keywords: ["knocking", "engine knock"],
        suggestions: [
          { text: "Check engine oil level", url: "https://www.youtube.com/watch?v=agS-LsOY7L0" }
        ]
      },
      {
        keywords: ["rattling", "loose part", "vibration"],
        suggestions: [
          { text: "Check for loose heat shield", url: "https://www.youtube.com/watch?v=ul_Sg2g5PiE" },
          { text: "Diagnose rattling sounds", url: "https://www.youtube.com/watch?v=lGRuFzTyI1I" }
        ]
      },
      {
        keywords: ["battery", "won't start", "clicking", "electrical"],
        suggestions: [
          { text: "How to test a car battery", url: "https://www.youtube.com/watch?v=COJr7OB23Hw" },
          { text: "Jump-start your car", url: "https://www.youtube.com/watch?v=Fe2tqCzpF2Q" }
        ]
      },
      {
        keywords: ["overheating", "coolant", "temperature", "radiator"],
        suggestions: [
          { text: "Check coolant levels", url: "https://www.youtube.com/watch?v=I0o7n6nzt_8" },
          { text: "Signs of a bad thermostat", url: "https://www.youtube.com/watch?v=PI6I5xkfpDs" }
        ]
      },
      {
        keywords: ["exhaust", "smoke", "muffler", "loud"],
        suggestions: [
          { text: "Diagnose exhaust smoke", url: "https://www.youtube.com/watch?v=q9aM9Ch97U8" },
          { text: "Fix exhaust leak (DIY)", url: "https://www.youtube.com/watch?v=x5BvL1BeBLs" }
        ]
      },
      {
        keywords: ["check engine", "code", "OBD", "light"],
        suggestions: [
          { text: "How to scan OBD2 codes", url: "https://www.youtube.com/watch?v=6TlcPRlau2Q" },
          { text: "Free engine code check at AutoZone", url: "https://www.autozone.com/landing/page.jsp?name=free-check-engine-light-service" }
        ]
      }
    ];

    let matchedSuggestions = [];
    suggestionsMap.forEach(group => {
      group.keywords.forEach(keyword => {
        if (fullResponse.toLowerCase().includes(keyword.toLowerCase())) {
          matchedSuggestions = matchedSuggestions.concat(group.suggestions);
        }
      });
    });
    matchedSuggestions = [...new Map(matchedSuggestions.map(s => [s.url, s])).values()];

    const responsePayload = {
      diagnosis: extractBlock(1, fullResponse),
      message: extractBlock(2, fullResponse),
      severity: extractBlock(3, fullResponse),
      dangerLevel: extractBlock(4, fullResponse),
      costEstimate: extractBlock(5, fullResponse),
      nextStep: extractBlock(6, fullResponse),
      transcript: transcriptText,
      suggestions: matchedSuggestions
    };

    res.json(responsePayload);

  } catch (error) {
    console.error("❌ Erreur dans /diagnose :", error.message);
    res.status(500).json({ error: "Failed to process diagnosis." });
  }
});

// ============== FEEDBACK (email via SendGrid) ==============
app.post("/feedback", async (req, res) => {
  try {
    const {
      useful = null,         // 'yes' | 'no' | null
      category = null,       // 'accuracy' | 'speed' | 'ui' | 'tutorials' | 'other'
      message = '',
      email = null,
      consent = false,
      context = {}
    } = req.body || {};

    const clean = {
      useful: useful === 'yes' ? 'yes' : (useful === 'no' ? 'no' : null),
      category: ['accuracy','speed','ui','tutorials','other'].includes(category) ? category : null,
      message: String(message || '').replace(/<[^>]*>?/g, '').slice(0, 2000),
      email: email && /\S+@\S+\.\S+/.test(email) ? email : null,
      consent: !!consent,
      context: context && typeof context === 'object' ? context : {}
    };

    if (!process.env.SENDGRID_API_KEY || !process.env.FEEDBACK_TO || !process.env.FEEDBACK_FROM) {
      return res.status(500).json({ ok:false, error: "Email not configured on server." });
    }

    const html = `
      <h2>New Feedback – MyAutoSound</h2>
      <p><strong>Helpful:</strong> ${clean.useful ?? '—'}</p>
      <p><strong>Category:</strong> ${clean.category ?? '—'}</p>
      <p><strong>Message:</strong><br>${clean.message ? clean.message.replace(/\n/g,'<br>') : '—'}</p>
      <hr>
      <p><strong>User email:</strong> ${clean.email ?? '—'} ${clean.consent ? '(consent to contact)' : '(no consent)'} </p>
      <p><strong>Lang:</strong> ${String(clean.context.lang || '—').slice(0, 32)}</p>
      <p><strong>UA:</strong> ${String(clean.context.ua || '—').slice(0, 160)}</p>
      ${clean.context.lastDiagnosis ? `
        <hr>
        <h3>Last Diagnosis (snippet)</h3>
        <p><strong>Diagnosis:</strong> ${String(clean.context.lastDiagnosis.diagnosis || '—').slice(0,300)}</p>
        <p><strong>Severity:</strong> ${String(clean.context.lastDiagnosis.severity || '—').slice(0,60)}</p>
        <p><strong>Danger:</strong> ${String(clean.context.lastDiagnosis.dangerLevel || '—').slice(0,60)}</p>
      ` : ''}
      <p style="font-size:12px;color:#6b7280">Received: ${new Date().toISOString()}</p>
    `;

    const msg = {
      to: process.env.FEEDBACK_TO,
      from: process.env.FEEDBACK_FROM,
      subject: `MyAutoSound Feedback — ${clean.useful ?? 'no flag'}${clean.category ? ' / ' + clean.category : ''}`,
      text: `
New Feedback – MyAutoSound

Helpful: ${clean.useful ?? '—'}
Category: ${clean.category ?? '—'}
Message:
${clean.message || '—'}

User email: ${clean.email ?? '—'} ${clean.consent ? '(consent to contact)' : '(no consent)'}
Lang: ${clean.context.lang || '—'}
UA: ${clean.context.ua || '—'}

Last Diagnosis (snippet):
${clean.context.lastDiagnosis ? JSON.stringify(clean.context.lastDiagnosis, null, 2) : '—'}

Received: ${new Date().toISOString()}
      `.trim(),
      html
    };

    await sgMail.send(msg);
    res.json({ ok: true });
  } catch (err) {
    console.error("Feedback send error:", err?.response?.body || err);
    res.status(500).json({ ok: false, error: "Failed to send feedback email" });
  }
});

app.listen(port, () => {
  console.log(`✅ Server is running at https://myautosoundproject.onrender.com`);
});
